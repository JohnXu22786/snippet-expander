import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExpansionEngine, type Resolvable } from '../src/core/engine.ts';

function makeResolver(entries: Record<string, string | { body: string; aliases?: string[] }>) {
  const index = new Map<string, string>();
  for (const [name, def] of Object.entries(entries)) {
    const key = name.trim().toLowerCase();
    index.set(key, typeof def === 'string' ? def : def.body);
    for (const alias of typeof def === 'string' ? [] : (def.aliases ?? [])) {
      index.set(alias.trim().toLowerCase(), typeof def === 'string' ? def : def.body);
    }
  }
  const resolve = (name: string): Resolvable | undefined => {
    const body = index.get(name.trim().toLowerCase());
    return body === undefined ? undefined : { body };
  };
  return resolve;
}

test('engine: replaces a simple tag with its body', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({ focus: 'be careful' }) });
  const r = engine.expand('please #focus now');
  assert.equal(r.text, 'please be careful now');
  assert.deepEqual(r.touched, ['focus']);
  assert.deepEqual(r.warnings, []);
});

test('engine: replaces multiple occurrences and dedupes touched', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({ focus: 'x' }) });
  const r = engine.expand('#focus and #focus');
  assert.equal(r.text, 'x and x');
  assert.deepEqual(r.touched, ['focus']);
});

test('engine: aliases resolve to the same body', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ focus: { body: 'care', aliases: ['careful'] } }),
  });
  const r = engine.expand('#careful');
  assert.equal(r.text, 'care');
  assert.deepEqual(r.touched, ['careful']);
});

test('engine: unknown tags are left untouched', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({}) });
  const r = engine.expand('keep #unknown-here');
  assert.equal(r.text, 'keep #unknown-here');
  assert.deepEqual(r.touched, []);
});

test('engine: nested expansion happens recursively', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ a: 'start #b end', b: 'middle' }),
  });
  const r = engine.expand('#a');
  assert.equal(r.text, 'start middle end');
  assert.deepEqual(r.touched, ['a', 'b']);
});

test('engine: recursive tags inside bodies may reference the outer chain (chain)', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ a: '#b', b: '#c', c: 'done' }),
  });
  const r = engine.expand('#a');
  assert.equal(r.text, 'done');
  assert.deepEqual(r.touched, ['a', 'b', 'c']);
});

test('engine: cycles are detected and left literal with a warning', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ a: '#b', b: '#a' }),
  });
  const r = engine.expand('#a');
  assert.equal(r.text, '#a');
  assert.ok(r.warnings.some((w) => w.includes('loop')));
});

test('engine: self-reference is a cycle', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({ a: 'x #a y' }) });
  const r = engine.expand('#a');
  assert.equal(r.text, 'x #a y');
  assert.ok(r.warnings.length >= 1);
});

test('engine: depth cap stops deep nesting with a warning', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ a: '#b', b: '#c', c: 'deep' }),
    maxDepth: 2,
  });
  const r = engine.expand('#a');
  // a -> b -> c would be depth 3; c is left literal
  assert.equal(r.text, '#c');
  assert.ok(r.warnings.some((w) => w.includes('depth')));
});

test('engine: maxExpansions cap stops runaway expansion', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ a: 'one #b #b #b', b: 'two' }),
    maxExpansions: 3,
    maxDepth: 100,
  });
  const r = engine.expand('#a');
  assert.equal(r.expansions, 3);
  assert.equal(r.text, 'one two two #b');
  assert.ok(r.warnings.some((w) => w.includes('limit')));
});

test('engine: escaped tags render literally without expansion', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({ focus: 'x' }) });
  const r = engine.expand('write \\#focus here');
  assert.equal(r.text, 'write #focus here');
  assert.deepEqual(r.touched, []);
});

test('engine: tags inside code blocks are not expanded', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({ focus: 'x' }) });
  const r = engine.expand('```\n#focus\n```');
  assert.equal(r.text, '```\n#focus\n```');
  assert.deepEqual(r.touched, []);
});

test('engine: variables fill placeholders in expanded text', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ note: 'topic: {{topic:general}}' }),
  });
  const r = engine.expand('#note', { variables: { topic: 'release' } });
  assert.equal(r.text, 'topic: release');
});

test('engine: defaults apply when variables are absent', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({ note: 't={{topic:any}}' }) });
  const r = engine.expand('#note');
  assert.equal(r.text, 't=any');
});

test('engine: unknown placeholders survive expansion', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({ note: 't={{topic}}' }) });
  const r = engine.expand('#note');
  assert.equal(r.text, 't={{topic}}');
  assert.deepEqual(r.unresolved, ['topic']);
});

test('engine: placeholder syntax in plain text also resolves', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({}) });
  const r = engine.expand('v={{x:1}}', { variables: { x: '2' } });
  assert.equal(r.text, 'v=2');
});

test('engine: mixed nested expansion with placeholders composes', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ head: '#base with {{who}}', base: 'hi' }),
  });
  const r = engine.expand('#head', { variables: { who: 'alice' } });
  assert.equal(r.text, 'hi with alice');
  assert.deepEqual(r.touched, ['head', 'base']);
});

test('engine: skipCode:false allows expansion inside fences', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ focus: 'x' }),
    skipCode: false,
  });
  const r = engine.expand('```\n#focus\n```');
  assert.equal(r.text, '```\nx\n```');
});

test('engine: empty input and non-tag text pass through unchanged', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({ focus: 'x' }) });
  assert.equal(engine.expand('').text, '');
  assert.equal(engine.expand('no tags here').text, 'no tags here');
});

test('engine: tags inside placeholders never expand (opaque regions)', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({ b: 'X' }) });
  const r = engine.expand('{{a:#b}}', { variables: { a: 'V' } });
  assert.equal(r.text, 'V');
  assert.deepEqual(r.touched, []);
  assert.equal(r.expansions, 0);
});

test('engine: placeholders inside code blocks are not resolved', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({}) });
  const r = engine.expand('`{{x:1}}`', { variables: { x: '9' } });
  assert.equal(r.text, '`{{x:1}}`');
  assert.deepEqual(r.unresolved, []);
});

test('engine: case variants of a tag still trigger cycle detection', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ a: '#A', A: '#a' }),
  });
  const r = engine.expand('#a');
  assert.equal(r.text, '#a'); // 展开 a→A→a 后于第二处检测到循环
  assert.ok(r.warnings.some((w) => w.includes('loop')));
});

test('engine: touched uses normalized names for dedup', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({ focus: 'x' }) });
  const r = engine.expand('#focus and #FOCUS');
  assert.equal(r.text, 'x and x');
  assert.deepEqual(r.touched, ['focus']);
});

test('engine: limit warning is emitted only once', () => {
  const engine = new ExpansionEngine({
    resolve: makeResolver({ a: '#b #c #d', b: '1', c: '2', d: '3' }),
    maxExpansions: 2,
    maxDepth: 100,
  });
  const r = engine.expand('#a');
  assert.equal(r.expansions, 2);
  assert.equal(r.warnings.filter((w) => w.includes('limit')).length, 1);
});

test('engine: variables never leak into code-protected placeholders even after escapes', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({}) });
  const r = engine.expand('\\{{a}} `{{b:1}}`', { variables: { b: 'LEAK' } });
  assert.equal(r.text, '{{a}} `{{b:1}}`');
  assert.deepEqual(r.unresolved, []);
});

test('engine: skipCode:false lets placeholders inside code resolve', () => {
  const engine = new ExpansionEngine({ resolve: makeResolver({}), skipCode: false });
  const r = engine.expand('`{{x:1}}`', { variables: { x: '9' } });
  assert.equal(r.text, '`9`');
});
