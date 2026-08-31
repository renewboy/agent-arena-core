# ACP runtime package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有 ACP 进程、
Session 与 delivery 契约。

保持 Provider launch spec、协议协商、Session new/resume、permission、stream 与进程关闭通用。不要
引入游戏工具名、产品恢复策略或宿主路径。命令执行使用参数数组；关闭与取消必须有界并保留真实错误。

进程测试使用仓库内 fixture 与隔离进程组，不连接产品数据。运行本包 typecheck、聚焦测试与根级
`pnpm check`。
