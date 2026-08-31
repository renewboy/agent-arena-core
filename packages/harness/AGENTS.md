# Repository harness package 指南

参见[根 AGENTS.md](../../AGENTS.md)。修改本包前先阅读 [README.md](README.md)；它持有文件发现、
policies 与 gate runner 契约。

通用 harness 不包含产品路径、命名或 semantic。文件发现必须停止在嵌套 Git repository/submodule，
gate runner 不使用 shell 字符串，policy 通过调用方配置 roots、依赖表与例外。

每条通用 policy 使用临时仓库或隔离 fixture 覆盖成功与失败路径；同时运行 scripts harness 测试和根级
`pnpm check`。
