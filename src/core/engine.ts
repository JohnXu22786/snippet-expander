/**
 * engine.ts — 展开引擎
 *
 * 将消息中的 #标签 递归替换为片段正文：
 *   - 标签按注册表解析（含别名）；
 *   - 片段正文中的标签会继续展开（组合能力）；
 *   - 具备三项防护：循环检测（同一标签不得在展开链中重复出现）、
 *     最大嵌套深度、总展开次数上限；
 *   - 代码区域（围栏/行内）与转义标签 \# 不参与展开；
 *   - 展开完成后统一解析 {{变量}} 占位符。
 */

import { scan, computeCodeMask } from './matcher.ts';
import { resolvePlaceholders } from './placeholders.ts';
import { normalizeTagName } from '../store/library.ts';

/** 引擎只依赖正文，避免与存储层耦合 */
export interface Resolvable {
  body: string;
}

export type FragmentResolver = (name: string) => Resolvable | undefined;

export interface EngineOptions {
  resolve: FragmentResolver;
  /** 最大嵌套深度，默认 8 */
  maxDepth?: number;
  /** 单次展开允许的替换总次数上限，默认 200 */
  maxExpansions?: number;
  /** 是否跳过代码区域，默认 true */
  skipCode?: boolean;
  /** 未提供值且无默认值的占位符是否保留，默认 true */
  keepUnknown?: boolean;
}

export interface ExpansionResult {
  text: string;
  /** 实际展开的标签名（去重，按首次展开顺序） */
  touched: string[];
  /** 未解析的占位符名称 */
  unresolved: string[];
  warnings: string[];
  /** 实际替换次数 */
  expansions: number;
}

interface RenderState {
  count: number;
  /** 已展开标签的归一化名（去重，保持首次展开顺序） */
  touched: Set<string>;
  warnings: string[];
  limitWarned: boolean;
}

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_EXPANSIONS = 200;

export class ExpansionEngine {
  private readonly resolve: FragmentResolver;
  private readonly maxDepth: number;
  private readonly maxExpansions: number;
  private readonly skipCode: boolean;
  private readonly keepUnknown: boolean;

  constructor(opts: EngineOptions) {
    this.resolve = opts.resolve;
    this.maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxExpansions = opts.maxExpansions ?? DEFAULT_MAX_EXPANSIONS;
    this.skipCode = opts.skipCode ?? true;
    this.keepUnknown = opts.keepUnknown ?? true;
  }

  expand(
    input: string,
    opts: { variables?: Record<string, string> } = {},
  ): ExpansionResult {
    const variables = opts.variables ?? {};
    const state: RenderState = {
      count: 0,
      touched: new Set(),
      warnings: [],
      limitWarned: false,
    };
    const rendered = this.render(input, [], state, variables);
    // 最终文本重新计算代码掩码：占位符解析与标签展开共用同一套代码保护
    const mask = computeCodeMask(rendered, this.skipCode);
    const ph = resolvePlaceholders(rendered, variables, {
      keepUnknown: this.keepUnknown,
      masked: mask,
    });
    return {
      text: ph.text,
      touched: [...state.touched],
      unresolved: ph.unresolved,
      warnings: state.warnings,
      expansions: state.count,
    };
  }

  private render(
    input: string,
    stack: string[],
    state: RenderState,
    variables: Record<string, string>,
  ): string {
    const { tags, escapes } = scan(input, { skipCode: this.skipCode });
    let out = '';
    let pos = 0;
    let ti = 0;
    let ei = 0;

    while (pos < input.length) {
      const nextTag = tags[ti];
      const nextEsc = escapes[ei];
      const tagAt = nextTag?.start ?? Number.POSITIVE_INFINITY;
      const escAt = nextEsc?.start ?? Number.POSITIVE_INFINITY;
      const at = Math.min(tagAt, escAt);
      if (at === Number.POSITIVE_INFINITY) {
        out += input.slice(pos);
        break;
      }
      out += input.slice(pos, at);

      if (at === escAt) {
        // 转义：输出字面量 "#name"，不展开
        const esc = nextEsc!;
        out += '#' + esc.name;
        pos = esc.end;
        ei++;
        continue;
      }

      const tag = nextTag!;
      pos = tag.end;
      ti++;
      const key = normalizeTagName(tag.name);
      const frag = this.resolve(tag.name);
      if (!frag) {
        out += '#' + tag.name;
        continue;
      }
      if (stack.includes(key)) {
        state.warnings.push(`expansion loop detected at #${tag.name}, left as literal`);
        out += '#' + tag.name;
        continue;
      }
      if (stack.length + 1 > this.maxDepth) {
        state.warnings.push(`max depth (${this.maxDepth}) exceeded at #${tag.name}, left as literal`);
        out += '#' + tag.name;
        continue;
      }
      if (state.count + 1 > this.maxExpansions) {
        if (!state.limitWarned) {
          state.limitWarned = true;
          state.warnings.push(
            `expansion limit (${this.maxExpansions}) reached, further tags left as literal`,
          );
        }
        out += '#' + tag.name;
        continue;
      }
      state.count++;
      state.touched.add(key);
      out += this.render(frag.body, [...stack, key], state, variables);
    }

    return out;
  }
}
