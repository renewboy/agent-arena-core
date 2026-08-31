# Match runtime package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有 ActionGateway、
MatchOrchestrator 与 BoundaryExecutor 契约。

只通过 GameModule、DecisionBoundary、participant driver 与 store ports 编排。Barrier 必须使用同一
observation revision、密封完整动作集并稳定提交；accepted action 必须先持久化再成功回执。产品暂停、
HTTP/MCP、播放和具体工具语义留给 adapter。

覆盖 single、barrier、完成顺序、pending 恢复、失败注入与 executor 接管，并运行根级 `pnpm check`。
