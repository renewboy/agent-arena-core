# Simulation package

`@agent-arena/simulation` 管理 candidate、双 runner 复跑、敏感内容检查、显式评审和 approved fixture。
游戏 adapter 负责生成 setup、turns、events、checkpoint、variants 与 runner 结果；workflow 负责确定性
比较和非覆盖写入。
