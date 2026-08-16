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
import { createMessageHook, type EventHandler } from './plugin/hooks.ts';
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
