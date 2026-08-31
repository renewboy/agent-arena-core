# Agent Arena Core 文档标准

仓库级规则见[根 AGENTS.md](../AGENTS.md)。本指令适用于面向人类的文档、package/example README、
Agent Note 与其他持久化行文。修改前必须阅读[当前态交付物纯净性规则](../artifacts_rules.md)。

## 一事一主

| 交付物                 | 拥有                                   | 不拥有                 |
| ---------------------- | -------------------------------------- | ---------------------- |
| 根 `AGENTS.md`         | 常设指令、仓库地图与验证入口           | 详细架构或 package API |
| 根 `README.md`         | 对外概览与 workspace 导航              | 执行规则或设计历史     |
| `docs/architecture.md` | 当前跨包边界、状态所有权与端到端数据流 | package 内部实现       |
| Package/example README | 局部契约、输入输出、失败边界与用途     | 跨包设计或代理指令     |
| Package/example AGENTS | 目录内开发指令、阅读路线与验证         | 重复 README 契约       |
| Agent Note             | 重大决策、真实备选方案与后果           | 当前 API 或交付日志    |
| 代码、schemas 与测试   | 可执行的精确行为                       | 重复的手写目录         |

一个事实只保留一个权威归属地；其他文档只概括目的并链接，不复制机制、边界情况、测试清单或历史叙事。

## 当前态与层级

`docs/architecture.md` 是当前系统地图。Package 细节保留在对应 `README.md`，开发约束保留在最近的
`AGENTS.md`。每个 `AGENTS.md` 不超过 200 行，架构文档不超过 500 行；按职责拆分，不为行数压缩
无关事实。

## 更新路由

- Package API、失败行为或持久化契约变化：更新对应 package README 或 JSDoc。
- Package 依赖方向、跨包状态所有权或端到端控制流变化：更新 `docs/architecture.md`。
- Conformance game 的用途或验证边界变化：更新对应 example README。
- 仓库治理、目录级执行规则或验证命令变化：更新对应 `AGENTS.md` 与机械门禁。
- 重大架构、持久化、安全、隐私、公开契约或测试策略决策：使用 Agent Note。
- 局部实现与测试增加不自动触发常设文档更新。

## Agent Notes

[Agent Notes](../.agents/notes/README.md) 使用 lifecycle/class 目录。Proposed Note 可以承载提案、
验收条件与风险；implemented Note 只记录当前决策、备选方案、后果和稳定验证契约。

## 校验

- 嵌套 `AGENTS.md` 必须以相对链接指向最近祖先。
- Markdown 本地链接必须存在，Agent Note 路径、状态与章节必须匹配 lifecycle。
- 当前态文档不得包含迁移叙事或产品仓库专属语义。
- 文档变更运行 `pnpm check:docs` 与 `git diff --check`；治理或门禁变化运行 `pnpm check`。
