# Devtools React package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有 trajectory
explorer 与 simulation review UI 契约。

组件只消费 Core base contracts 和调用方 ports。Owner、timeline group、action label、领域 audit、
Session debug、copy、icons 与 CSS 通过 adapter 或 slots 注入；不要加入产品 route 或游戏 semantic。

覆盖 revision merge、分页、owner 切换、delta cleanup、虚拟列表、warning/secret/accept-current gate 和
失败重试。运行本包测试、两个 conformance games 与根级 `pnpm check`。
