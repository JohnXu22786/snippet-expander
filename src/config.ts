/**
 * config.ts — 插件配置解析
 *
 * 配置由宿主（dsh harness）传入；未显式给出片段库路径时，
 * 依次尝试环境变量 DSH_STENO_LIBRARIES（用分号分隔）与自动发现：
 *   <项目目录>/.dsh/steno/*.yaml、<用户目录>/.dsh/steno/*.yaml
 *
 * 路径支持 "~" 与 "${VAR}" 展开。
 */

import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface StenoConfig {
  /** 片段库文件路径列表，顺序即优先级（先者优先） */
  libraries?: string[];
  /** steno.save 默认写入的库名 */
  defaultLibrary?: string;
  /** 最大嵌套深度，默认 8 */
  maxDepth?: number;
  /** 单次展开替换次数上限，默认 200 */
  maxExpansions?: number;
  /** 是否跳过代码区域中的标签，默认 true */
  skipCode?: boolean;
  /** 未提供值且无默认值的占位符是否保留原文，默认 true */
  keepUnknown?: boolean;
}

export interface ResolvedConfig {
  /** 绝对路径 */
  libraries: string[];
  defaultLibrary?: string;
  maxDepth: number;
  maxExpansions: number;
  skipCode: boolean;
  keepUnknown: boolean;
  /** 片段库来源：显式配置 / 环境变量 / 自动发现 */
  origin: 'config' | 'env' | 'discovered' | 'none';
}

const DEFAULTS = {
  maxDepth: 8,
  maxExpansions: 200,
  skipCode: true,
  keepUnknown: true,
};

/**
 * 展开路径中的 "~" 与 "${VAR}"。
 * 规则：仅展开 "~" 与 "~/..."；"~user/..." 保持原样（交由系统解析）；
 * 未定义的 ${VAR} 保持字面量，避免静默解析到错误位置。
 */
export function expandPath(p: string): string {
  let out = p.trim();
  if (out === '~') {
    out = homedir();
  } else if (out.startsWith('~/') || out.startsWith('~\\')) {
    out = join(homedir(), out.slice(1).replace(/\\/g, '/'));
  }
  out = out.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => process.env[name] ?? `\${${name}}`,
  );
  return out;
}

async function discoverLibraries(cwd: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const candidates = [join(cwd, '.dsh', 'steno'), join(homedir(), '.dsh', 'steno')];
  for (const dir of candidates) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue; // 目录不存在
    }
    const libs = names
      .filter((n) => /\.ya?ml$/i.test(n))
      .sort()
      .map((n) => join(dir, n));
    for (const lib of libs) {
      if (seen.has(lib)) continue; // cwd 与用户目录相同时避免重复加载
      seen.add(lib);
      out.push(lib);
    }
  }
  return out;
}

export async function resolveConfig(
  input: StenoConfig = {},
  cwd: string = process.cwd(),
): Promise<{ config: ResolvedConfig; warnings: string[] }> {
  const warnings: string[] = [];
  let libraries: string[] | undefined = input.libraries;
  let origin: ResolvedConfig['origin'] = 'config';

  if (!libraries || libraries.length === 0) {
    const env = process.env.DSH_STENO_LIBRARIES;
    if (env) {
      libraries = env
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      origin = 'env';
    }
  }
  if (!libraries || libraries.length === 0) {
    libraries = await discoverLibraries(cwd);
    origin = libraries.length > 0 ? 'discovered' : 'none';
  }

  return {
    config: {
      libraries: libraries
        .map((p) => expandPath(p))
        .filter(Boolean)
        .map((p) => resolve(p)),
      defaultLibrary: input.defaultLibrary,
      maxDepth: input.maxDepth ?? DEFAULTS.maxDepth,
      maxExpansions: input.maxExpansions ?? DEFAULTS.maxExpansions,
      skipCode: input.skipCode ?? DEFAULTS.skipCode,
      keepUnknown: input.keepUnknown ?? DEFAULTS.keepUnknown,
      origin,
    },
    warnings,
  };
}
