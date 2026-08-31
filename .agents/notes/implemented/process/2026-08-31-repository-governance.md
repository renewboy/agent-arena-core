# Agent Note: 仓库指令与交付物治理

Status: implemented

## Problem

跨 package 框架需要让编码代理在进入任意目录时获得正确的局部边界，同时保持公开 README、当前态
架构和重大决策各自纯粹。只有根级说明或依赖人工记忆的文档约定，无法机械保证最近指令、Note 生命周期
和当前态纯净性。

## Decision

仓库使用分层 `AGENTS.md`。根文件持有仓库地图和通用规则；docs、每个 package、每个 conformance
example 与 Agent Notes lifecycle 持有局部增量规则，并以相对链接指向最近祖先。README 继续持有
人类可读的包契约，AGENTS 只持有代理执行指令。

根目录保留一份与消费仓一致的 `artifacts_rules.md`，作为持久交付物的通用当前态纯净性契约。Agent
Note 使用 lifecycle/class/日期路径，并由文档门禁校验路径、状态、必需章节和 implemented 纯净性。
同一门禁校验 AGENTS 行数、最近祖先链接、必需文档、本地 Markdown 链接与当前态叙事。

## Alternatives considered

**只使用根级 AGENTS。** 根文件会累积 package 细节，进入子目录后也无法表达更窄的验证与所有权。

**把开发指令写进 README。** README 面向包消费者，混入代理指令会模糊受众并破坏一事一主。

**只记录约定，不执行门禁。** 目录移动、Note 状态漂移和断链只能依赖评审者偶然发现。

## Consequences

- 编码代理必须先读取最近 `AGENTS.md`，再按父链接获得完整规则链。
- Package README 与 AGENTS 成对存在，分别服务包契约和目录内执行。
- 重大工作具有 proposed、implemented、rejected、archived 的明确生命周期。
- 文档结构错误在 `pnpm check:docs` 中失败，治理变化随完整仓库门禁一起验证。

## Verification

文档门禁扫描全部 Markdown 与嵌套 AGENTS，校验最近父级、Note schema、当前态叙事和本地链接；聚焦
单元测试覆盖 Note lifecycle 与父级发现的失败路径。
