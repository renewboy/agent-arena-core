# Runtime testkit package

`@agent-arena/testkit` 提供隔离的内存 Match、Session binding、delivery 与 trajectory stores，以及可按
participant 排队、延迟或注入失败的 scripted turn driver。测试可以据此验证 barrier 完成顺序、pending
action 恢复与失败重试，而不启动真实 Agent 或写入产品数据。
