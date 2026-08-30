# Prompt runtime package

`@agent-arena/prompt-runtime` 装载由游戏和 Ruleset plugins 提供的 Nunjucks bundle。它验证路径包含、
symlink、文件类型、静态 imports、依赖环、shared exports、audience 单调性、声明式 event matcher 与
semantic ownership 覆盖，并在使用前预编译全部模板。

Core 只定义 `public`、`participant`、`group`、`host` 四类静态敏感度。游戏 adapter 解析自己的
manifest、semantic kinds、事实 schema 与呈现结构；本包不包含 Role、Faction、工具清单或 Prompt 文案。
