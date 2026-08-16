/**
 * index.ts — 插件入口
 *
 * 宿主（dsh harness）加载方式（详见 README）：
 *
 *   const mod = await import(entryPath);          // entry = dist/index.js
 *   const plugin = await mod.createPlugin({ config, logger });
 *   // 或使用默认导出：const plugin = await mod.default({ config });
 *
 * 返回的实例：
 *   {
 *     id: 'steno',
 *     hooks: { 'message.beforeSend': handler },   // 事件接口
 *     tools: [...],                                // 工具接口
 *     registry, engine, config, warnings, dispose()
 *   }
 */

import { FragmentRegistry } from './store/registry.ts';
import { ExpansionEngine } from './core/engine.ts';
import { resolveConfig, type ResolvedConfig, type StenoConfig } from './config.ts';
import { createMessageHook, type EventHandler, type MessageContext } from './plugin/hooks.ts';
import { buildTools, type ToolDef } from './plugin/tools.ts';

export const PLUGIN_ID = 'steno';
export const PLUGIN_NAME = 'Steno';
export const PLUGIN_VERSION = '1.0.0';

export interface StenoLogger {
  info?(msg: string): void;
  warn?(msg: string): void;
  error?(msg: string): void;
}

export interface PluginOptions {
  config?: StenoConfig;
  /** 项目目录（用于自动发现片段库），默认 process.cwd() */
  cwd?: string;
  logger?: StenoLogger;
}

export interface StenoPlugin {
  id: string;
  name: string;
  version: string;
  hooks: Record<string, EventHandler>;
  tools: ToolDef[];
  config: ResolvedConfig;
  /** 加载期间的告警（跳过/遮蔽等） */
  warnings: string[];
  registry: FragmentRegistry;
  engine: ExpansionEngine;
  dispose(): Promise<void>;
}

export async function createPlugin(options: PluginOptions = {}): Promise<StenoPlugin> {
  const { config: resolved, warnings } = await resolveConfig(options.config, options.cwd);

  const registry = new FragmentRegistry(resolved.libraries, {
    defaultLibrary: resolved.defaultLibrary,
  });
  const report = await registry.loadAll();
  warnings.push(...report.warnings);

  const engine = new ExpansionEngine({
    resolve: (name) => registry.resolve(name),
    maxDepth: resolved.maxDepth,
    maxExpansions: resolved.maxExpansions,
    skipCode: resolved.skipCode,
    keepUnknown: resolved.keepUnknown,
  });

  const logger = options.logger;
  for (const w of warnings) logger?.warn?.(`[steno] ${w}`);

  const instance: StenoPlugin = {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    hooks: { 'message.beforeSend': createMessageHook(engine) },
    tools: buildTools({ registry, engine }),
    config: resolved,
    warnings,
    registry,
    engine,
    async dispose() {
      // 无后台资源，无需清理
    },
  };
  return instance;
}

export default createPlugin;

// ---------------------------------------------------------------------------
// dsh（Cordis bundle）入口
//
// package.json 的 dsh.bundle.patch 指向 cordis.patch.yml，dsh 安装插件行时以
// Cordis 插件方式加载本模块：导出 name / inject / apply(ctx, rowConfig)。
// apply 复用 createPlugin()：把 5 个 steno 工具转换为 dsh 的 ToolDefinition
// 注册到 ctx.tools，并把 message.beforeSend 钩子接到 harness（若发出同名事件）。
// ---------------------------------------------------------------------------

export const name = 'dsh-steno';

/** 依赖 dsh 提供的工具注册服务（无 tools 时插件不加载）。 */
export const inject = ['tools'];

export interface DshToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: { schema: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
}

/** dsh 的 Cordis Context 所需字段的松散形态。 */
export interface DshHarnessContext {
  tools?: { register(def: DshToolDefinition): unknown };
  logger?: StenoLogger;
  on?(name: string, handler: (payload: unknown) => unknown): unknown;
  effect?(fn: () => void): void;
}

export function apply(ctx: DshHarnessContext, config: StenoConfig = {}): () => void {
  const disposers: Array<() => void> = [];
  const logger = ctx.logger;

  void createPlugin({ config, logger })
    .then((plugin) => {
      for (const tool of plugin.tools) {
        const ret = ctx.tools?.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema ?? { type: 'object', properties: {} },
          output: { schema: { type: 'object', additionalProperties: true } },
          execute: async (args: Record<string, unknown>): Promise<unknown> =>
            tool.run((args ?? {}) as Record<string, unknown>),
        });
        if (typeof ret === 'function') disposers.push(ret as () => void);
      }
      const beforeSend = plugin.hooks['message.beforeSend'];
      if (beforeSend && typeof ctx.on === 'function') {
        const off = ctx.on('message.beforeSend', (payload: unknown) => beforeSend(payload as MessageContext));
        if (typeof off === 'function') disposers.push(off as () => void);
      }
      logger?.info?.(
        `[steno] ${plugin.name} v${plugin.version} 就绪：${plugin.tools.length} 个工具 + message.beforeSend 钩子`,
      );
    })
    .catch((err: unknown) => {
      logger?.error?.(
        `[steno] 初始化失败：${err instanceof Error ? err.message : String(err)}`,
      );
    });

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      for (const dispose of disposers) dispose();
    });
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
}

export type { EventHandler, MessageContext, HookOutput } from './plugin/hooks.ts';
export type { ToolDef } from './plugin/tools.ts';
export type {
  StenoConfig,
  ResolvedConfig,
} from './config.ts';
export type {
  FragmentEntry,
  LibraryFile,
} from './store/library.ts';
export { FragmentRegistry, RegistryError } from './store/registry.ts';
export type {
  LoadReport,
  SearchHit,
  FlatEntry,
  RegistryOptions,
} from './store/registry.ts';
export { ExpansionEngine } from './core/engine.ts';
export type {
  Resolvable,
  FragmentResolver,
  EngineOptions,
  ExpansionResult,
} from './core/engine.ts';
export { scan } from './core/matcher.ts';
export type { TagOccurrence, EscapedTag, ScanResult } from './core/matcher.ts';
export { findPlaceholders, resolvePlaceholders } from './core/placeholders.ts';
export type { PlaceholderSpec, PlaceholderResult } from './core/placeholders.ts';
export {
  parseLibrary,
  loadLibraryFile,
  serializeLibrary,
  writeLibraryFile,
  isValidTagName,
  normalizeTagName,
  LibraryFormatError,
} from './store/library.ts';
export { resolveConfig, expandPath } from './config.ts';
