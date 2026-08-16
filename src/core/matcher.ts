/**
 * matcher.ts — 标签扫描器
 *
 * 在文本中定位所有候选 "#标签" 出现位置，同时标记代码区域（围栏代码块、
 * 行内代码）、占位符区域（{{...}}）与转义标签（\#标签）。
 * 展开引擎根据扫描结果决定替换哪些位置。
 *
 * 标签命名规则：
 *   - 以任意语言字母开头（ASCII / CJK / 其他 Unicode 字母）
 *   - 后续字符可为字母、数字、下划线、连字符
 *   - 查找时大小写不敏感（统一归一化为小写）
 *
 * 识别边界：
 *   - 前一个字符不能是 ASCII 字母/数字/_/-/#（防 "foo#tag"、"##tag"）
 *     ——中文等无空格书写习惯的文本中 #tag 紧贴中文字符是正常用法
 *   - 前一个字符不能是反斜杠（防 "\#tag"，由转义逻辑处理）
 *   - "#" 后必须紧跟字母（防 "#123"、markdown 标题 "# 标题"）
 */

export interface TagOccurrence {
  /** "#" 的索引 */
  start: number;
  /** 标签名最后一个字符之后的索引 */
  end: number;
  name: string;
}

export interface EscapedTag {
  /** 反斜杠的索引 */
  start: number;
  end: number;
  name: string;
}

/** {{...}} 占位符区域：内部标签不参与展开（区域内容按字面量处理） */
export interface PlaceholderSpan {
  start: number;
  end: number;
}

export interface ScanResult {
  tags: TagOccurrence[];
  escapes: EscapedTag[];
  spans: PlaceholderSpan[];
}

export interface ScanOptions {
  /** 是否跳过代码区域中的标签，默认 true */
  skipCode?: boolean;
}

const NAME_START = /[\p{L}]/u;
const NAME_CHAR = /[\p{L}\p{N}_-]/u;
// 边界检查只针对 ASCII 字符：中文等无空格书写习惯的文本中 #tag 紧贴中文字符是正常用法，
// 但 "foo#tag"（英文词粘连）或 "##tag" 不是标签。
const ASCII_BOUNDARY_BLOCK = /[A-Za-z0-9_#-]/;

function isLineStart(text: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r')) j--;
  return j < 0 || text[j] === '\n';
}

/**
 * 查找从 from 开始的第一个合法闭合围栏（行首 + 同字符 run 长度 ≥ minLen + 行尾无内容），
 * 返回闭合围栏所在行的行尾索引（不含换行）；找不到返回 -1。
 * 注意：闭合围栏必须从下一行开始，开启行剩余部分的同字符 run 不是闭合围栏。
 */
function findClosingFence(
  text: string,
  from: number,
  ch: string,
  minLen: number,
): number {
  const n = text.length;
  // 跳过开启围栏所在行的剩余部分
  const nl = text.indexOf('\n', from);
  let i = nl === -1 ? n : nl + 1;
  while (i < n) {
    const lineStart = i;
    while (i < n && text[i] !== '\n') i++;
    const lineEnd = i;
    // 行首仅允许空白（含 CRLF 的 \r）
    let j = lineStart;
    while (j < lineEnd && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r')) j++;
    if (j < lineEnd && text[j] === ch) {
      let run = 1;
      while (j + run < lineEnd && text[j + run] === ch) run++;
      if (run >= minLen) {
        // 闭合围栏之后该行只能有空白
        let k = j + run;
        while (k < lineEnd && (text[k] === ' ' || text[k] === '\t' || text[k] === '\r')) k++;
        if (k === lineEnd) return lineEnd;
      }
    }
    if (i < n) i++; // 跳过换行
  }
  return -1;
}

/**
 * 预计算每个位置是否处于代码区域（true = 屏蔽）。
 *
 * 围栏规则（与 CommonMark 对齐）：
 *   - 开启围栏必须位于行首（前面只有空白）；
 *   - 闭合围栏必须位于行首、同字符且长度 ≥ 开启长度、其后只有空白；
 *   - 未找到闭合围栏时按普通文本处理（避免未闭合围栏屏蔽整段消息）。
 */
export function computeCodeMask(text: string, skipCode: boolean): boolean[] {
  const n = text.length;
  const masked = new Array<boolean>(n).fill(false);
  if (!skipCode) return masked;

  // 第一遍：围栏代码块（``` 或 ~~~，≥3 个相同字符）
  let i = 0;
  while (i < n) {
    const ch = text[i]!;
    if ((ch === '`' || ch === '~') && isLineStart(text, i)) {
      let run = 1;
      while (i + run < n && text[i + run] === ch) run++;
      if (run >= 3) {
        const closeEnd = findClosingFence(text, i + run, ch, run);
        if (closeEnd >= 0) {
          for (let k = i; k < closeEnd; k++) masked[k] = true;
          i = closeEnd + 1; // 跳过行尾换行
          continue;
        }
        i += run;
        continue;
      }
    }
    i++;
  }

  // 第二遍：行内代码（1~2 个反引号包围，且同长度闭合）
  i = 0;
  while (i < n) {
    if (text[i] === '`' && !masked[i]) {
      let run = 1;
      while (i + run < n && text[i + run] === '`') run++;
      if (run <= 2) {
        let j = i + run;
        while (j < n && text[j] !== '\n') {
          if (text[j] === '`') {
            let closeRun = 1;
            while (j + closeRun < n && text[j + closeRun] === '`') closeRun++;
            if (closeRun === run) {
              for (let k = i; k < j + closeRun; k++) masked[k] = true;
              i = j + closeRun;
              break;
            }
            j += closeRun;
          } else {
            j++;
          }
        }
        if (j >= n || text[j] === '\n') i += run; // 同一行内未闭合，按普通文本处理
        continue;
      }
    }
    i++;
  }

  return masked;
}

/**
 * 扫描文本中的候选标签、转义标签与占位符区域。
 */
export function scan(text: string, opts: ScanOptions = {}): ScanResult {
  const n = text.length;
  const codeMask = computeCodeMask(text, opts.skipCode !== false);

  // 占位符区域：{{ ... }}（\{{ 转义不算；未闭合按普通文本处理）
  const spanMask = new Array<boolean>(n).fill(false);
  const spans: PlaceholderSpan[] = [];
  for (let i = 0; i < n; i++) {
    if (codeMask[i]) continue;
    if (text[i] === '{' && text[i + 1] === '{' && (i === 0 || text[i - 1] !== '\\')) {
      const close = text.indexOf('}}', i + 2);
      if (close >= 0) {
        for (let k = i; k < close + 2; k++) spanMask[k] = true;
        spans.push({ start: i, end: close + 2 });
        i = close + 1;
      }
    }
  }

  const masked = (idx: number): boolean => codeMask[idx] === true || spanMask[idx] === true;
  const tags: TagOccurrence[] = [];
  const escapes: EscapedTag[] = [];

  for (let i = 0; i < n; i++) {
    if (masked(i)) continue;
    const ch = text[i]!;

    // 转义标签：\# + 字母
    if (ch === '\\' && text[i + 1] === '#' && i + 2 < n && NAME_START.test(text[i + 2]!)) {
      let j = i + 2;
      while (j < n && NAME_CHAR.test(text[j]!)) j++;
      escapes.push({ start: i, end: j, name: text.slice(i + 2, j) });
      continue;
    }

    if (ch !== '#') continue;
    if (i > 0) {
      const prev = text[i - 1]!;
      if (prev === '\\' || ASCII_BOUNDARY_BLOCK.test(prev)) continue;
    }
    const next = text[i + 1];
    if (next === undefined || !NAME_START.test(next)) continue;

    let j = i + 2;
    while (j < n && NAME_CHAR.test(text[j]!)) j++;
    tags.push({ start: i, end: j, name: text.slice(i + 1, j) });
  }

  return { tags, escapes, spans };
}
