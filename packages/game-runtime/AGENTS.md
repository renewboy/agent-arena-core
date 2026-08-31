# Game runtime package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有 GameModule、
GameMachine、decision 与 event journal 契约。

保持运行时确定性且无 IO。Single 与 barrier 只表达通用 decision boundary；游戏状态机拥有具体阶段、
响应栈和动作语义。事件 sequence、observation revision 与稳定随机源必须可重放。

变更公共 runtime 契约时同时验证两个 conformance games，并运行本包 typecheck、聚焦测试与根级
`pnpm check`。
