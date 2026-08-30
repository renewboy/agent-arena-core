# Match runtime package

`@agent-arena/match-runtime` 通过 `GameModule` 和 `DecisionBoundary` 驱动一个确定性 `GameMachine`。
`ActionGateway` 按 actor 的 `ActionSpec` 动态接受结构化工具或直接文本，并在成功回执前调用持久化
callback。`MatchOrchestrator` 为每个 actor 构造同 revision observation，密封 barrier 动作，再按
boundary 声明顺序一次提交。

Participant driver 负责连接 ACP、人工输入或测试脚本；Session binding store 保存 pending accepted
action。编排失败不提交部分 barrier，重试可以复用同 decision ID 的已持久动作。本包不拥有具体游戏
阶段、工具名、Prompt 文案、HTTP/MCP 传输或产品暂停策略。
