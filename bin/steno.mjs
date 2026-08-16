#!/usr/bin/env node
// 轻量包装：保证 bin 入口的 shebang 与路径解析在任何环境都可靠。
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');
await import(pathToFileURL(cliPath).href);
