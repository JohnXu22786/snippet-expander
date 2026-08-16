import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, type ScanResult } from '../src/core/matcher.ts';

function tags(text: string, opts?: { skipCode?: boolean }): string[] {
  const r = scan(text, opts);
  return r.tags.map((t) => t.name);
}

test('matcher: extracts plain tags', () => {
  assert.deepEqual(tags('please #focus on this'), ['focus']);
  assert.deepEqual(tags('#alpha #beta'), ['alpha', 'beta']);
  assert.deepEqual(tags('a #git-status b'), ['git-status']);
  assert.deepEqual(tags('tag with underscore #my_tag ok'), ['my_tag']);
});

test('matcher: does not match inside a longer word (word boundary before #)', () => {
  assert.deepEqual(tags('foo#tag'), []);
  assert.deepEqual(tags('C#lang'), []);
});

test('matcher: does not match bare hashes or digit-start names', () => {
  assert.deepEqual(tags('a # b'), []);
  assert.deepEqual(tags('#123'), []);
  assert.deepEqual(tags('hash: #'), []);
});

test('matcher: does not match markdown headings (# followed by space)', () => {
  assert.deepEqual(tags('# Title'), []);
  assert.deepEqual(tags('## Sub'), []);
});

test('matcher: does not match doubled hashes', () => {
  assert.deepEqual(tags('##focus'), []);
});

test('matcher: CJK letters are valid tag characters', () => {
  assert.deepEqual(tags('请#专注模式'), ['专注模式']);
  assert.deepEqual(tags('请#专注'), ['专注']);
});

test('matcher: reports escaped tags so the engine can unescape them', () => {
  const r: ScanResult = scan('use \\#focus now');
  assert.deepEqual(r.tags, []);
  assert.equal(r.escapes.length, 1);
  assert.equal(r.escapes[0]!.name, 'focus');
  // backslash must be immediately followed by '#'
  assert.deepEqual(scan('a \\ x').escapes, []);
  // '\#' not followed by a letter is not an escaped tag
  assert.deepEqual(scan('\\#1').escapes, []);
});

test('matcher: skips tags inside fenced code blocks (backtick fences)', () => {
  const text = 'before\n```\n#inside\n```\nafter #outside';
  assert.deepEqual(tags(text), ['outside']);
});

test('matcher: skips tags inside fenced code blocks (tilde fences, with language)', () => {
  const text = '~~~js\n#nope\n~~~\n#yes';
  assert.deepEqual(tags(text), ['yes']);
});

test('matcher: skips tags inside inline code spans', () => {
  const text = 'use `#literal` here and #real';
  assert.deepEqual(tags(text), ['real']);
});

test('matcher: skipCode:false disables code-block protection', () => {
  const text = '```\n#inside\n```';
  assert.deepEqual(tags(text, { skipCode: false }), ['inside']);
});

test('matcher: trailing hash alone produces no tag', () => {
  assert.deepEqual(tags('end #'), []);
});

test('matcher: longer fence keeps shorter runs as content (4-backtick nesting)', () => {
  const text = '````\n#inside\n```\nmore\n````\nafter #outside';
  assert.deepEqual(tags(text), ['outside']);
});

test('matcher: fence with 3-run inside 4-run is content, not a closer', () => {
  const text = '````\n```\n#tag\n```\n````';
  assert.deepEqual(tags(text), []);
});

test('matcher: fences must start at line beginning', () => {
  const text = 'aaa ``` bbb\n#tag\n```';
  assert.deepEqual(tags(text), ['tag']); // 行中围栏不生效
});

test('matcher: closing fence line may not have trailing content', () => {
  const text = '```\n#tag\n``` trailing\n#out';
  assert.deepEqual(tags(text), ['tag', 'out']);
});

test('matcher: tags inside placeholder regions are not candidates', () => {
  const text = 'see {{x:#inner}} and #outer';
  assert.deepEqual(tags(text), ['outer']);
  const r = scan(text);
  assert.equal(r.spans.length, 1);
});

test('matcher: unclosed placeholder braces do not hide tags', () => {
  assert.deepEqual(tags('{{ oops #tag'), ['tag']);
});

test('matcher: escaped placeholder braces are not spans', () => {
  const r = scan('\\{{x:#inner}}');
  // \{{ 转义不产生占位符区域；内部标签仍为普通候选
  assert.deepEqual(r.tags.map((t) => t.name), ['inner']);
  assert.equal(r.spans.length, 0);
});

test('matcher: run on the opening line is not a closing fence', () => {
  const text = '``` ```\n#tag\n```';
  assert.deepEqual(tags(text), []); // 开启行剩余部分的 run 不算闭合围栏
});

test('matcher: CRLF line endings keep fence protection', () => {
  const text = '```\r\n#inside\r\n```\r\nafter #outside';
  assert.deepEqual(tags(text), ['outside']);
});

test('matcher: escaped tag does not leak adjacent normal tags', () => {
  const r = scan('\\#focus and #real');
  assert.deepEqual(r.tags.map((t) => t.name), ['real']);
  assert.equal(r.escapes.length, 1);
  assert.equal(r.escapes[0]!.name, 'focus');
});

test('matcher: punctuation-adjacent tags match, doubled hashes do not', () => {
  assert.deepEqual(tags('see (#focus) now'), ['focus']);
  assert.deepEqual(tags('#tag#other'), ['tag']);
  assert.deepEqual(tags('一，#tag。'), ['tag']);
});

test('matcher: escaped tag inside a placeholder region yields neither tag nor escape', () => {
  const r = scan('{{a:\\#b}}');
  assert.equal(r.spans.length, 1);
  assert.deepEqual(r.tags, []);
  assert.deepEqual(r.escapes, []);
});
