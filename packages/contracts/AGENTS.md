# Contracts package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有共享词汇与
store ports 契约。

保持本包无 IO、无产品语义且不依赖其他 Core package。跨 JSON、配置和持久化边界使用 Zod，ID 使用
branded types；新增字段时同步验证 producer、consumer、parse 与序列化行为。

运行 `pnpm --filter @agent-arena/contracts typecheck` 和对应 contracts 测试；跨包 schema 变化运行根级
`pnpm check`。
