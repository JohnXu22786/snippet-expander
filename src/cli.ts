/**
 * cli.ts — 命令行入口（bin: dsh-steno）
 *
 * 命令一览：
 *   list     列出片段           dsh-steno list [--library <名>] [--json]
 *   search   搜索片段           dsh-steno search <词> [--limit <n>] [--json]
 *   preview  预览片段           dsh-steno preview <标签> [--var k=v] [--json]
 *   expand   展开文本           dsh-steno expand <文本...> [--var k=v] [--json]
 *   add      新增/更新片段      dsh-steno add <标签> <正文...> [--library <名>]
 *                               [--alias <a>] [--description <d>] [--stdin]
 *   remove   删除片段           dsh-steno remove <标签> [--library <名>]
 *   paths    查看配置与库路径
 *   init     初始化示例库       dsh-steno init [--dir <路径>]
 *   --version / --help
 *
 * 库文件来源：环境变量 DSH_STENO_LIBRARIES（分号分隔）或自动发现
 * <项目>/.dsh/steno/*.yaml 与 ~/.dsh/steno/*.yaml。
 */

import { createPlugin } from './index.ts';
import type { StenoPlugin } from './index.ts';
import { expandPath } from './config.ts';
import { mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const SAMPLE_LIB_PATH = new URL('../libs/sample.yaml', import.meta.url);

interface ParsedArgs {
  command: string;
  positionals: string[];
  options: Map<string, string | string[] | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string | string[] | boolean>();
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === '--json' || a === '--stdin') {
      options.set(a.slice(2), true);
    } else if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        options.set(name, true);
      } else {
        // 支持重复选项（如多个 --alias）
        const prev = options.get(name);
        if (prev === true) options.set(name, next);
        else if (prev === undefined) options.set(name, next);
        else if (Array.isArray(prev)) prev.push(next);
        else options.set(name, [prev as string, next]);
        i++;
      }
    } else {
      positionals.push(a);
    }
    i++;
  }
  return { command: positionals.shift() ?? '', positionals, options };
}

function optStr(args: ParsedArgs, name: string): string | undefined {
  const v = args.options.get(name);
  return typeof v === 'string' ? v : undefined;
}

function optList(args: ParsedArgs, name: string): string[] {
  const v = args.options.get(name);
  if (typeof v === 'boolean' || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function usageError(msg: string): never {
  process.stderr.write(`error: ${msg}\n（试试 dsh-steno --help）\n`);
  process.exit(2);
}

const HELP = `dsh-steno — Steno 短标签工具（与插件共用同一套片段库）

用法：dsh-steno <命令> [参数] [选项]

命令：
  list [--library <名>] [--json]        列出片段
  search <词> [--limit <n>] [--json]    搜索片段
  preview <标签> [--var k=v] [--json]   预览片段的完整展开
  expand <文本...> [--var k=v] [--json] 展开文本中的 #标签（文本为 - 时从 stdin 读取）
  add <标签> <正文...> [选项]            新增或更新片段
  remove <标签> [--library <名>]        删除片段
  paths                                 显示配置与库文件路径
  init [--dir <路径>] [--force]            初始化示例库（默认 ~/.dsh/steno，已存在时需 --force）
  --version, --help                     版本 / 帮助

add 选项：
  --library <名>     目标库（缺省写入默认库）
  --alias <a>        别名，可重复
  --description <d>  说明
  --stdin            从 stdin 读取正文（含换行）

expand 选项：
  --var <k=v>        占位符变量，可重复
  --json             输出 JSON

环境变量：
  DSH_STENO_LIBRARIES  库文件路径列表，分号分隔，优先于自动发现
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write('dsh-steno 1.0.0\n');
    return;
  }
  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return;
  }

  const args = parseArgs(argv);
  const json = args.options.get('json') === true;

  if (args.command === 'init') {
    const dirRaw = optStr(args, 'dir') ?? join(homedir(), '.dsh', 'steno');
    const dir = isAbsolute(dirRaw) ? dirRaw : resolve(dirRaw);
    const target = join(dir, 'core.yaml');
    const force = args.options.get('force') === true;
    if (existsSync(target) && !force) {
      process.stderr.write(`error: ${target} 已存在（如需覆盖请加 --force）\n`);
      process.exit(1);
    }
    await mkdir(dir, { recursive: true });
    await copyFile(fileURLToPath(SAMPLE_LIB_PATH), target);
    process.stdout.write(`已创建示例库：${target}\n`);
    process.stdout.write(`可编辑该文件添加片段，然后在消息中直接使用 #标签。\n`);
    return;
  }

  const plugin: StenoPlugin = await createPlugin({ cwd: process.cwd() });

  switch (args.command) {
    case 'paths': {
      const info = {
        origin: plugin.config.origin,
        libraries: plugin.config.libraries,
        defaultLibrary: plugin.config.defaultLibrary ?? null,
        maxDepth: plugin.config.maxDepth,
        maxExpansions: plugin.config.maxExpansions,
        skipCode: plugin.config.skipCode,
        keepUnknown: plugin.config.keepUnknown,
        loaded: plugin.registry.libraries().map((l) => ({ path: l.path, name: l.name })),
        skipped: plugin.warnings,
      };
      if (json) printJson(info);
      else {
        process.stdout.write(`片段库来源: ${info.origin}\n`);
        process.stdout.write(`片段库文件: ${info.libraries.length ? info.libraries.join(', ') : '（无）'}\n`);
        for (const lib of info.loaded) process.stdout.write(`  - ${lib.name}  <-  ${lib.path}\n`);
        for (const w of plugin.warnings) process.stdout.write(`警告: ${w}\n`);
      }
      return;
    }

    case 'list': {
      const library = optStr(args, 'library');
      const rows = plugin.registry.list(library);
      if (json) {
        printJson(rows);
      } else {
        if (rows.length === 0) process.stdout.write('（无片段）\n');
        for (const r of rows) {
          const aliasText = r.aliases.length ? `  #${r.aliases.join(' #')}` : '';
          const descText = r.description ? `  — ${r.description}` : '';
          const bodyPreview = r.body.replace(/\n/g, ' ').slice(0, 60);
          process.stdout.write(`[${r.library}] #${r.tag}${aliasText}${descText}\n  ${bodyPreview}\n`);
        }
      }
      return;
    }

    case 'search': {
      const query = args.positionals[0] ?? usageError('search 需要搜索词');
      const limitRaw = optStr(args, 'limit');
      let limit = 10;
      if (limitRaw !== undefined) {
        const parsed = Number.parseInt(limitRaw, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          usageError(`--limit 必须是正整数（收到 "${limitRaw}"）`);
        }
        limit = parsed;
      }
      const hits = plugin.registry.search(query, { limit });
      if (json) {
        printJson(hits);
      } else {
        if (hits.length === 0) process.stdout.write('（无匹配）\n');
        for (const h of hits) {
          process.stdout.write(
            `[${h.library}] #${h.entry.tag} (得分 ${h.score})${h.entry.description ? `  — ${h.entry.description}` : ''}\n`,
          );
        }
      }
      return;
    }

    case 'preview': {
      const tag = args.positionals[0] ?? usageError('preview 需要标签名');
      const vars = parseVars(args);
      const entry = plugin.registry.resolve(tag);
      if (!entry) {
        process.stderr.write(`未找到 #${tag}\n`);
        process.exit(1);
      }
      const result = plugin.engine.expand(`#${tag}`, { variables: vars });
      if (json) {
        printJson({ tag, library: undefined, entry, expansion: result });
      } else {
        process.stdout.write(`#${tag}\n`);
        if (entry.description) process.stdout.write(`描述: ${entry.description}\n`);
        if (entry.aliases.length) process.stdout.write(`别名: ${entry.aliases.map((a) => '#' + a).join(' ')}\n`);
        process.stdout.write(`--- 展开结果 ---\n${result.text}\n`);
        for (const w of result.warnings) process.stderr.write(`警告: ${w}\n`);
      }
      return;
    }

    case 'expand': {
      let text = args.positionals.join(' ');
      if (text === '-' || args.options.get('stdin') === true) {
        if (process.stdin.isTTY) usageError('stdin 模式下请通过管道输入内容');
        text = readFileSync(0, 'utf8').replace(/\n$/, '');
      }
      if (!text) usageError('expand 需要文本（或用 - 从 stdin 读取）');
      const vars = parseVars(args);
      const result = plugin.engine.expand(text, { variables: vars });
      if (json) {
        printJson(result);
      } else {
        process.stdout.write(result.text + '\n');
        for (const w of result.warnings) process.stderr.write(`警告: ${w}\n`);
      }
      return;
    }

    case 'add': {
      const tag = args.positionals[0] ?? usageError('add 需要标签名');
      let body: string;
      if (args.options.get('stdin') === true) {
        if (process.stdin.isTTY) usageError('--stdin 模式下请通过管道输入正文');
        body = readFileSync(0, 'utf8').replace(/\n$/, '');
      } else {
        body = args.positionals.slice(1).join(' ');
      }
      if (!body) usageError('add 需要正文');
      const res = await plugin.registry.add(tag, body, {
        library: optStr(args, 'library'),
        aliases: optList(args, 'alias'),
        description: optStr(args, 'description'),
      });
      if (json) printJson(res);
      else process.stdout.write(`${res.action === 'created' ? '已新增' : '已更新'} #${res.tag} -> 库 "${res.library}"\n`);
      return;
    }

    case 'remove': {
      const tag = args.positionals[0] ?? usageError('remove 需要标签名');
      const library = optStr(args, 'library');
      if (library && !plugin.registry.libraries().some((l) => l.name === library)) {
        process.stderr.write(`error: 库 "${library}" 未加载\n`);
        process.exit(1);
      }
      const ok = await plugin.registry.remove(tag, library ? { library } : {});
      if (json) printJson({ removed: ok });
      else process.stdout.write(ok ? `已删除 #${tag}\n` : `未找到 #${tag}\n`);
      return;
    }

    default:
      usageError(`未知命令 "${args.command}"`);
  }
}

function parseVars(args: ParsedArgs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of optList(args, 'var')) {
    const idx = kv.indexOf('=');
    if (idx <= 0) usageError(`--var 需要 k=v 格式（收到 "${kv}"）`);
    out[kv.slice(0, idx)] = kv.slice(idx + 1);
  }
  return out;
}

// 直接运行入口；bin/steno.mjs 只是加载本模块
try {
  await main();
} catch (e) {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
