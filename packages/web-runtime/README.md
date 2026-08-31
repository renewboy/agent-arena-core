# Web runtime

`@agent-arena/web-runtime` 为 server 与 browser 组合层提供无框架状态机，不持有游戏 View、产品 wire
或浏览器 IO。

## Live projection

`LiveProjectionController` 通过 `LiveProjectionTransport` 并发加载权威 snapshot 与建立 typed channel。
Transport 把产品 wire 解析为 `snapshot`、`transient`、`control` 或 `error` event；controller 拥有连接
状态、observer pending、追平、退避、missing/settled 与 dispose。游戏 adapter 提供 observer key、
transient reducer、终局判断和 unavailable error 分类。

`LiveSubscriptionHub` 只管理 typed subscriber 集合。投影和 stream visibility 由调用方在 broadcast
projector 中决定，hub 不读取游戏状态。

## Presentation

`PresentationBarrierCoordinator` 在 server 侧持有一个可选 controller 与一个 pending item。它只接受
精确 key 的完成或跳过回执；observer 变化、controller 断线或 close 会释放不可继续的 pending item。

`PresentationPlaybackController` 在 client 侧合并 committed item 与增量 stream，维护自动/手动播放
互斥，并通过注入的 `PlaybackPort` 执行音频。浏览器不支持、播放失败、projection 切换和显式 skip
都产生稳定 outcome，不让 presentation barrier 永久悬挂。

## 本地交互状态

`FollowLatestController` 表达跟随末尾、用户脱离和新活动提示；DOM 或 virtualizer adapter 执行实际
滚动。`SequencedCueQueue` 按 projection 建立 baseline，按 sequence 排序并按 key 去重；renderer 在
完成当前 cue 后显式推进。

## 边界

- server projector 在数据进入本包前完成隐私过滤；observer pending 不是授权机制。
- 本包不直接访问 fetch、WebSocket、SpeechSynthesis、DOM 或全局 timer。
- 精确 wire schema、错误文案、CSS、图标和页面 renderer 由消费者拥有。
