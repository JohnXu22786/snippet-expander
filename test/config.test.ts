import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { expandPath, resolveConfig } from '../src/config.ts';

test('config: expandPath handles tilde forms', () => {
  assert.equal(expandPath('~/x/y.yaml'), join(homedir(), 'x', 'y.yaml'));
  assert.equal(expandPath('~'), homedir());
  assert.equal(expandPath('~\\x\\y'), join(homedir(), 'x', 'y'));
});

test('config: expandPath keeps ~user and undefined vars literal', () => {
  assert.equal(expandPath('~someone/x'), '~someone/x');
  assert.equal(expandPath('${UNDEFINED_STENO_X}/y'), '${UNDEFINED_STENO_X}/y');
});

test('config: expandPath resolves defined env vars', () => {
  process.env.STENO_TEST_VAR = 'libs';
  try {
    // 环境变量值按原样插入；后续 resolve() 会规范化分隔符
    assert.equal(expandPath('${STENO_TEST_VAR}/a.yaml'), 'libs/a.yaml');
  } finally {
    delete process.env.STENO_TEST_VAR;
  }
});

test('config: explicit libraries win and empty entries are filtered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'steno-cfg-'));
  const lib = join(dir, 'a.yaml');
  writeFileSync(lib, 'entries:\n  - tag: t\n    body: b', 'utf8');
  try {
    const { config } = await resolveConfig({ libraries: [lib, '   ', ''] });
    assert.deepEqual(config.libraries, [lib]);
    assert.equal(config.origin, 'config');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: env var fallback applies defaults', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'steno-cfg-'));
  const lib = join(dir, 'a.yaml');
  writeFileSync(lib, 'entries: []', 'utf8');
  process.env.DSH_STENO_LIBRARIES = lib;
  try {
    const { config } = await resolveConfig({});
    assert.equal(config.origin, 'env');
    assert.deepEqual(config.libraries, [lib]);
    assert.equal(config.maxDepth, 8);
    assert.equal(config.maxExpansions, 200);
    assert.equal(config.skipCode, true);
    assert.equal(config.keepUnknown, true);
    assert.equal(config.defaultLibrary, undefined);
  } finally {
    delete process.env.DSH_STENO_LIBRARIES;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: discovery finds project libraries without duplicates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'steno-cfg-'));
  const proj = join(dir, '.dsh', 'steno');
  mkdirSync(proj, { recursive: true });
  const lib = join(proj, 'p.yaml');
  writeFileSync(lib, 'entries: []', 'utf8');
  try {
    const { config } = await resolveConfig({}, dir);
    assert.equal(config.origin, 'discovered');
    // 项目库存在且只出现一次（即使与用户目录重合）
    assert.equal(config.libraries.filter((p) => p === lib).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
