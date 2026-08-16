import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseLibrary,
  loadLibraryFile,
  serializeLibrary,
  writeLibraryFile,
  normalizeTagName,
  isValidTagName,
  LibraryFormatError,
  type LibraryFile,
} from '../src/store/library.ts';

test('library: parses a valid YAML library with full fields', () => {
  const text = [
    'name: core',
    'description: main library',
    'entries:',
    '  - tag: focus',
    '    aliases: [careful]',
    '    description: think harder',
    '    body: |-',
    '      line one',
    '      line two',
    '  - tag: plain',
    '    body: single line',
  ].join('\n');
  const lib = parseLibrary(text, '/x/core.yaml');
  assert.equal(lib.name, 'core');
  assert.equal(lib.description, 'main library');
  assert.equal(lib.entries.length, 2);
  assert.deepEqual(lib.entries[0]!.aliases, ['careful']);
  assert.equal(lib.entries[0]!.body, 'line one\nline two');
  assert.equal(lib.entries[1]!.body, 'single line');
  assert.deepEqual(lib.entries[1]!.aliases, []);
});

test('library: name defaults to the file basename', () => {
  const lib = parseLibrary('entries: []', '/some/dir/work.yaml');
  assert.equal(lib.name, 'work');
});

test('library: body may be a YAML array of lines', () => {
  const lib = parseLibrary('entries:\n  - tag: t\n    body:\n      - a\n      - b', 'f.yaml');
  assert.equal(lib.entries[0]!.body, 'a\nb');
});

test('library: alias may be a single string', () => {
  const lib = parseLibrary('entries:\n  - tag: t\n    aliases: quick\n    body: b', 'f.yaml');
  assert.deepEqual(lib.entries[0]!.aliases, ['quick']);
});

test('library: invalid YAML raises a format error with path', () => {
  assert.throws(() => parseLibrary('entries: [', 'bad.yaml'), LibraryFormatError);
});

test('library: missing entries key raises', () => {
  assert.throws(() => parseLibrary('name: x', 'f.yaml'), LibraryFormatError);
});

test('library: invalid tag names raise with an issue message', () => {
  assert.throws(
    () => parseLibrary('entries:\n  - tag: "1bad"\n    body: b', 'f.yaml'),
    (e: unknown) => e instanceof LibraryFormatError && e.issues.some((i) => i.includes('1bad')),
  );
});

test('library: missing body raises', () => {
  assert.throws(() => parseLibrary('entries:\n  - tag: ok', 'f.yaml'), LibraryFormatError);
});

test('library: duplicate tags inside one file raise', () => {
  assert.throws(
    () => parseLibrary('entries:\n  - tag: dup\n    body: a\n  - tag: dup\n    body: b', 'f.yaml'),
    LibraryFormatError,
  );
});

test('library: serialization round-trips entries', () => {
  const lib: LibraryFile = {
    path: 'f.yaml',
    name: 'core',
    description: 'd',
    entries: [
      { tag: 'focus', aliases: ['careful'], description: 'dd', body: 'multi\nline' },
      { tag: 'plain', aliases: [], body: 'x' },
    ],
  };
  const dumped = serializeLibrary(lib);
  const reparsed = parseLibrary(dumped, 'f.yaml');
  assert.deepEqual(reparsed.entries, lib.entries);
  assert.equal(reparsed.name, 'core');
  assert.equal(reparsed.description, 'd');
});

test('library: loadLibraryFile and writeLibraryFile round-trip on disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'steno-lib-'));
  const path = join(dir, 'core.yaml');
  try {
    await writeLibraryFile(
      { path, name: 'core', entries: [{ tag: 't', aliases: [], body: 'hello\nworld' }] },
    );
    const lib = await loadLibraryFile(path);
    assert.equal(lib.entries[0]!.body, 'hello\nworld');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('library: writeLibraryFile creates parent dirs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'steno-lib-'));
  const path = join(dir, 'nested', 'a', 'b.yaml');
  try {
    await writeLibraryFile({ path, name: 'b', entries: [{ tag: 't', aliases: [], body: 'x' }] });
    const lib = await loadLibraryFile(path);
    assert.equal(lib.name, 'b');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('library: tag name normalization lowercases and trims', () => {
  assert.equal(normalizeTagName('  Focus  '), 'focus');
  assert.equal(normalizeTagName('Git-Status'), 'git-status');
});

test('library: tag validation accepts letters, digits, dash, underscore, CJK', () => {
  assert.equal(isValidTagName('focus'), true);
  assert.equal(isValidTagName('my_tag-2'), true);
  assert.equal(isValidTagName('专注'), true);
  assert.equal(isValidTagName('1abc'), false);
  assert.equal(isValidTagName(''), false);
  assert.equal(isValidTagName('a b'), false);
  assert.equal(isValidTagName('a#b'), false);
});
