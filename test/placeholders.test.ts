import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPlaceholders, resolvePlaceholders } from '../src/core/placeholders.ts';

test('placeholders: find lists names and defaults', () => {
  const found = findPlaceholders('hi {{name}} and {{count:3}}');
  assert.deepEqual(found, [
    { name: 'name', defaultValue: undefined },
    { name: 'count', defaultValue: '3' },
  ]);
});

test('placeholders: explicit variables win over defaults', () => {
  const r = resolvePlaceholders('{{a:x}} {{b}}', { a: '1', b: '2' });
  assert.equal(r.text, '1 2');
  assert.deepEqual(r.unresolved, []);
});

test('placeholders: default used when no variable supplied', () => {
  const r = resolvePlaceholders('v={{x:fallback}}', {});
  assert.equal(r.text, 'v=fallback');
  assert.deepEqual(r.unresolved, []);
});

test('placeholders: unknown without default is kept and reported', () => {
  const r = resolvePlaceholders('keep {{secret}}', {});
  assert.equal(r.text, 'keep {{secret}}');
  assert.deepEqual(r.unresolved, ['secret']);
});

test('placeholders: keepUnknown:false drops unknown placeholders', () => {
  const r = resolvePlaceholders('drop {{secret}}', {}, { keepUnknown: false });
  assert.equal(r.text, 'drop ');
  assert.deepEqual(r.unresolved, ['secret']);
});

test('placeholders: escaped {{ renders literally and is not resolved', () => {
  const r = resolvePlaceholders('\\{{x:1}}', { x: '9' });
  assert.equal(r.text, '{{x:1}}');
  assert.deepEqual(r.unresolved, []);
});

test('placeholders: empty default expands to empty string', () => {
  const r = resolvePlaceholders('a{{x:}}b', {});
  assert.equal(r.text, 'ab');
});

test('placeholders: names may contain dots, dashes and underscores', () => {
  assert.deepEqual(findPlaceholders('{{a.b-c_d}}'), [{ name: 'a.b-c_d', defaultValue: undefined }]);
});

test('placeholders: values may contain colons and braces content', () => {
  const r = resolvePlaceholders('{{a:http://x/{{y}}}}', {});
  // inner braces are consumed by the lazy default value
  assert.equal(r.text, 'http://x/{{y}}');
  assert.deepEqual(r.unresolved, []);
});

test('placeholders: no placeholders means no change', () => {
  const r = resolvePlaceholders('plain text', {});
  assert.equal(r.text, 'plain text');
  assert.deepEqual(r.unresolved, []);
});

test('placeholders: literal private-use chars in text are preserved', () => {
  const r = resolvePlaceholders('a\uE000b {{x}}', { x: '1' });
  assert.equal(r.text, 'a\uE000b 1');
});

test('placeholders: escaped placeholder still renders literally with variables present', () => {
  const r = resolvePlaceholders('\\{{x:1}}', { x: '9' });
  assert.equal(r.text, '{{x:1}}');
  assert.deepEqual(r.unresolved, []);
});

test('placeholders: repeated names resolve defaults independently', () => {
  const r = resolvePlaceholders('{{a:1}} {{a:2}}', {});
  assert.equal(r.text, '1 2');
  assert.deepEqual(r.unresolved, []);
});

test('placeholders: masked positions stay verbatim and are not unresolved', () => {
  const mask = new Array('`{{x:1}}`'.length).fill(false);
  mask[1] = true; // 只遮挡起始花括号即可按整段保留
  const r = resolvePlaceholders('`{{x:1}}`', {}, { masked: mask });
  assert.equal(r.text, '`{{x:1}}`');
  assert.deepEqual(r.unresolved, []);
});
