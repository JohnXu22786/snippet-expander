/**
 * library.ts — 片段库文件格式
 *
 * 片段库为 YAML 文件，结构如下：
 *
 *   name: core              # 库名（缺省时取文件名）
 *   description: 说明        # 可选
 *   entries:                # 片段列表
 *     - tag: focus          # 触发标签（必填，字母开头，可含字母/数字/_/-）
 *       aliases: [careful]  # 可选：别名（单字符串或字符串列表）
 *       description: 说明    # 可选
 *       body: |             # 正文（必填：字符串 / 多行字符串 / 行列表）
 *         多行内容...
 *
 * 解析失败会抛出 LibraryFormatError，其中包含全部问题的清单，
 * 便于用户一次性修正。
 */

import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import yaml from 'js-yaml';

export interface FragmentEntry {
  tag: string;
  aliases: string[];
  description?: string;
  body: string;
}

export interface LibraryFile {
  /** 磁盘上的绝对或相对路径 */
  path: string;
  name: string;
  description?: string;
  entries: FragmentEntry[];
}

export class LibraryFormatError extends Error {
  readonly path: string;
  readonly issues: string[];

  constructor(path: string, issues: string[]) {
    super(`library file "${path}" is invalid: ${issues.join('; ')}`);
    this.name = 'LibraryFormatError';
    this.path = path;
    this.issues = issues;
  }
}

/** 标签名：以字母开头（含 CJK），后续为字母/数字/_/- */
export const TAG_NAME_RE = /^[\p{L}][\p{L}\p{N}_-]*$/u;
const MAX_TAG_LENGTH = 64;

export function isValidTagName(tag: string): boolean {
  return tag.length > 0 && tag.length <= MAX_TAG_LENGTH && TAG_NAME_RE.test(tag);
}

/** 标签归一化：去首尾空白并转为小写（查找时大小写不敏感） */
export function normalizeTagName(tag: string): string {
  return tag.trim().toLowerCase();
}

function stripExt(path: string): string {
  return basename(path).replace(/\.(ya?ml|json)$/i, '');
}

function asEntries(raw: unknown, path: string): LibraryFile {
  const issues: string[] = [];
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LibraryFormatError(path, ['top level must be a mapping with an "entries" list']);
  }
  const map = raw as Record<string, unknown>;
  const entriesRaw = map['entries'];
  if (!Array.isArray(entriesRaw)) {
    throw new LibraryFormatError(path, ['missing "entries" list']);
  }

  const seen = new Set<string>();
  const entries: FragmentEntry[] = [];
  const describe = (i: number, tag?: string) => `entry #${i + 1}${tag ? ` ("${tag}")` : ''}`;

  for (let i = 0; i < entriesRaw.length; i++) {
    const e = entriesRaw[i];
    const label = describe(i);
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      issues.push(`${label} must be a mapping`);
      continue;
    }
    const em = e as Record<string, unknown>;

    const tagRaw = em['tag'];
    if (typeof tagRaw !== 'string') {
      issues.push(`${label}: missing "tag"`);
      continue;
    }
    const tag = normalizeTagName(tagRaw);
    if (!isValidTagName(tag)) {
      issues.push(`${label}: invalid tag name "${tagRaw}" (must start with a letter; letters/digits/_/- only, max ${MAX_TAG_LENGTH} chars)`);
      continue;
    }
    if (seen.has(tag)) {
      issues.push(`${label}: duplicate tag "${tag}" in the same library`);
      continue;
    }
    seen.add(tag);
    const entryLabel = describe(i, tag);

    const bodyRaw = em['body'];
    let body: string;
    if (typeof bodyRaw === 'string') {
      body = bodyRaw;
    } else if (Array.isArray(bodyRaw) && bodyRaw.every((x) => typeof x === 'string')) {
      body = bodyRaw.join('\n');
    } else if (typeof bodyRaw === 'number') {
      body = String(bodyRaw);
    } else {
      issues.push(
        `${entryLabel}: "body" must be a string or a list of strings (数字/布尔值请加引号)`,
      );
      continue;
    }

    const aliases = normalizeAliases(em['aliases'], entryLabel, issues);
    const desc = em['description'];
    if (desc !== undefined && typeof desc !== 'string') {
      issues.push(`${entryLabel}: "description" must be a string`);
    }

    entries.push({
      tag,
      aliases,
      ...(typeof desc === 'string' ? { description: desc } : {}),
      body,
    });
  }

  if (issues.length > 0) throw new LibraryFormatError(path, issues);

  const nameRaw = map['name'];
  const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : stripExt(path);
  const desc = map['description'];
  return {
    path,
    name,
    ...(typeof desc === 'string' ? { description: desc } : {}),
    entries,
  };
}

function normalizeAliases(
  raw: unknown,
  label: string,
  issues: string[],
): string[] {
  if (raw === undefined) return [];
  const list = typeof raw === 'string' ? [raw] : raw;
  if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) {
    issues.push(`${label}: "aliases" must be a string or a list of strings`);
    return [];
  }
  const out: string[] = [];
  for (const a of list as string[]) {
    const norm = normalizeTagName(a);
    if (!isValidTagName(norm)) {
      issues.push(`${label}: invalid alias "${a}"`);
      continue;
    }
    if (!out.includes(norm)) out.push(norm);
  }
  return out;
}

/** 解析 YAML 文本为片段库（失败抛 LibraryFormatError） */
export function parseLibrary(text: string, path: string): LibraryFile {
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch (e) {
    throw new LibraryFormatError(path, [
      `YAML syntax error: ${e instanceof Error ? e.message : String(e)}`,
    ]);
  }
  return asEntries(doc, path);
}

/** 从磁盘读取并解析片段库 */
export async function loadLibraryFile(path: string): Promise<LibraryFile> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    throw new LibraryFormatError(path, [
      `cannot read file: ${e instanceof Error ? e.message : String(e)}`,
    ]);
  }
  return parseLibrary(text, path);
}

/** 将片段库序列化为 YAML 文本（工具编辑后格式会规范化） */
export function serializeLibrary(lib: LibraryFile): string {
  const doc: Record<string, unknown> = { name: lib.name };
  if (lib.description !== undefined) doc['description'] = lib.description;
  doc['entries'] = lib.entries.map((e) => {
    const item: Record<string, unknown> = { tag: e.tag };
    if (e.aliases.length > 0) {
      item['aliases'] = e.aliases.length === 1 ? e.aliases[0] : [...e.aliases];
    }
    if (e.description !== undefined) item['description'] = e.description;
    item['body'] = e.body;
    return item;
  });
  return yaml.dump(doc, { noRefs: true, lineWidth: 120, indent: 2, quotingType: '"' });
}

/** 将片段库写回磁盘（自动创建父目录；先写临时文件再重命名，保证原子性） */
export async function writeLibraryFile(lib: LibraryFile): Promise<void> {
  await mkdir(dirname(lib.path), { recursive: true });
  const tmp = lib.path + '.tmp';
  await writeFile(tmp, serializeLibrary(lib), 'utf8');
  try {
    await rename(tmp, lib.path);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}
