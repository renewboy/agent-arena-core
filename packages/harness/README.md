# Repository harness package

`@agent-arena/harness` 提供会停止在嵌套 Git repository/submodule 边界的文件发现，以及按 phase 并行、
遇错即停的无 shell gate runner。仓库 policy 由调用方配置；Core 自身的架构与文档检查通过该 package
运行。
