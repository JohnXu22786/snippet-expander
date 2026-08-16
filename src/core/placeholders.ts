/**
 * placeholders.ts — 变量占位符
 *
 * 片段正文与消息中均可使用 {{name}} 与 {{name:默认值}} 形式的占位符：
 *   - 提供了同名变量时，替换为变量值；
 *   - 未提供变量但写了默认值时，替换为默认值；
 *   - 两者皆无时，默认保留原文并记录未解析名单（可配置为删除）。
 *
 * 使用 \{{ 转义，输出字面量 "{{"（反斜杠被移除）。
 * 解析过程使用 matchAll 在原文上迭代，偏移量始终与原文（及 masked 掩码）对齐。
 */

export interface PlaceholderSpec {
  name: string;
  defaultValue?: string;
}

export interface PlaceholderOptions {
  /** 未提供值且无默认值时是否保留原文，默认 true */
  keepUnknown?: boolean;
  /** 为 true 的位置（如代码区域）不参与解析，按原文保留 */
  masked?: boolean[];
}

export interface PlaceholderResult {
  text: string;
  /** 未解析成功的占位符名称（按出现顺序） */
  unresolved: string[];
}

const PH_RE = /\{\{\s*([\p{L}\p{N}_.\-]+?)(?:\s*:\s*([^}]*?))?\s*\}\}/gu;

/**
 * 找出文本中的占位符（跳过 \{{ 转义的）。
 */
export function findPlaceholders(text: string): PlaceholderSpec[] {
  const out: PlaceholderSpec[] = [];
  for (const m of text.matchAll(PH_RE)) {
    if (m.index !== undefined && m.index > 0 && text[m.index - 1] === '\\') continue;
    out.push({ name: m[1]!, defaultValue: m[2] });
  }
  return out;
}

/**
 * 解析文本中的占位符。
 */
export function resolvePlaceholders(
  text: string,
  variables: Record<string, string>,
  opts: PlaceholderOptions = {},
): PlaceholderResult {
  const keepUnknown = opts.keepUnknown !== false;
  const masked = opts.masked;
  const unresolved: string[] = [];

  let out = '';
  let pos = 0;
  for (const m of text.matchAll(PH_RE)) {
    const offset = m.index!;
    const full = m[0];

    // 转义 \{{...}}：去掉反斜杠，输出字面量，不参与解析
    if (offset > 0 && text[offset - 1] === '\\') {
      out += text.slice(pos, offset - 1) + full;
      pos = offset + full.length;
      continue;
    }
    // 代码区域等掩码位置：原样保留
    if (masked?.[offset]) {
      out += text.slice(pos, offset + full.length);
      pos = offset + full.length;
      continue;
    }

    const name = m[1]!;
    const def = m[2];
    const value = variables[name];
    let replacement: string;
    if (value !== undefined) {
      replacement = value;
    } else if (def !== undefined) {
      replacement = def;
    } else {
      unresolved.push(name);
      replacement = keepUnknown ? full : '';
    }
    out += text.slice(pos, offset) + replacement;
    pos = offset + full.length;
  }
  out += text.slice(pos);

  return { text: out, unresolved };
}
