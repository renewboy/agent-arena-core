# Trajectory package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有 ACP Turn/Record
合并、脱敏与持久化 callback 契约。

Secret redaction、循环保护与有界截断必须发生在持久化前；tool updates 按稳定身份 upsert。领域时间线、
规则审计、查询 API 与产品 UI 留给消费者。

覆盖每种 ACP update、顺序、重复 tool update、异常值、脱敏和截断，并运行本包 typecheck 与根级
`pnpm check`。
