# Simulation package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有 candidate、
双 runner、review 与 fixture workflow 契约。

Workflow 不解释游戏 state、event 或 checkpoint。Adapter 提供解析、规范化、variants、oracle 与
secret scan；批准写入不可覆盖，runner agreement 和重复执行必须显式成立。

变化需要覆盖 candidate→review→approve、分歧、warning、secret、重复批准、失败注入与 restart，
并运行两个 conformance games 和根级 `pnpm check`。
