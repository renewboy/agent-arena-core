# Agent Note: Harness 交付门禁闭环

Status: implemented

## Problem

Core 的 repository harness、架构检查、覆盖率和构建需要在独立 checkout 中保持同一语义。工具配置、
Git hooks 或 workspace 构建产物来自消费仓时，本地检查不能证明 Core 独立交付；CI job 在依赖 package
尚未构建时读取 `dist` 也无法形成 clean-checkout 门禁。

Linux process guardian 集成行为具有独立的平台问题，不属于仓库门禁职责。

## Decision

Core 自己持有 oxfmt、oxlint、jscpd、knip 与 lefthook 配置。Pre-commit 校验 staged lint、format 和
Git whitespace；pre-push 运行完整 Core gate。Prepare 脚本在普通 Git hooks 路径安装 lefthook，在托管
全局 `core.hooksPath` 下保留由全局 hook 调用仓库 lefthook 配置的方式。

Core 的架构和文档脚本消费 `@agent-arena/harness` 提供的 dependency、file-line、Markdown link 与
required-files policies，并在其上追加产品术语隔离、Agent Note、AGENTS 层级和当前态纯净性检查。
Duplication 与 policy self-tests 属于 static gate。

AgentWolf 的公开 check、coverage 与 E2E 命令先构建 workspace packages，再读取 package exports 或
启动应用。完整 check 只在入口执行一次 bootstrap，内部测试 phase 使用已经构建的 workspace。

Linux coverage 排除 process-guardian 集成文件；macOS CI job 独立运行该文件。其他 static、coverage、
build 与 browser jobs 保持阻断。两仓 main 要求 PR 和各自适用的 required checks。

## Alternatives considered

**只补 pre-push。** 这不能消除消费仓工具配置和历史 `dist` 对本地结果的影响。

**在每个 CI job 内手写若干 package build。** Package 依赖变化后容易遗漏；统一 workspace bootstrap
让公开命令与 CI 使用同一入口。

**让已知 Linux guardian 失败继续阻断全部 CI。** 这会遮蔽其他门禁结果；macOS job 保留实际进程树
验证，Linux 行为由独立工作处理。

**只依赖本地 hooks。** Hooks 可以被 `--no-verify` 绕过，远端 required checks 才是权威边界。

## Consequences

- Core 在 submodule 与独立 checkout 中使用仓库自有且一致的 formatter、linter 和 hygiene 配置。
- Fresh install 后可以直接运行 Core gates；AgentWolf 不依赖预先存在或可能陈旧的 package dist。
- Pre-push 提供本地快速失败，GitHub main 保护阻止绕过或红色 CI 进入主分支。
- Process guardian 的 macOS 集成覆盖继续保留；Linux 集成问题没有通过弱化实现或延长超时掩盖。
- 新增仓库级配置或 required check 时，需要同步文档门禁和远端保护上下文。

## Verification

Core 在仓库外的无 dist 临时 checkout 中执行 frozen install、static、CI coverage 与 build。AgentWolf 在
无 dist 临时 checkout 中执行 frozen install、static、CI coverage、build 与浏览器套件。Hook 配置通过
lefthook 直接调用验证，CI workflow 通过 GitHub Actions 验证；远端 main 保护通过 GitHub API 回读。
