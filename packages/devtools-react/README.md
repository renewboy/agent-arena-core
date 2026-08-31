# Devtools React

`@agent-arena/devtools-react` 提供可选的 trajectory explorer 和 simulation review UI。它不注册路由、
不决定 developer mode，也不持有游戏 metadata。

## Trajectory explorer

`useTrajectoryExplorer` 通过 `TrajectoryDataSource` 加载 summary 与 owner page，合并 revision delta、分页
历史记录、保存 query/selection，并在 resource 或 owner 变化时取消旧请求。Data source 负责产品 wire
解析；hook 只处理 Core `TrajectoryTurnBase`、`TrajectoryRecordBase` 及 revision/ID 契约。

`TrajectoryMinimap`、`TrajectoryLedger` 与 `TrajectoryInspector` 是无样式组件。Timeline group、record
label/preview、时间格式、class names 和详情 renderer 由调用方提供。

## Simulation review

`useSimulationReview` 拥有 prepare/reviewing/review/approving/complete 状态，以及 warning acknowledgement、
accept-current 和 secret blocking。`SimulationReviewWizard` 渲染无样式的可访问步骤；copy、checks、
icons 与 class names 由调用方提供。

本包不包含产品 audit 规则、Session/delivery inspector、Role badge、Match metadata 或 CSS。
