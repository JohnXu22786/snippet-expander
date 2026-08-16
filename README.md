[简体中文](README.zh.md)

# Steno — inline shorthand expansion plugin for dsh messages

Type `#tag` and it is automatically replaced with the full text configured in your snippet library before the message is sent. Write high-frequency instructions once, then trigger them with a single short tag.

```
User types:   Please check this code with #review-lens
Actually sent: Please check this code with Please review strictly: first clarify the task goal, then reason step by step;
              … (full review checklist) …
```

## Features

- **Instant expansion**: you write `#tag` in a message and the `message.beforeSend` hook performs the replacement before sending.
- **Multiple snippet libraries**: any number of YAML library files, loaded in configuration order with earlier files taking precedence; duplicate names across libraries trigger an automatic warning.
- **Aliases**: a single snippet can be attached to multiple trigger names (`aliases`).
- **Variable placeholders**: the body supports `{{name}}` and `{{name:default}}`, with values supplied by the host.
- **Recursive composition**: snippet bodies can reference other `#tag`s and expand layer by layer; built-in triple protection covers loop detection, a depth limit, and a count limit.
- **Code protection**: `#tag`s inside fenced code blocks and inline code are never expanded by mistake.
- **Library management**: `steno.save` / `steno.remove` tools plus a CLI let you edit and persist snippet libraries on the fly.
- **Search and preview**: `steno.search` retrieves snippets by relevance; the CLI `dsh-steno preview` shows the fully expanded result.
- **Self-contained**: only one runtime dependency (js-yaml), requires Node ≥ 22.18, no external services.

## Quick Start

```bash
npm install          # install dependencies and build (the prepare hook builds automatically)
npx dsh-steno init   # initialize an example library at ~/.dsh/steno/core.yaml (or use --dir)
```

Edit `~/.dsh/steno/core.yaml` and add a snippet:

```yaml
name: core
entries:
  - tag: careful
    aliases: [safe]
    description: strict mode
    body: |
      Reason step by step, self-check before output, ask when in doubt, do not speculate.
```

Write `#careful` in a message. Snippet libraries support two auto-discovery locations (both can be overridden by explicit configuration):

| Location | Path |
| --- | --- |
| Project-level | `<project dir>/.dsh/steno/*.yaml` |
| User-level | `~/.dsh/steno/*.yaml` |

When you do not rely on auto-discovery, you can use the environment variable `DSH_STENO_LIBRARIES` (semicolon-separated path list) or the `libraries` configuration passed by the host.

## Snippet Library Format

A snippet library is a YAML file, a single top-level mapping whose `entries` is a list of snippets:

```yaml
name: dev-tools          # library name (defaults to file name); used as target for steno.save
description: description # optional
entries:
  - tag: review-lens     # required: trigger tag
    aliases: [review]    # optional: string or string array
    description: description  # optional
    body: |              # required: string / multi-line string / string array
      #focus
      Review for correctness, maintainability, performance, and security.
  - tag: commit
    body: |
      {{type:feat}}({{scope:optional}}): {{subject}}
```

Field rules:

- `tag`: must start with a letter (including Unicode letters such as Chinese), may contain letters/digits/`_`/`-`, up to 64 characters; matching is case-insensitive.
- `aliases`: a single string or list of strings, same rules as `tag`.
- `body`: a string, multi-line string (YAML block scalar), or string array (joined line by line).
- Duplicate `tag`s or invalid fields within one library fail the whole load (the error lists every problem); duplicates across libraries keep the earlier-loaded one and only warn, without blocking.

> Note: when a library file is edited via the tools/CLI, the file is re-serialized (format normalized, comments lost).
> Manual edits are unaffected — you can edit the YAML directly at any time.

## Matching Rules

- The trigger is `#` + tag name; `#` must not be immediately preceded by an ASCII letter/digit/`_`/`-`/`#` or a backslash (avoiding `foo#tag` and `##tag`).
- In languages without spaces, like Chinese, `#tag` directly adjacent to Chinese characters is valid (e.g., `请#专注模式`).
- `#` must be immediately followed by a letter; `#123` and markdown headings like `# Heading` do not match.
- `#tag`s inside fenced code blocks (``` and ~~~) and inline code (`` `x` ``) are not expanded; unclosed fences/inline code are treated as plain text.
- `\#tag` outputs the literal `#tag` without expansion.
- Unknown tags are kept as-is.

## Placeholders

| Syntax | Behavior |
| --- | --- |
| `{{name}}` | Replaced when a variable value is present; otherwise kept verbatim and counted in `unresolved` |
| `{{name:default}}` | Uses the default value when no variable value is available |
| `\{{name}}` | Outputs the literal `{{name}}` |

The host can pass `variables` when invoking hooks/tools (e.g., `{"topic": "release plan"}`). Each occurrence of a default is resolved independently.

Placeholder regions are **opaque**: `#tag`s inside `{{...}}` do not participate in expansion, and defaults are used literally; under the default config (`skipCode: true`), placeholders inside code regions are not replaced either.

## Recursion and Guards

Snippet bodies can reference other snippets (e.g., `review-lens` referencing `focus`). Expansion has triple protection; when triggered, the literal text is kept and a warning is emitted:

1. **Loop detection**: the same tag must not appear in its own expansion chain (`a → b → a` terminates immediately).
2. **Depth limit**: 8 levels by default (`maxDepth` configurable).
3. **Count limit**: a total of 200 expansions per message by default (`maxExpansions` configurable), preventing combinatorial explosion.

## Configuration

The host can pass a config object when loading the plugin (JSON Schema in `config.schema.json`):

```json
{
  "libraries": ["~/.dsh/steno/core.yaml", ".dsh/steno/project.yaml"],
  "defaultLibrary": "core",
  "maxDepth": 8,
  "maxExpansions": 200,
  "skipCode": true,
  "keepUnknown": true
}
```

| Field | Default | Description |
| --- | --- | --- |
| `libraries` | auto-discovered | Array of library file paths, order is priority (earlier wins); supports `~` and `${VAR}` |
| `defaultLibrary` | first library | Write target for `steno.save` when no library is specified |
| `maxDepth` | 8 | Maximum recursion depth for expansion |
| `maxExpansions` | 200 | Upper bound of replacements in a single expansion |
| `skipCode` | true | Whether to skip tags inside code regions |
| `keepUnknown` | true | Whether to keep placeholders verbatim when they have no value and no default |

Library path resolution order: explicit `libraries` → environment variable `DSH_STENO_LIBRARIES` → auto-discovery.

## Installing in DSH

```bash
dsh plugin --profile demo add github:JohnXu22786/snippet-expander
```

After installation you can use `#tag` in messages right away. To remove:

```bash
dsh plugin --profile demo remove dsh-steno
```

## Host Integration (dsh harness)

The plugin is self-contained; the manifest lives in `plugin.json`, and the loading contract is as follows:

### 1. Loading

```js
const mod = await import('./dsh-plugin/snippet-expander/dist/index.js');
const plugin = await mod.createPlugin({
  config: { libraries: ['~/.dsh/steno/core.yaml'] },
  logger: console,          // optional
});
// or use the default export: await mod.default({ config });
```

The returned instance:

```ts
{
  id: 'steno',
  name: 'Steno',
  version: '1.0.0',
  hooks: { 'message.beforeSend': handler },   // event interface
  tools: [ ToolDef, ... ],                     // tool interface (5 in total)
  config: ResolvedConfig,
  warnings: string[],                          // load warnings
  registry, engine,                            // programmatic access
  dispose(): Promise<void>,
}
```

### 2. Event Interface (hooks)

| Event | Timing | Behavior |
| --- | --- | --- |
| `message.beforeSend` | Before the user message is sent to the model | Expands `#tag`s in the message, returns the new `message` and `meta.steno` (touched tags, warnings, unresolved placeholders) |

```js
const out = await plugin.hooks['message.beforeSend']({
  message: 'Please #focus this',
  variables: { topic: 'release' },   // optional
});
// out.message is the expanded text; out.meta.steno contains touched / warnings / unresolved
```

Non-string messages pass through unchanged. The host can attach `meta.steno.warnings` to the session context so the model knows what happened.

### 3. Tool Interface (tools)

The host registers the following tools as LLM-callable functions (each tool has `name` / `description` / `inputSchema` / `run`):

| Tool | Purpose |
| --- | --- |
| `steno.list` | List all snippets (optionally in a specific library) |
| `steno.search` | Search by relevance over tag/alias/description/body |
| `steno.expand` | Expand arbitrary text and return results and warnings |
| `steno.save` | Add/update a snippet and persist it (tag, body, aliases, description, library) |
| `steno.remove` | Delete a snippet |

### 4. Skill Interface (skills)

`skills/steno.md` is a model-facing skill description (name/description + usage) that hosts with skill loading support can load directly.

### 5. Manifest Fields

`plugin.json` declares: `apiVersion: dsh/plugin@1`, `runtime.node` (`entry: dist/index.js`, `factory: createPlugin`, ESM default export), `hooks`, `tools`, `skills`, `configSchema`. Hosts can use it for capability discovery and validation.

### 6. dsh Bundle (Cordis entry)

The package also declares `dsh.bundle` (`package.json` → `cordis.patch.yml`), so `dsh plugin add github:JohnXu22786/snippet-expander` installs it as a Cordis plugin: `dist/index.js` additionally exports `name` (`dsh-steno`), `inject = ['tools']` and `apply(ctx, config)`. `apply` loads the plugin through `createPlugin()`, registers the 5 tools as dsh ToolDefinitions, and attaches the `message.beforeSend` hook when the harness emits that event; unload (hot reload) disposes all registrations. The row `config` is the same `StenoConfig` documented in [Configuration](#configuration).

## CLI

```bash
dsh-steno list [--library <name>] [--json]
dsh-steno search <term> [--limit <n>] [--json]
dsh-steno preview <tag> [--var k=v] [--json]
dsh-steno expand <text...> [--var k=v] [--json]      # read stdin when text is -
dsh-steno add <tag> <body...> [--library <name>] [--alias <a>] [--description <d>] [--stdin]
dsh-steno remove <tag> [--library <name>]
dsh-steno paths            # show config resolution results and warnings
dsh-steno init [--dir <path>]
```

The CLI shares the same snippet libraries and expansion logic as the plugin and can be used standalone for debugging.

## Development

```bash
npm run build    # compile TypeScript to dist/
npm test         # build + full node:test suite
npm run demo     # simulate a host loading the plugin and exercise hooks and tools
```

Source layout:

```
src/
  core/       matcher (tag scanning) / placeholders ({{variables}}) / engine (expansion engine)
  store/      library (library file parsing/serialization) / registry (multi-library index and management)
  plugin/     hooks (event hooks) / tools (tool definitions)
  index.ts    plugin entry (createPlugin)
  config.ts   config parsing
  cli.ts      CLI entry
test/         node:test tests
libs/         example snippet libraries   skills/   skill docs   scripts/   demo scripts
```

## Design Trade-offs and Limitations

- Writing library files back via the tools/CLI re-serializes the YAML (comments are lost); manual edits have no such limitation.
- `list` shows the real contents of library files; shadowed (later-loaded duplicate-named) entries are also listed so priority issues are easier to diagnose.
- Tag names must start with a letter (including Unicode letters such as Chinese), may contain letters/digits/`_`/`-`, and do not support spaces.
- If a code fence spans an expansion boundary (opened in the message, closed in the expanded body), code protection is judged per pre-expansion text segment (see the unclosed-fence handling under "Matching Rules").
- The expansion size of a single message is capped by the hard `maxExpansions` limit; in extreme cases some tags stay literal and produce warnings.

## License

This project is released under the [MIT](LICENSE) License.
