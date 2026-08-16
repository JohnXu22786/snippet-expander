# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 精神，
版本语义遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增 dsh bundle 接入：`package.json` 声明 `dsh.bundle` 并指向 `cordis.patch.yml`；
  `dist/index.js` 导出 Cordis 约定的 `name`/`inject`/`apply`，把 5 个 steno 工具
  注册为 dsh ToolDefinition，并在 harness 发出 `message.beforeSend` 事件时挂上展开钩子。
- `.gitignore` 补充编辑器/系统/打包残留（`.DS_Store`、`*.tgz`、`coverage/` 等）。

### Fixed

- CLI `add`：未提供 `--alias` 时不再把已有片段更新为「无别名」——现在仅当显式给出
  `--alias` 才更新别名，符合「仅在提供时更新」的约定。
- README：移除过时且易漂移的测试用例数（103）硬编码，改为描述性说明；补充
  dsh bundle（Cordis 接入）小节。

### Changed

- 新增 matcher/placeholders 边界测试：转义标签不泄漏相邻标签、占位符区域内转义标签、
  标点邻接标签、默认值独立解析、掩码位置原样保留。

## [1.0.0] - 2026-08-16

### Added

- 首个发布：Steno — dsh 消息内联短标签展开插件。
  - `message.beforeSend` 钩子在消息发送前把 `#tag` 展开为片段库配置的正文；
  - 多片段库（配置顺序即优先级，跨库重名告警）、别名、`{{变量}}` 占位符；
  - 递归组合与三重防护（循环检测 / 深度上限 / 总数上限）；
  - 代码区域（围栏/行内代码/占位符）保护与 `\#tag`、`\{{...}}` 转义；
  - 5 个工具（list / search / expand / save / remove）与完整 CLI。