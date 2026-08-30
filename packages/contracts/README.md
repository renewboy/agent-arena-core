# Contracts package

`@agent-arena/contracts` 定义跨游戏、进程、持久化和 JSON 边界共享的最小词汇：branded IDs、Ruleset
lock、观察者与 audience、结构化动作、确定性事件和 decision boundary 描述。

游戏 package 为 setup、state、action payload、event payload、observation 与 outcome 提供严格
schemas；本包只持有这些边界共享的信封与标识符。
