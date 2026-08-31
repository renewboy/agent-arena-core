# Web runtime package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有 live
projection、presentation、follow-latest 与 sequenced cue 契约。

本包不依赖 React、DOM、网络或浏览器全局。所有 IO、计时、音频、wire parse 与游戏 visibility
通过 ports 或 adapters 注入。不要加入产品 View、HTTP path、CSS、文案或游戏 semantic。

公共状态机变化需要覆盖 dispose、重复回调、断线、observer 切换和失败释放，并由两个 conformance
games 或一个 conformance game 加独立产品 consumer 证明。运行本包聚焦测试与根级 `pnpm check`。
