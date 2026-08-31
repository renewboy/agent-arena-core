# Agent Note: Web 运行时与 React 平台边界

Status: implemented

## Problem

多 Agent 游戏的浏览器客户端共同需要投影追平、实时连接、observer 切换、流式呈现、播放门控、
sequence cue、跟随最新和开发者检查器。这些行为如果依附某个游戏的 View、wire、文案、CSS 或舞台
组件，其他游戏只能复制产品 UI；如果 Core 定义带大量可选字段的通用 Match View，游戏隐藏信息和
呈现语义又会反向进入平台。

实时连接还跨越 server 与 browser 生命周期。投影必须先在 server 完成授权，客户端只消费已过滤
DTO；observer pending 只能保护过渡交互，不能成为授权机制。播放失败、断线和浏览器不支持音频时
必须释放 presentation barrier，不能阻塞 Match runtime。

## Decision

Core 以三个 package 提供 Web 平台能力：

- `@agent-arena/web-runtime` 拥有无 React、无 DOM 的 live projection、typed subscription、
  presentation barrier/playback、follow-latest 与 sequenced cue controllers。网络、计时、音频和
  产品 wire 通过 ports 与 adapters 注入。
- `@agent-arena/react` 通过 external-store hooks 订阅 controllers，并提供显式 browser speech port
  与无样式 Select、Dialog、Confirm、异步动作 primitives。React 和 ReactDOM 是 peer dependencies。
- `@agent-arena/devtools-react` 通过 data source ports 管理 trajectory summary/page/delta、虚拟浏览和
  simulation review workflow。游戏 metadata、领域 audit 与 Session debug 通过 adapter 或 slots 组合。

Core 只定义规范化 live event/command、状态所有权与故障语义，不规定游戏 HTTP path、JSON wire 或
Match View。游戏 projector 和 schema 在进入 controller 前完成授权与解析。CSS、copy、icons、route、
舞台、动画和产品 renderer 由消费者拥有。

`hidden-team` 验证 group-private projection、公开 stream 与 presentation visibility；`reaction-card`
验证 participant-private projection、追平重连与 nested-response cue reset。AgentWolf 通过固定 submodule
revision 消费三个 package，同时保持现有 REST/WebSocket DTO、数据库、文案和视觉 renderer。

## Alternatives considered

**复制 AgentWolf Web 应用作为新游戏模板。** 这会复制连接恢复、播放门控和可访问交互，并让修复在
多个产品仓形成分叉。

**在 Core 定义统一 Match View 和完整舞台组件。** 不同游戏的座位、卡牌、地图、任务轨道和隐藏信息
模型无法收敛为稳定字段，通用 schema 会把产品语义带入平台。

**只抽 React 组件。** 实时状态、server barrier 与非 React consumer 仍无法复用，测试也只能依赖 DOM。

**把全部开发者页面留在产品。** Trajectory revision merge、分页和 simulation approval workflow 会在
每个游戏重复实现；领域 renderer 通过 adapter 保持产品边界。

## Consequences

- 新游戏提供自己的 projection schema、transport adapter、observer key、终局判断和 renderer，无需
  扩展 Core Match View。
- server 可以复用单控制者 presentation barrier，browser 可以复用 stream/commit playback、重连、
  follow-latest 和 cue baseline，同时保持游戏 visibility 与 wire 不变。
- React primitives 不携带设计系统；产品通过 class names、copy 和 slots 保持独立视觉语言。
- Devtools state 与领域详情分离。Core 管理通用 revision/page/review 生命周期，产品管理 owner metadata、
  timeline group、audit、Session/delivery inspector 和路由授权。
- Core API 同时由两个 conformance games 和 AgentWolf consumer 约束；只服务单一 renderer 的字段不能
  进入公共契约。

## Verification

Core 门禁验证无浏览器全局的 Web runtime、StrictMode hooks、可访问 primitives、trajectory/simulation
devtools、逐文件覆盖率与两个 conformance games。AgentWolf 门禁验证 server live/playback adapter、
Web DTO、view pending、speech、motion、developer workflows、production build、simulation corpus 与
Playwright 可见行为。两仓分别构建和审查，AgentWolf 只固定已提交 Core revision。
