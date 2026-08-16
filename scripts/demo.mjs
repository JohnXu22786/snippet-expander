// demo.mjs — 模拟宿主 harness 加载插件：先跑消息钩子，再调用一个工具。
// 运行：npm run demo（会自动先构建）
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPlugin } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const sampleLib = join(here, '..', 'libs', 'sample.yaml');

const plugin = await createPlugin({
  config: { libraries: [sampleLib], defaultLibrary: 'core' },
  logger: { info: (m) => console.log('[demo]', m), warn: (m) => console.log('[demo]', m) },
});

console.log(`插件已加载: ${plugin.id} v${plugin.version}`);
console.log(`片段库: ${plugin.registry.libraries().map((l) => l.name).join(', ')}`);
console.log('='.repeat(60));

const messages = [
  '请用 #review-lens 帮我检查这段代码',
  '整理一份 #meeting-note，主题是 {{topic:发版计划}}',
  '按 #conventional-commit 写提交信息，scope 填 steno',
  '```js\nconst x = "#not-a-tag";\n```\n请忽略上面这行 #tag',
];

for (const msg of messages) {
  const out = await plugin.hooks['message.beforeSend']({ message: msg });
  console.log('原消息 :', msg);
  console.log('展开后 :', out.message);
  if (out.meta && out.meta.steno) {
    const s = out.meta.steno;
    if (s.warnings.length) console.log('警告   :', s.warnings);
  }
  console.log('-'.repeat(60));
}

const expandTool = plugin.tools.find((t) => t.name === 'steno.expand');
const result = await expandTool.run({
  text: '#review-lens',
  variables: {},
});
console.log('工具 steno.expand("#review-lens") 输出:');
console.log(JSON.stringify(result, null, 2));
