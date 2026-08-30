# Agent Arena Core

Agent Arena Core 是面向多 Agent 回合制游戏的 Ruleset-first 基础框架。它提供版本化规则组合、
确定性事件运行时、单人决策与多人 barrier 契约，以及用于跨游戏验证的 conformance games。

## Workspace

- `@agent-arena/contracts`：跨包 IDs、Ruleset lock、audience、action、event 与 decision schemas。
- `@agent-arena/ruleset`：RulePlugin 安装、semantic ownership、Ruleset 编译、组合图与 resolution
  agenda。
- `@agent-arena/game-runtime`：GameModule、decision boundary、事件 journal 与确定性随机源。
- `examples/hidden-team`：验证团队私有事实、文字行动与 barrier。
- `examples/reaction-card`：验证牌堆、连续行动、响应窗口与 restore。

## Commands

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` 运行架构门禁、类型、lint、格式、测试覆盖率与生产构建。

跨包职责、Ruleset 编译和 decision/event 数据流见[架构设计](docs/architecture.md)。
