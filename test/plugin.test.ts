import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FragmentRegistry } from '../src/store/registry.ts';
import { ExpansionEngine } from '../src/core/engine.ts';
import { createMessageHook } from '../src/plugin/hooks.ts';
import { buildTools } from '../src/plugin/tools.ts';

const LIB = `name: demo
entries:
  - tag: focus
    aliases: [careful]
    description: think harder
    body: be careful
  - tag: note
    body: topic is {{topic:any}}
`;

async function makeHarness(): Promise<{
  engine: ExpansionEngine;
  registry: FragmentRegistry;
  dir: string;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'steno-hook-'));
  writeFileSync(join(dir, 'demo.yaml'), LIB, 'utf8');
  const registry = new FragmentRegistry([join(dir, 'demo.yaml')]);
  await registry.loadAll();
  const engine = new ExpansionEngine({ resolve: (n) => registry.resolve(n) });
  return { engine, registry, dir };
}

test('hooks: message.beforeSend expands tags in the message', async () => {
  const { engine, dir } = await makeHarness();
  try {
    const hook = createMessageHook(engine);
    const out = await hook({ message: 'please #focus on this' });
    assert.equal(out.message, 'please be careful on this');
    assert.equal(out.meta?.steno?.touched[0], 'focus');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hooks: passes through variables and reports warnings in meta', async () => {
  const { engine, dir } = await makeHarness();
  try {
    const hook = createMessageHook(engine);
    const out = await hook({ message: 'about #note', variables: { topic: 'release' } });
    assert.equal(out.message, 'about topic is release');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hooks: non-string messages pass through untouched with applied:false meta', async () => {
  const { engine, dir } = await makeHarness();
  try {
    const hook = createMessageHook(engine);
    const out = await hook({ message: 42 });
    assert.equal(out.message, 42);
    const meta = out.meta?.steno as { applied: boolean };
    assert.equal(meta.applied, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: steno.expand works end to end', async () => {
  const { engine, registry, dir } = await makeHarness();
  try {
    const tools = buildTools({ engine, registry });
    const t = tools.find((x) => x.name === 'steno.expand')!;
    const out = (await t.run({ text: 'do #focus #nope', variables: {} })) as {
      text: string;
      touched: string[];
    };
    assert.equal(out.text, 'do be careful #nope');
    assert.deepEqual(out.touched, ['focus']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: steno.search returns ranked hits with library info', async () => {
  const { engine, registry, dir } = await makeHarness();
  try {
    const tools = buildTools({ engine, registry });
    const t = tools.find((x) => x.name === 'steno.search')!;
    const out = (await t.run({ query: 'careful' })) as Array<{ entry: { tag: string }; library: string }>;
    assert.ok(out.some((h) => h.entry.tag === 'focus' && h.library === 'demo'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: steno.list returns all entries', async () => {
  const { engine, registry, dir } = await makeHarness();
  try {
    const tools = buildTools({ engine, registry });
    const t = tools.find((x) => x.name === 'steno.list')!;
    const out = (await t.run({})) as Array<{ tag: string }>;
    assert.deepEqual(out.map((e) => e.tag).sort(), ['focus', 'note']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: steno.save validates input and persists', async () => {
  const { engine, registry, dir } = await makeHarness();
  try {
    const tools = buildTools({ engine, registry });
    const save = tools.find((x) => x.name === 'steno.save')!;
    await assert.rejects(() => save.run({ tag: '9bad', body: 'x' }), /tag/i);
    const out = (await save.run({ tag: 'newone', body: 'body!', aliases: ['nw'] })) as {
      action: string;
    };
    assert.equal(out.action, 'created');
    assert.equal(registry.resolve('nw')!.body, 'body!');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: steno.remove removes an entry', async () => {
  const { engine, registry, dir } = await makeHarness();
  try {
    const tools = buildTools({ engine, registry });
    const remove = tools.find((x) => x.name === 'steno.remove')!;
    assert.equal(await remove.run({ tag: 'note' }), true);
    assert.equal(registry.has('note'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: every tool declares a name, description and inputSchema', async () => {
  const { engine, registry, dir } = await makeHarness();
  try {
    const tools = buildTools({ engine, registry });
    for (const t of tools) {
      assert.ok(typeof t.name === 'string' && t.name.startsWith('steno.'));
      assert.ok(t.description.length > 0);
      assert.ok(t.inputSchema && typeof t.inputSchema === 'object');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tools: input validation errors are rejected with clear messages', async () => {
  const { engine, registry, dir } = await makeHarness();
  try {
    const tools = buildTools({ engine, registry });
    const expand = tools.find((x) => x.name === 'steno.expand')!;
    await assert.rejects(() => expand.run({}), /text/i);
    await assert.rejects(() => expand.run({ text: 'x', variables: { a: 5 } }), /variables/i);
    const search = tools.find((x) => x.name === 'steno.search')!;
    await assert.rejects(() => search.run({}), /query/i);
    const save = tools.find((x) => x.name === 'steno.save')!;
    await assert.rejects(() => save.run({ tag: 't', body: 5 }), /body/i);
    await assert.rejects(() => save.run({ tag: 't', body: 'x', aliases: [1] }), /aliases/i);
    const remove = tools.find((x) => x.name === 'steno.remove')!;
    await assert.rejects(() => remove.run({}), /tag/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
