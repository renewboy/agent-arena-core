# Game runtime package

`@agent-arena/game-runtime` 定义 Match host 与游戏实现之间的 `GameModule`、`GameMachine`、observation
和 decision boundary 契约。单人 boundary 接受一个 actor 动作；barrier boundary 收齐冻结 actor 集
后按声明顺序提交。

`ActionSpec` 声明 action type、工具名、结构化/文本输入、payload schema 与可选 stream audience。
文本 action 可以提供 `textInput` 将直接回复转换为领域 payload。

`EventJournal` 为确定性游戏事件分配 Match 内 sequence 并立即归约状态。`SeededRandom` 与稳定选择
函数为游戏初始化和规则结算提供可重放随机源。
