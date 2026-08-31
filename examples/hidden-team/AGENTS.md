# Hidden Team conformance game 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本例前先阅读 [README.md](README.md)；它持有本 conformance
game 的验证范围。

本例只使用 Core 公开 API 验证 group/private/public observation、文字 action、轮换 actor、密封 barrier、
Prompt composition、失败注入、restart 与双 runner。不要加入产品 UI、外部游戏规则或旁路测试入口。

变更时运行本例全部测试，并在公共契约变化时运行另一个 conformance game 与根级 `pnpm check`。
