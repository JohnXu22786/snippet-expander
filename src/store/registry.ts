/**
 * registry.ts — 片段库注册表
 *
 * 管理多个片段库的加载、查找、搜索与增删改：
 *   - 按配置顺序加载，先声明的库优先（同名标签/别名取先到者，后者告警）；
 *   - 标签与别名统一小写归一化后建索引；
 *   - steno.save / steno.remove 会把修改持久化回库文件。
 */

import { loadLibraryFile, writeLibraryFile, normalizeTagName, isValidTagName } from './library.ts';
import type { FragmentEntry, LibraryFile } from './library.ts';

export interface RegistryOptions {
  /** steno.save 默认写入的库名 */
  defaultLibrary?: string;
}

export interface LoadReport {
  loaded: LibraryFile[];
  skipped: Array<{ path: string; reason: string }>;
  warnings: string[];
}

export interface SearchHit {
  entry: FragmentEntry;
  library: string;
  score: number;
}

export interface FlatEntry {
  library: string;
  tag: string;
  aliases: string[];
  description?: string;
  body: string;
}

export class RegistryError extends Error {}

interface IndexEntry {
  entry: FragmentEntry;
  library: LibraryFile;
}

export class FragmentRegistry {
  private readonly paths: string[];
  private readonly defaultLibrary?: string;
  private loadedLibs: LibraryFile[] = [];
  private index = new Map<string, IndexEntry>();
  private report: LoadReport = { loaded: [], skipped: [], warnings: [] };

  constructor(paths: string[], opts: RegistryOptions = {}) {
    // 同一文件配置两次只加载一次
    this.paths = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
    this.defaultLibrary = opts.defaultLibrary;
  }

  /** 加载全部库文件并重建索引 */
  async loadAll(): Promise<LoadReport> {
    this.loadedLibs = [];
    this.index.clear();
    const report: LoadReport = { loaded: [], skipped: [], warnings: [] };

    for (const path of this.paths) {
      let lib: LibraryFile;
      try {
        lib = await loadLibraryFile(path);
      } catch (e) {
        report.skipped.push({ path, reason: e instanceof Error ? e.message : String(e) });
        continue;
      }
      report.loaded.push(lib);
      this.loadedLibs.push(lib);

      for (const entry of lib.entries) {
        this.claim(entry.tag, 'tag', entry, lib, report);
        for (const alias of entry.aliases) {
          this.claim(alias, 'alias', entry, lib, report);
        }
      }
    }

    this.report = report;
    return report;
  }

  private claim(
    name: string,
    kind: 'tag' | 'alias',
    entry: FragmentEntry,
    lib: LibraryFile,
    report: LoadReport,
  ): void {
    const key = normalizeTagName(name);
    const existing = this.index.get(key);
    if (existing) {
      const where =
        existing.library === lib
          ? `the same library`
          : `library "${existing.library.name}"`;
      report.warnings.push(
        `${kind} "#${key}" in library "${lib.name}" is shadowed by a definition in ${where}`,
      );
      return;
    }
    this.index.set(key, { entry, library: lib });
  }

  /** 按标签名或别名解析片段 */
  resolve(name: string): FragmentEntry | undefined {
    return this.index.get(normalizeTagName(name))?.entry;
  }

  has(name: string): boolean {
    return this.index.has(normalizeTagName(name));
  }

  /**
   * 按相关度搜索，按优先级分档（不叠加）：
   * 精确标签(100) > 精确别名(90) > 标签/别名前缀(60) > 描述包含(30) > 正文包含(10)
   */
  search(query: string, opts: { limit?: number } = {}): SearchHit[] {
    const q = query.trim().toLowerCase();
    const limit = opts.limit ?? 10;
    if (!q || limit <= 0) return [];
    const hits: SearchHit[] = [];
    for (const lib of this.loadedLibs) {
      for (const entry of lib.entries) {
        const tag = normalizeTagName(entry.tag);
        const aliases = entry.aliases.map(normalizeTagName);
        let score = 0;
        if (tag === q) {
          score = 100;
        } else if (aliases.includes(q)) {
          score = 90;
        } else if (tag.startsWith(q) || aliases.some((a) => a.startsWith(q))) {
          score = 60;
        } else if (entry.description?.toLowerCase().includes(q)) {
          score = 30;
        } else if (entry.body.toLowerCase().includes(q)) {
          score = 10;
        }
        if (score > 0) hits.push({ entry, library: lib.name, score });
      }
    }
    hits.sort(
      (a, b) => b.score - a.score || a.entry.tag.localeCompare(b.entry.tag),
    );
    return hits.slice(0, limit);
  }

  /** 平铺列出片段；指定库名时只列该库（库不存在则返回空列表） */
  list(libraryName?: string): FlatEntry[] {
    const libs = libraryName
      ? this.loadedLibs.filter((l) => l.name === libraryName)
      : this.loadedLibs;
    return libs.flatMap((lib) =>
      lib.entries.map((e) => ({
        library: lib.name,
        tag: e.tag,
        aliases: [...e.aliases],
        ...(e.description !== undefined ? { description: e.description } : {}),
        body: e.body,
      })),
    );
  }

  /** 已加载的库（返回副本，防止外部修改内部状态） */
  libraries(): LibraryFile[] {
    return this.loadedLibs.map((l) => ({
      ...l,
      entries: l.entries.map((e) => ({ ...e, aliases: [...e.aliases] })),
    }));
  }

  /**
   * 新增或更新片段并持久化。
   * aliases / description 仅在提供时更新（不提供则保留原值）。
   * 返回的 warnings 包含本次保存后实际生效情况的提示（如被更早库遮蔽）。
   */
  async add(
    tag: string,
    body: string,
    opts: { library?: string; aliases?: string[]; description?: string } = {},
  ): Promise<{
    library: string;
    tag: string;
    action: 'created' | 'updated';
    warnings: string[];
  }> {
    const norm = normalizeTagName(tag);
    if (!isValidTagName(norm)) throw new RegistryError(`invalid tag name "${tag}"`);
    const aliases = (opts.aliases ?? []).map(normalizeTagName).filter(Boolean);
    for (const a of aliases) {
      if (!isValidTagName(a)) throw new RegistryError(`invalid alias "${a}"`);
    }

    const target = this.pickWritableLibrary(opts.library);
    const existing = target.entries.find((e) => normalizeTagName(e.tag) === norm);
    const action = existing ? 'updated' : 'created';

    if (existing) {
      existing.body = body;
      if (opts.aliases !== undefined) existing.aliases = aliases;
      if (opts.description !== undefined) existing.description = opts.description;
    } else {
      target.entries.push({
        tag: norm,
        aliases,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
        body,
      });
    }

    try {
      await this.persist(target);
    } catch (e) {
      // 写盘失败：从磁盘重新加载，恢复内存与索引的一致性，再抛出错误
      try {
        await this.loadAll();
      } catch {
        // 恢复失败则保持原错误
      }
      throw e;
    }

    // 重载后检查实际生效来源，报告遮蔽问题（含同库内"别名占用标签名"的情况）
    const warnings: string[] = [];
    this.checkEffectiveness(norm, aliases, target.path, warnings);
    return { library: target.name, tag: norm, action, warnings };
  }

  /** 检查标签与别名重载后是否真的指向刚保存的条目（否则说明被其他定义遮蔽） */
  private checkEffectiveness(
    norm: string,
    aliases: string[],
    targetPath: string,
    warnings: string[],
  ): void {
    for (const [name, kind] of [
      [norm, 'tag'],
      ...aliases.map((a) => [a, 'alias'] as const),
    ]) {
      const hit = this.index.get(name);
      if (!hit) {
        warnings.push(
          `#${name} (${kind}) was saved to "${targetPath}" but is not resolvable after reload`,
        );
        continue;
      }
      const ownsIt =
        hit.library.path === targetPath && normalizeTagName(hit.entry.tag) === norm;
      if (!ownsIt) {
        warnings.push(
          `#${name} (${kind}) is shadowed by "#${hit.entry.tag}" in library "${hit.library.name}": saved to "${targetPath}" but will not take effect`,
        );
      }
    }
  }

  /** 删除片段并持久化；不存在时返回 false */
  async remove(
    tag: string,
    opts: { library?: string } = {},
  ): Promise<boolean> {
    const norm = normalizeTagName(tag);
    let lib: LibraryFile | undefined;
    let entry: FragmentEntry | undefined;

    if (opts.library) {
      lib = this.loadedLibs.find((l) => l.name === opts.library);
      entry = lib?.entries.find((e) => normalizeTagName(e.tag) === norm);
    } else {
      for (const candidate of this.loadedLibs) {
        entry = candidate.entries.find((e) => normalizeTagName(e.tag) === norm);
        if (entry) {
          lib = candidate;
          break;
        }
      }
    }

    if (!lib || !entry) return false;
    lib.entries = lib.entries.filter((e) => e !== entry);
    try {
      await this.persist(lib);
    } catch (e) {
      // 写盘失败：从磁盘重新加载恢复一致性，再抛出错误
      try {
        await this.loadAll();
      } catch {
        // 恢复失败则保持原错误
      }
      throw e;
    }
    return true;
  }

  private pickWritableLibrary(explicit?: string): LibraryFile {
    if (explicit) {
      const found = this.loadedLibs.find((l) => l.name === explicit);
      if (!found) throw new RegistryError(`library "${explicit}" is not loaded`);
      return found;
    }
    if (this.defaultLibrary) {
      const found = this.loadedLibs.find((l) => l.name === this.defaultLibrary);
      if (!found) {
        throw new RegistryError(`default library "${this.defaultLibrary}" is not loaded`);
      }
      return found;
    }
    const first = this.loadedLibs[0];
    if (!first) throw new RegistryError('no libraries are loaded, nothing to write to');
    return first;
  }

  /** 写回库文件并重建索引 */
  private async persist(lib: LibraryFile): Promise<void> {
    await writeLibraryFile(lib);
    await this.loadAll();
  }
}
