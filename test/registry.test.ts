import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FragmentRegistry } from '../src/store/registry.ts';

const LIB_A = `name: a
entries:
  - tag: focus
    aliases: [careful]
    description: think harder
    body: focus body
  - tag: shared
    body: from a
`;

const LIB_B = `name: b
entries:
  - tag: shared
    body: from b
  - tag: note
    body: note body with {{topic:any}}
`;

function makeLibs(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'steno-reg-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}

test('registry: loads libraries in order and first-wins on name clash', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A, 'b.yaml': LIB_B });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml'), join(dir, 'b.yaml')]);
    const report = await reg.loadAll();
    assert.equal(report.loaded.length, 2);
    assert.equal(report.warnings.length, 1); // shared duplicated
    assert.equal(reg.resolve('shared')!.body, 'from a');
    assert.equal(reg.resolve('note')!.body, 'note body with {{topic:any}}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: aliases resolve; tag beats later alias', async () => {
  const dir = makeLibs({
    'a.yaml': 'entries:\n  - tag: focus\n    aliases: [safe]\n    body: f',
  });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml')]);
    await reg.loadAll();
    assert.equal(reg.resolve('safe')!.body, 'f');
    assert.equal(reg.has('safe'), true);
    assert.equal(reg.has('nope'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: missing library file is skipped with a reason', async () => {
  const dir = makeLibs({});
  try {
    const reg = new FragmentRegistry([join(dir, 'missing.yaml')]);
    const report = await reg.loadAll();
    assert.equal(report.loaded.length, 0);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.warnings.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: invalid library file is skipped with a reason', async () => {
  const dir = makeLibs({ 'bad.yaml': 'entries: [' });
  try {
    const reg = new FragmentRegistry([join(dir, 'bad.yaml')]);
    const report = await reg.loadAll();
    assert.equal(report.loaded.length, 0);
    assert.equal(report.skipped.length, 1);
    assert.ok(report.skipped[0]!.reason.includes('bad.yaml'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: search ranks exact tag highest, then prefix, then body', async () => {
  const dir = makeLibs({
    'x.yaml': [
      'entries:',
      '  - tag: focus',
      '    body: focus body',
      '  - tag: post-focus',
      '    body: after focus review',
    ].join('\n'),
  });
  try {
    const reg = new FragmentRegistry([join(dir, 'x.yaml')]);
    await reg.loadAll();
    const hits = reg.search('focus');
    assert.equal(hits.length, 2);
    assert.equal(hits[0]!.entry.tag, 'focus');
    assert.ok(hits[0]!.score > hits[1]!.score);
    assert.equal(hits[1]!.entry.tag, 'post-focus');
    const hits2 = reg.search('note');
    assert.equal(hits2.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: search matches aliases', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml')]);
    await reg.loadAll();
    assert.ok(reg.search('careful').some((h) => h.entry.tag === 'focus'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: list returns flattened entries with library names (shadowed entries included)', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A, 'b.yaml': LIB_B });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml'), join(dir, 'b.yaml')]);
    await reg.loadAll();
    const all = reg.list();
    assert.equal(all.length, 4); // focus, shared(a), shared(b), note
    assert.equal(all.filter((e) => e.library === 'a').length, 2);
    const onlyA = reg.list('a');
    assert.equal(onlyA.length, 2);
    assert.ok(onlyA.every((e) => e.library === 'a'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: add creates a new entry and persists to disk', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A });
  const path = join(dir, 'a.yaml');
  try {
    const reg = new FragmentRegistry([path]);
    await reg.loadAll();
    const res = await reg.add('newtag', 'new body', { description: 'd', aliases: ['nt'] });
    assert.equal(res.action, 'created');
    assert.equal(reg.resolve('newtag')!.body, 'new body');
    assert.equal(reg.resolve('nt')!.body, 'new body');
    // persisted: a fresh registry sees it
    const reg2 = new FragmentRegistry([path]);
    await reg2.loadAll();
    assert.equal(reg2.resolve('newtag')!.body, 'new body');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: add updates an existing entry in place', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A });
  const path = join(dir, 'a.yaml');
  try {
    const reg = new FragmentRegistry([path]);
    await reg.loadAll();
    const res = await reg.add('focus', 'new body');
    assert.equal(res.action, 'updated');
    assert.equal(reg.resolve('focus')!.body, 'new body');
    // ordering preserved: still first entry
    assert.equal(reg.list('a')[0]!.tag, 'focus');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: add to defaultLibrary when configured', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A, 'b.yaml': LIB_B });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml'), join(dir, 'b.yaml')], {
      defaultLibrary: 'b',
    });
    await reg.loadAll();
    const res = await reg.add('extra', 'x');
    assert.equal(res.library, 'b');
    assert.equal(reg.list('b').some((e) => e.tag === 'extra'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: add to unknown library raises', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml')]);
    await reg.loadAll();
    await assert.rejects(() => reg.add('x', 'y', { library: 'ghost' }), /library/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: add with invalid tag name raises', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml')]);
    await reg.loadAll();
    await assert.rejects(() => reg.add('1bad', 'y'), /tag/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: remove deletes an entry and persists', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A, 'b.yaml': LIB_B });
  const path = join(dir, 'b.yaml');
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml'), path]);
    await reg.loadAll();
    assert.equal(await reg.remove('note'), true);
    assert.equal(reg.has('note'), false);
    const reg2 = new FragmentRegistry([join(dir, 'a.yaml'), path]);
    await reg2.loadAll();
    assert.equal(reg2.has('note'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: remove of a nonexistent tag returns false', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml')]);
    await reg.loadAll();
    assert.equal(await reg.remove('ghost'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: remove restricted to a library only touches that library file', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A, 'b.yaml': LIB_B });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml'), join(dir, 'b.yaml')]);
    await reg.loadAll();
    // "shared" 同时存在于两个库文件；显式指定 b 只删 b 中的条目
    assert.equal(await reg.remove('shared', { library: 'b' }), true);
    assert.equal(reg.resolve('shared')!.body, 'from a'); // a 中的定义仍生效
    assert.equal(reg.list('b').some((e) => e.tag === 'shared'), false);
    assert.equal(await reg.remove('shared', { library: 'a' }), true);
    assert.equal(reg.has('shared'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: add update preserves aliases and description when not provided', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A });
  const path = join(dir, 'a.yaml');
  try {
    const reg = new FragmentRegistry([path]);
    await reg.loadAll();
    const res = await reg.add('focus', 'new body');
    assert.equal(res.action, 'updated');
    assert.equal(reg.resolve('focus')!.body, 'new body');
    assert.equal(reg.resolve('careful')!.body, 'new body'); // 别名保留
    assert.equal(reg.resolve('focus')!.description, 'think harder'); // 描述保留
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: add reports shadowing when a later library cannot take effect', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A, 'b.yaml': LIB_B });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml'), join(dir, 'b.yaml')]);
    await reg.loadAll();
    const res = await reg.add('shared', 'new from b', { library: 'b' });
    assert.equal(res.action, 'updated');
    assert.ok(res.warnings.some((w) => w.includes('shadowed')));
    assert.equal(reg.resolve('shared')!.body, 'from a'); // 实际仍由 a 提供
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: search tiers keep exact tags above prefix hits', async () => {
  const dir = makeLibs({
    'x.yaml': [
      'entries:',
      '  - tag: focus',
      '    body: x',
      '  - tag: focusx',
      '    aliases: [focusy]',
      '    body: y',
    ].join('\n'),
  });
  try {
    const reg = new FragmentRegistry([join(dir, 'x.yaml')]);
    await reg.loadAll();
    const hits = reg.search('focus');
    assert.equal(hits.length, 2);
    assert.equal(hits[0]!.entry.tag, 'focus'); // 精确标签必须排第一
    assert.equal(hits[1]!.entry.tag, 'focusx');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: remove by alias name returns false', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml')]);
    await reg.loadAll();
    assert.equal(await reg.remove('careful'), false);
    assert.equal(reg.has('focus'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: deleting the effective entry lets a shadowed one take effect', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A, 'b.yaml': LIB_B });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml'), join(dir, 'b.yaml')]);
    await reg.loadAll();
    await reg.remove('shared', { library: 'a' });
    assert.equal(reg.resolve('shared')!.body, 'from b');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: add with alias colliding inside the same library reports a warning', async () => {
  const dir = makeLibs({
    'a.yaml': 'entries:\n  - tag: foo\n    aliases: [bar]\n    body: f',
  });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml')]);
    await reg.loadAll();
    const res = await reg.add('bar', 'bar body');
    assert.ok(res.warnings.some((w) => w.includes('shadowed')));
    assert.equal(reg.resolve('bar')!.body, 'f'); // foo 的别名仍生效
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: duplicate library paths are loaded once', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A });
  const p = join(dir, 'a.yaml');
  try {
    const reg = new FragmentRegistry([p, p, '  ']);
    const report = await reg.loadAll();
    assert.equal(report.loaded.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: libraries() exposes loaded library metadata', async () => {
  const dir = makeLibs({ 'a.yaml': LIB_A });
  try {
    const reg = new FragmentRegistry([join(dir, 'a.yaml')]);
    await reg.loadAll();
    const libs = reg.libraries();
    assert.equal(libs.length, 1);
    assert.equal(libs[0]!.name, 'a');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
