# Simulation package

`@agent-arena/simulation` 管理 candidate、双 runner 复跑、敏感内容检查、显式评审和 approved fixture。
游戏 adapter 负责生成 setup、turns、events、checkpoint、variants 与 runner 结果；workflow 负责确定性
比较和非覆盖写入。

`AdaptedSimulationWorkflow` 允许游戏保留自己的 candidate、fixture、reviewed oracle 与公开 review
schema。`SimulationArtifactAdapter` 提供解析、规范化、摘要、variant、fixture 构造和 secret scan；
workflow 统一执行双 runner 重复运行、agreement、显式接受和不可覆盖写入。
