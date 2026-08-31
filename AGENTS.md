# Agent Arena Core 仓库指南

Agent Arena Core 是 TypeScript workspace，为事件驱动、回合/阶段制、多 Agent 游戏提供跨游戏基础
框架。本文件是仓库地图；精确架构与 package 契约归属于对应文档和目录。

## 指令范围

- 编辑任何文件前，先读取距离最近的 `AGENTS.md`，并跟随其中指向最近祖先的链接。
- 根级规则适用于全仓库；更近的 `AGENTS.md` 可以新增或收紧子树规则。
- 每个嵌套 `AGENTS.md` 必须链接最近祖先，且每个 `AGENTS.md` 不超过 200 行。
- 保留无关的工作区改动。只提交经过验证的明确路径。
- 所有持久化文档、Agent Note 与 `AGENTS.md` 使用中文，专有术语保留英文。

## 阅读路线

- 修改任何持久化文档、Prompt、Skill、工具描述或公开文案前，MUST Read
  [当前态交付物纯净性规则](artifacts_rules.md)。
- 文档归属、行文与 Agent Note 规则：[文档标准](docs/AGENTS.md)。
- 系统边界、组件职责、数据与控制流：[架构设计](docs/architecture.md)。
- 修改 package 或 conformance game：先读其目录下的 `AGENTS.md` 与 `README.md`。
- 重大提案与已实现决策：[Agent Notes](.agents/notes/README.md)。

## Workspace 地图

- `packages/contracts`：branded IDs、audience、actions/events、Ruleset lock 与 store ports。
- `packages/ruleset`：RulePlugin 安装、semantic ownership、phase/query/resolution registries。
- `packages/game-runtime`：GameModule、decision boundary、event journal 与确定性随机源。
- `packages/match-runtime`：ActionGateway、single/barrier 编排与 accepted action 恢复。
- `packages/acp-runtime`：ACP 进程、协议、Session、permission、delivery 与有界关闭。
- `packages/prompt-runtime`：安全 bundle loader、静态 imports、audience 与 semantic coverage。
- `packages/storage-sqlite`：通用 store ports 的参考 SQLite adapter。
- `packages/trajectory`：ACP Turn/Record 合并、脱敏、截断与持久化 callbacks。
- `packages/web-runtime`：live projection、subscription、presentation、follow-latest 与 cue 状态机。
- `packages/react`：runtime hooks、browser ports 与无样式交互 primitives。
- `packages/devtools-react`：trajectory explorer 与 simulation review React 组件。
- `packages/simulation`：candidate、双 runner、review、approve 与 fixture workflow。
- `packages/harness`：文件发现、repository policies 与分阶段 gate runner。
- `packages/testkit`：内存 stores、scripted participant driver 与 failure drivers。
- `examples/hidden-team`、`examples/reaction-card`：只用于公开 API conformance。
- `scripts/harness`：Core 自身的架构、文档与仓库门禁。

## Package 依赖方向

- `contracts`、`acp-runtime`、`harness` 与 `web-runtime` 不依赖其他 Core package。
- `ruleset`、`game-runtime`、`prompt-runtime`、`simulation`、`storage-sqlite` 与 `trajectory`
  只依赖 `contracts`。
- `match-runtime` 只依赖 `contracts` 与 `game-runtime`；`testkit` 只服务测试。
- `react` 只依赖 `web-runtime`；`devtools-react` 只依赖 `react`、`web-runtime`、`trajectory` 与
  `simulation`。
- examples 可以组合公开 packages，但生产 packages 不 import examples、产品仓库或产品语义。
- 依赖、产品术语、文件长度和文档结构通过可执行门禁校验。

## 命令

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:coverage
pnpm build
pnpm check
```

迭代期间使用聚焦测试；跨 package、持久化、协议、文档治理或公开契约变化在交付前运行
`pnpm check`。

## 源码规则

- 使用 ESM、严格 TypeScript、跨边界 branded IDs，在 JSON、配置、持久化与外部输入边界使用 Zod。
- 封闭 union 使用穷举分支；确定性运行时不读取时钟、随机源、网络或产品全局状态。
- 不执行 shell 字符串插值，不把 secrets、Session 数据、运行日志或生成对局内容提交到仓库。
- 通用 package 不包含具体 Role、Faction、Phase、board、工具清单、Prompt 文案或产品路径。
- 新公共抽象必须同时由两个不同 conformance games，或一个 conformance game 与独立消费者证明。

## 运行时不变量

- Ruleset 只组合游戏提供的 registries；Core 不解释具体游戏语义。
- GameModule 拥有 setup/state/action/event/outcome schemas、归约、observation 与 decision boundary。
- barrier actors 使用同一 observation revision，动作完整密封后按声明顺序提交。
- accepted action 在成功回执前持久化；恢复复用同 decision ID，不提交部分 barrier。
- audience 只有 public、host、participants 与 group；游戏 adapter 负责授权 observation。
- 确定性 game events 与 Session、delivery、trajectory 等运行记录分离。
- SQLite adapter 使用 module-scoped migrations，不占用宿主应用的 `PRAGMA user_version`。

## 文档与决策

- 当前架构只描述已实现的系统；未来方案、迁移过程和历史复盘不进入当前态文档。
- 根 `README.md` 提供公开概览，`docs/architecture.md` 持有跨包设计，package `README.md` 持有
  包内契约，`AGENTS.md` 只持有开发指令与导航。
- 重大且难以逆转的工作以 proposed Agent Note 起步；实现完成后改写为当前态的 implemented Note。
- implemented Note 不保留执行清单、迁移计划、TODO、带日期的测试计数或未来承诺。
- 只在公共事实、跨包契约或持久治理变化时更新所属文档；代码和测试拥有精确行为。
