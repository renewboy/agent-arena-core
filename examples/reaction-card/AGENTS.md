# Reaction Card conformance game 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本例前先阅读 [README.md](README.md)；它持有本 conformance
game 的验证范围。

本例只使用 Core 公开 API 验证确定性牌堆、私有手牌、连续 single、pass、嵌套响应、可见性与响应窗口
restore。不要加入产品 UI、版权规则内容或绕过 GameModule 的测试接口。

变更时运行本例全部测试，并在公共契约变化时运行 Hidden Team 与根级 `pnpm check`。
