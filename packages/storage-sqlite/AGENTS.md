# SQLite storage package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有参考 SQLite
stores、codec 与 migration 契约。

所有读取重新经过调用方 codec 解析，事务保持事件 sequence 与跨表状态一致。Migration 只使用
`arena_schema_migrations`，不占用宿主 `PRAGMA user_version`，也不假定产品数据库表结构。

Schema 变化同时覆盖全新数据库、逐步 migration、restart、级联删除与 `PRAGMA quick_check`，并运行
根级 `pnpm check`。
