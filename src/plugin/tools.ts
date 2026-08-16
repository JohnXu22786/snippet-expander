/**
 * tools.ts — 供宿主暴露给模型的工具（LLM 可调用）
 *
 * steno.list     列出片段
 * steno.search   搜索片段（含别名/描述/正文相关度排序）
 * steno.expand   展开任意文本中的 #标签
 * steno.save     新增或更新片段（持久化到库文件）
 * steno.remove   删除片段
 */

import type { FragmentRegistry } from '../store/registry.ts';
import type { ExpansionEngine } from '../core/engine.ts';

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema（draft-07 子集） */
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

export class ToolInputError extends Error {}

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new ToolInputError(`"${name}" must be a non-empty string`);
  }
  return v;
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function optionalStringList(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new ToolInputError('"aliases" must be a list of strings');
  }
  return v as string[];
}

function optionalVarMap(v: unknown): Record<string, string> | undefined {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new ToolInputError('"variables" must be a mapping of name to string');
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== 'string') {
      throw new ToolInputError(`"variables.${k}" must be a string`);
    }
    out[k] = val;
  }
  return out;
}

function clampLimit(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

export function buildTools(deps: {
  registry: FragmentRegistry;
  engine: ExpansionEngine;
}): ToolDef[] {
  const { registry, engine } = deps;

  return [
    {
      name: 'steno.list',
      description:
        '列出片段库中的全部片段（标签、别名、描述、正文）。可用 library 参数只看某个库。',
      inputSchema: {
        type: 'object',
        properties: {
          library: { type: 'string', description: '库名，缺省列出全部库' },
        },
      },
      run: async (args) => {
        return registry.list(optionalString(args.library));
      },
    },

    {
      name: 'steno.search',
      description:
        '按相关度搜索片段：匹配标签、别名、描述与正文，返回前若干条及其所属库。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索词' },
          limit: { type: 'integer', description: '返回条数上限，默认 10，最大 50' },
        },
        required: ['query'],
      },
      run: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = clampLimit(args.limit, 10, 1, 50);
        return registry.search(query, { limit });
      },
    },

    {
      name: 'steno.expand',
      description:
        '把文本中的 #标签 展开为片段正文（含递归展开与占位符解析），并返回展开结果、涉及的标签、警告与未解析占位符。',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '待展开的文本' },
          variables: {
            type: 'object',
            description: '占位符变量，如 {"topic": "发布计划"}',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['text'],
      },
      run: async (args) => {
        const text = requireString(args.text, 'text');
        const variables = optionalVarMap(args.variables);
        const r = engine.expand(text, { variables });
        return {
          text: r.text,
          touched: r.touched,
          expansions: r.expansions,
          unresolved: r.unresolved,
          warnings: r.warnings,
        };
      },
    },

    {
      name: 'steno.save',
      description:
        '新增或更新一个片段并持久化到库文件。标签已存在则原地更新；aliases 与 description 仅在提供时更新。',
      inputSchema: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: '触发标签（字母开头，可含字母/数字/_/-）' },
          body: { type: 'string', description: '展开正文，可含 {{变量}} 与 #其他标签' },
          aliases: {
            type: 'array',
            items: { type: 'string' },
            description: '可选别名列表',
          },
          description: { type: 'string', description: '可选说明' },
          library: { type: 'string', description: '目标库名，缺省写入默认库' },
        },
        required: ['tag', 'body'],
      },
      run: async (args) => {
        const tag = requireString(args.tag, 'tag');
        const body = requireString(args.body, 'body');
        return registry.add(tag, body, {
          library: optionalString(args.library),
          aliases: optionalStringList(args.aliases),
          description: optionalString(args.description),
        });
      },
    },

    {
      name: 'steno.remove',
      description: '删除一个片段并持久化；未指定 library 时在所有库中查找。返回是否删除成功。',
      inputSchema: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: '要删除的标签' },
          library: { type: 'string', description: '库名，缺省在所有库中查找' },
        },
        required: ['tag'],
      },
      run: async (args) => {
        const tag = requireString(args.tag, 'tag');
        const library = optionalString(args.library);
        return registry.remove(tag, library ? { library } : {});
      },
    },
  ];
}
