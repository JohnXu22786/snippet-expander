[English](README.md)

# Steno — dsh 消息内联短标签展开插件

输入 `#tag`，消息发送前自动替换为片段库中配置好的全文。把高频指令写一次，以后一条短标签搞定。

```
用户输入：  请用 #review-lens 检查这段代码
实际发送：  请用 请以严谨模式处理：先梳理任务目标，再逐步推理；
            …（完整审查清单）… 检查这段代码
```

## 特性

- **即时展开**：用户在消息中写 `#标签`，`message.beforeSend` 钩子在发送前完成替换。
- **多片段库**：任意多个 YAML 库文件，按配置顺序加载，先者优先；库间同名自动告警。
- **别名**：一个片段可挂多个触发名（`aliases`）。
- **变量占位符**：正文支持 `{{name}}` 与 `{{name:默认值}}`，可由宿主传入变量值。
- **递归组合**：片段正文可以引用其他 `#标签`，层层展开；内置循环检测、深度上限、次数上限三重防护。
- **代码保护**：围栏代码块与行内代码中的 `#tag` 不会被误展开。
- **库管理**：提供 `steno.save` / `steno.remove` 工具与 CLI，片段库可在线编辑并持久化。
- **搜索预览**：`steno.search` 按相关度检索片段；CLI `dsh-steno preview` 可预览完整展开结果。
- **自包含**：仅一个运行时依赖（js-yaml），Node ≥ 22.18 即可运行，无外部服务。

## 快速开始

```bash
npm install          # 安装依赖并构建（prepare 钩子自动执行构建）
npx dsh-steno init   # 初始化示例库到 ~/.dsh/steno/core.yaml（或用 --dir 指定位置）
```

编辑 `~/.dsh/steno/core.yaml`，加入片段：

```yaml
name: core
entries:
  - tag: careful
    aliases: [safe]
    description: 严谨模式
    body: |
      请逐步推理，输出前自查，存疑即问，不要臆测。
```

在消息中写 `#careful` 即可。片段库支持两个自动发现位置（都可被显式配置覆盖）：

| 位置 | 路径 |
| --- | --- |
| 项目级 | `<项目目录>/.dsh/steno/*.yaml` |
| 用户级 | `~/.dsh/steno/*.yaml` |

不依赖自动发现时，可用环境变量 `DSH_STENO_LIBRARIES`（分号分隔的路径列表）或宿主传入的 `libraries` 配置。

## 片段库格式

片段库是 YAML 文件，顶层一个映射，`entries` 为片段列表：

```yaml
name: dev-tools          # 库名（缺省取文件名）；用于 steno.save 的目标定位
description: 说明        # 可选
entries:
  - tag: review-lens     # 必填：触发标签
    aliases: [review]    # 可选：字符串或字符串数组
    description: 说明     # 可选
    body: |              # 必填：字符串 / 多行字符串 / 字符串数组
      #focus
      请从正确性、可维护性、性能与安全三个角度审查。
  - tag: commit
    body: |
      {{type:feat}}({{scope:可选}}): {{subject}}
```

字段规则：

- `tag`：字母开头（含中文等 Unicode 字母），可含字母/数字/`_`/`-`，最长 64 字符；查找时大小写不敏感。
- `aliases`：单字符串或字符串列表，规则同 `tag`。
- `body`：字符串、多行字符串（YAML 块标量）或字符串数组（按行拼接）。
- 同一库内重复 `tag` 或非法字段会整体报错（报错信息列明所有问题）；跨库重复取先加载者，后者告警但不阻断。

> 注意：通过工具/CLI 编辑库文件时，文件会被重新序列化（格式规范化，注释丢失）。
> 手工编辑不受影响，任何时刻都可直接改 YAML。

## 匹配规则

- 触发符为 `#` + 标签名；`#` 前不能紧贴 ASCII 字母/数字/`_`/`-`/`#` 或反斜杠（避免 `foo#tag`、`##tag`）。
- 中文等无空格语言中 `#tag` 紧贴中文是合法用法（如 `请#专注模式`）。
- `#` 后必须紧跟字母，`#123`、markdown 标题 `# 标题` 不会命中。
- 围栏代码块（``` 与 ~~~）与行内代码 `` `x` `` 内的 `#tag` 不展开；未闭合的围栏/行内代码按普通文本处理。
- `\#tag` 输出字面量 `#tag`，不展开。
- 未知标签原样保留。

## 占位符

| 写法 | 行为 |
| --- | --- |
| `{{name}}` | 有变量值则替换；否则保留原文并计入 `unresolved` |
| `{{name:默认值}}` | 无变量值时使用默认值 |
| `\{{name}}` | 输出字面量 `{{name}}` |

宿主可在调用钩子/工具时传 `variables`（如 `{"topic": "发版计划"}`）。默认值每个出现处独立生效。

占位符区域是**不透明**的：`{{...}}` 内部的 `#标签` 不参与展开，默认值按字面量使用；在默认配置（`skipCode: true`）下，代码区域内的占位符同样不会被替换。

## 递归与防护

片段正文可引用其他片段（如 `review-lens` 引用 `focus`）。展开时三重保护，触发时保留字面量并给出警告：

1. **循环检测**：同一标签不得出现在自己的展开链中（`a → b → a` 立即终止）。
2. **深度上限**：默认 8 层（`maxDepth` 可配）。
3. **次数上限**：单次消息展开总数默认 200（`maxExpansions` 可配），防止组合爆炸。

## 配置

宿主加载插件时可传入配置对象（JSON Schema 见 `config.schema.json`）：

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

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `libraries` | 自动发现 | 库文件路径数组，顺序即优先级（先者优先）；支持 `~` 与 `${VAR}` |
| `defaultLibrary` | 第一个库 | `steno.save` 未指定库时的写入目标 |
| `maxDepth` | 8 | 递归展开最大深度 |
| `maxExpansions` | 200 | 单次展开替换次数上限 |
| `skipCode` | true | 是否跳过代码区域中的标签 |
| `keepUnknown` | true | 无值且无默认值的占位符是否保留原文 |

库路径解析顺序：显式 `libraries` → 环境变量 `DSH_STENO_LIBRARIES` → 自动发现。

## 在 DSH 中安装

```bash
dsh plugin --profile demo add github:JohnXu22786/snippet-expander
```

安装后即可在消息中使用 `#标签`。卸载：

```bash
dsh plugin --profile demo remove dsh-steno
```

## 宿主接入（dsh harness）

插件自包含，manifest 见 `plugin.json`，加载契约如下：

### 1. 加载

```js
const mod = await import('./dsh-plugin/snippet-expander/dist/index.js');
const plugin = await mod.createPlugin({
  config: { libraries: ['~/.dsh/steno/core.yaml'] },
  logger: console,          // 可选
});
// 或使用默认导出：await mod.default({ config });
```

返回实例：

```ts
{
  id: 'steno',
  name: 'Steno',
  version: '1.0.0',
  hooks: { 'message.beforeSend': handler },   // 事件接口
  tools: [ ToolDef, ... ],                     // 工具接口（共 5 个）
  config: ResolvedConfig,
  warnings: string[],                          // 加载告警
  registry, engine,                            // 可编程访问
  dispose(): Promise<void>,
}
```

### 2. 事件接口（hooks）

| 事件 | 时机 | 行为 |
| --- | --- | --- |
| `message.beforeSend` | 用户消息发送给模型前 | 展开消息中的 `#标签`，返回新的 `message` 与 `meta.steno`（触发的标签、警告、未解析占位符） |

```js
const out = await plugin.hooks['message.beforeSend']({
  message: '请 #focus 处理',
  variables: { topic: '发布' },   // 可选
});
// out.message 为展开后的文本；out.meta.steno 含 touched / warnings / unresolved
```

非字符串消息原样放行。宿主可将 `meta.steno.warnings` 附加到会话上下文，供模型了解发生了什么。

### 3. 工具接口（tools）

宿主把以下工具注册为 LLM 可调用函数（每个工具含 `name` / `description` / `inputSchema` / `run`）：

| 工具 | 用途 |
| --- | --- |
| `steno.list` | 列出全部片段（可指定库） |
| `steno.search` | 按标签/别名/描述/正文相关度搜索 |
| `steno.expand` | 展开任意文本并返回结果与警告 |
| `steno.save` | 新增/更新片段并持久化（tag、body、aliases、description、library） |
| `steno.remove` | 删除片段 |

### 4. 技能接口（skills）

`skills/steno.md` 为面向模型的技能说明（name/description + 用法），支持技能装载的宿主可直接加载。

### 5. manifest 字段

`plugin.json` 声明：`apiVersion: dsh/plugin@1`、`runtime.node`（`entry: dist/index.js`、`factory: createPlugin`、esm 默认导出）、`hooks`、`tools`、`skills`、`configSchema`。宿主可据此做能力发现与校验。

### 6. dsh bundle（Cordis 接入）

包还声明了 `dsh.bundle`（`package.json` → `cordis.patch.yml`），因此 `dsh plugin add github:JohnXu22786/snippet-expander` 以 Cordis 插件方式安装：`dist/index.js` 额外导出 `name`（`dsh-steno`）、`inject = ['tools']` 与 `apply(ctx, config)`。`apply` 通过 `createPlugin()` 装载插件，把 5 个工具注册为 dsh ToolDefinition，并在 harness 发出 `message.beforeSend` 事件时挂上展开钩子；卸载（热重载）时回收全部注册。插件行的 `config` 即 [配置](#配置) 一节中的 `StenoConfig`。

## CLI

```bash
dsh-steno list [--library <名>] [--json]
dsh-steno search <词> [--limit <n>] [--json]
dsh-steno preview <标签> [--var k=v] [--json]
dsh-steno expand <文本...> [--var k=v] [--json]      # 文本为 - 时读 stdin
dsh-steno add <标签> <正文...> [--library <名>] [--alias <a>] [--description <d>] [--stdin]
dsh-steno remove <标签> [--library <名>]
dsh-steno paths            # 查看配置解析结果与告警
dsh-steno init [--dir <路径>]
```

CLI 与插件共享同一套片段库与展开逻辑，可独立用于调试。

## 开发

```bash
npm run build    # 编译 TypeScript 到 dist/
npm test         # 构建 + node:test 全量测试
npm run demo     # 模拟宿主加载插件、演练 hooks 与工具
```

源码结构：

```
src/
  core/       matcher（标签扫描）/ placeholders（{{变量}}）/ engine（展开引擎）
  store/      library（库文件解析/序列化）/ registry（多库索引与管理）
  plugin/     hooks（事件钩子）/ tools（工具定义）
  index.ts    插件入口（createPlugin）
  config.ts   配置解析
  cli.ts      命令行入口
test/         node:test 测试
libs/         示例片段库   skills/  技能文档   scripts/  演示脚本
```

## 设计取舍与限制

- 工具/CLI 写回库文件时重新序列化 YAML（注释丢失）；手工编辑无此限制。
- `list` 展示库文件的真实内容，被遮蔽（后加载的同名）条目也会列出，便于排查优先级问题。
- 标签名以字母开头（含中文等 Unicode 字母），可含字母/数字/`_`/`-`，不支持空格。
- 若代码块的围栏跨越展开边界（消息中开启、展开后的正文中闭合），代码保护以展开前各段文本独立判定为准（见"匹配规则"中未闭合围栏的处理）。
- 单次消息展开规模受 `maxExpansions` 硬上限保护，极端情况下部分标签保持字面量并告警。

## 许可

本项目以 [MIT](LICENSE) 许可协议发布。
