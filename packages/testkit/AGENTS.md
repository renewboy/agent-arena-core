# Runtime testkit package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有内存 stores 与
scripted participant driver 契约。

Testkit 只提供确定性测试替身，不启动真实 Agent、不写产品数据、不嵌入具体游戏语义。Failure driver
必须能稳定控制排队、延迟、完成顺序和错误注入。

新增 helper 同时提供自测，并由至少一个 runtime 或 conformance 测试真实消费；运行根级
`pnpm check`。
