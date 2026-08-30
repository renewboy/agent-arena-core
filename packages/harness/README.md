# Repository harness package

`@agent-arena/harness` 提供会停止在嵌套 Git repository/submodule 边界的文件发现，以及按 phase 并行、
遇错即停的无 shell gate runner。仓库 policy 由调用方配置；Core 自身的架构与文档检查通过该 package
运行。

可组合 policies 覆盖 package dependency DAG、源码行数、Markdown 链接和必需生成物。每个产品仓库
提供自己的 roots、依赖允许表、例外与领域检查，通用 package 不包含产品路径或 semantic。
