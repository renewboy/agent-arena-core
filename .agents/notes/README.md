# Agent Notes

Agent Note 保留 Agent Arena Core 重大决策的原因、备选方案与后果。路径编码两个维度：

```text
.agents/notes/<lifecycle>/<class>/YYYY-MM-DD-<slug>.md
```

## Lifecycle

- `proposed`：在实现前接受评审，可以包含计划、验收标准与风险。
- `implemented`：已交付的决策，以现在时态撰写并与当前实现保持一致。
- `rejected`：被否决的提案，在状态中附一行否决原因。
- `archived`：冻结的 implemented 历史，不再指导日常工作。

Implemented 决策可以更新事实性的路径、符号、默认值与机制。推翻决策或理由需要新的 Note 取代
旧 Note 并建立链接。

## Classes

- `feature`：主要的框架能力。
- `bug-fix`：预防方式需要持久决策的重大缺陷。
- `simplification`：移除行为、兼容负担或暴露面。
- `architecture`：结构、依赖方向、运行时词汇或跨包归属。
- `process`：仓库工作流、工具或治理。
- `testing`：测试架构或长期验证策略。

## Format

每个 Note 都以下列内容开头：

```markdown
# Agent Note: <title>

Status: proposed | implemented | rejected — <reason>
```

Proposed Note 包含 `Problem`、`Proposal`、`Alternatives considered`、`Acceptance criteria` 与
`Risks`。Implemented Note 包含 `Problem`、`Decision`、`Alternatives considered` 与
`Consequences`；可以追加 `Verification` 记录稳定检查手段与已知覆盖边界。

Implemented Note 永远不保留 `Proposal`、`Plan`、`Migration plan`、`Acceptance criteria`、TODO、
未勾选清单或带日期的测试总数。Rejected Note 只在其理由能够防止一个可能错误时保留提案与备选
方案。

Lifecycle/class 目录树就是清单，不维护第二份中央索引。
