import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, name, inject } from '../src/index.ts';
import type { DshToolDefinition } from '../src/index.ts';

test('bundle: entry exports the Cordis contract', async () => {
  assert.equal(name, 'dsh-steno');
  assert.deepEqual(inject, ['tools']);
  assert.equal(typeof apply, 'function');
});

test('bundle: apply registers all five tools and the beforeSend hook, then disposes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'steno-dsh-'));
  writeFileSync(
    join(dir, 'demo.yaml'),
    'name: demo\nentries:\n  - tag: focus\n    body: be careful\n',
    'utf8',
  );
  const registered: string[] = [];
  const hooks: string[] = [];
  const logs: string[] = [];
  const ctx = {
    tools: {
      register: (def: DshToolDefinition) => {
        registered.push(def.name);
        return () => undefined;
      },
    },
    on: (evt: string) => {
      hooks.push(evt);
      return () => undefined;
    },
    logger: {
      info: (msg: string) => logs.push(msg),
      warn: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
    },
    effect: () => undefined,
  };
  try {
    const disposer = apply(ctx, { libraries: [join(dir, 'demo.yaml')] });
    // createPlugin() 装载是异步的；轮询等待注册完成（避免固定延时在并行跑测试时抖动）
    const deadline = Date.now() + 3000;
    while (registered.length < 5 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.deepEqual(registered.sort(), ['steno.expand', 'steno.list', 'steno.remove', 'steno.save', 'steno.search']);
    assert.deepEqual(hooks, ['message.beforeSend']);
    assert.ok(logs.some((l) => l.includes('就绪')));
    assert.equal(typeof disposer, 'function');
    disposer();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});