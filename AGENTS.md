# Agent Arena Core 仓库指南

本仓库提供跨游戏复用的规则组合、确定性运行时和验证能力。游戏模块拥有自己的状态、动作、事件、
观察事实和呈现语义。

## 边界

- `acp-runtime` 是独立协议与进程包；`contracts` 是底层共享词汇；在内部 package 依赖图中，
  `ruleset`、`game-runtime`、`simulation` 与 `trajectory` 只依赖 `contracts`；examples 可以依赖全部
  生产 packages。
- 生产 packages 只定义跨游戏契约，具体语义由游戏模块通过公开扩展点注册。
- Ruleset 负责编译游戏插件；Match host 只消费 `GameModule` 与 decision boundary。
- 确定性 game events 与 Session、delivery、trajectory 等运行记录分离。
- 跨 JSON、配置或持久化边界使用 Zod；跨包 IDs 使用 branded types。
- 新抽象必须由至少两个不同 conformance games 或一个 conformance game 与一个独立游戏模块共同
  证明。

## 代码与文档

- 使用 ESM、严格 TypeScript、穷举封闭 union，不执行 shell 字符串插值。
- package README 拥有包内契约；`docs/architecture.md` 拥有跨包结构。
- 持久化文档使用中文，专有术语保留英文。
- 保留无关改动，只提交经过验证的明确路径。

## 验证

```sh
pnpm check:architecture
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:coverage
pnpm build
pnpm check
```

每个产品源码文件的 statements、branches、functions 与 lines 均至少达到 80%。
