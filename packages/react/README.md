# React adapters

`@agent-arena/react` 将 `@agent-arena/web-runtime` controller 接入 React，并提供不携带视觉资产的可访问
交互 primitives。

## Runtime hooks

`useLiveProjection` 启动并订阅 `LiveProjectionController`；`usePresentationPlayback`、
`useFollowLatest` 与 `useSequencedCues` 把对应 controller state 暴露给 renderer。Hooks 延迟最终 dispose，
使 React StrictMode 的 setup/cleanup/setup 探测不会销毁仍在使用的 controller。

## Browser port

`createBrowserSpeechPort` 是 SpeechSynthesis 的显式边界。模块 import 不访问 DOM；调用方在浏览器组合层
创建 port，并注入语言、速率、音高和音量。

## Primitives

`Select` 持有 listbox 键盘、typeahead、portal 与 viewport positioning。`Dialog` 持有 Escape、背景 inert、
focus trap 和 focus restore。`ConfirmDialog` 只组合 Dialog 行为；copy、icon 与全部 class name 由调用方
传入。`useAsyncAction` 表达一次异步动作的 idle/working/success/error 状态。

本包不导出 CSS、主题、图标、产品文案或游戏 renderer。
