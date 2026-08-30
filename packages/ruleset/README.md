# Ruleset package

`@agent-arena/ruleset` 将有序 `RulePlugin` 编译为带 revision、plugin lock、semantic contributions 与
fingerprint 的冻结 runtime。游戏 registrar 持有领域 registries，Ruleset Core 持有安装、所有权和
锁定语义。

Package 同时提供可组合 phase graph、typed query registry 与有界 resolution registry。游戏模块为
graph node、query context、effect lanes、contribution 和最终结果提供领域类型。
