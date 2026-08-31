# Prompt runtime package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有 bundle 安全与
semantic coverage 契约。修改 Prompt 或文档前还要阅读[纯净性规则](../../artifacts_rules.md)。

保持路径包含、symlink、静态 import、依赖环、matcher 与 audience 单调性失败关闭。Core 只理解
public、participant、group、host 敏感度，不持有游戏 manifest、事实 schema 或 Prompt 文案。

安全边界变化需要正反测试、precompile 覆盖和根级 `pnpm check`。
