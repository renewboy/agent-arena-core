# Ruleset package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有 plugin 编译、
semantic ownership 与 registries 契约。

Ruleset Core 只编排游戏提供的 Registrar 和领域类型。保持安装顺序、依赖、配置、lock、fingerprint、
phase/query/resolution 的确定性；不要加入具体 Role、Faction、Phase 或胜负语义。

规则组合变化需要覆盖成功、冲突、环、缺失依赖与有界失败，并运行本包 typecheck、聚焦测试和根级
`pnpm check`。
