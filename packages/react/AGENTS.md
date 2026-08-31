# React package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有 runtime hooks、
browser ports 与无样式交互契约。

React 和 ReactDOM 保持 peer dependencies。组件不得携带 CSS、图标、产品 copy、游戏 View 或 route；
所有样式和呈现通过 props、slots 与 class names 注入。浏览器 API 只能位于命名明确的 browser adapter。

Hooks 必须在 StrictMode 下幂等订阅与释放。交互变化覆盖键盘、focus、portal、inert、unmount 与 Node
import，并运行本包测试和根级 `pnpm check`。
