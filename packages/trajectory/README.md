# Trajectory package

`@agent-arena/trajectory` 记录一次 ACP Turn 内的 instructions、Prompt、reasoning、message、tool、
permission、action、usage、diagnostic、lifecycle 与 error。Recorder 合并流式 records、upsert tool
状态，并在持久化前完成 secret redaction、循环保护和有界截断。

调用方提供 Turn/Record codecs、record ordinal store 与保存 callbacks；Match system events、持久查询、
timeline grouping 和领域 audit 由上层模块拥有。
