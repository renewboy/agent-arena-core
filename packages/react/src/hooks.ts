import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type {
  FollowLatestController,
  FollowLatestState,
  LiveProjectionController,
  LiveProjectionState,
  PresentationPlaybackController,
  PresentationPlaybackState,
  PresentationPlaybackUpdate,
  SequencedCueQueue,
  SequencedCueState,
  SequencedCueUpdate,
} from '@agent-arena/web-runtime'

interface ExternalController<State> {
  snapshot(): State
  subscribe(listener: () => void): () => void
  dispose(): void
}

function useManagedController<State>(
  controller: ExternalController<State>,
  start?: () => void,
): State {
  const lifecycle = useRef(0)
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  )
  const snapshot = useCallback(() => controller.snapshot(), [controller])
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    lifecycle.current += 1
    start?.()
    return () => {
      const cleanup = ++lifecycle.current
      queueMicrotask(() => {
        if (lifecycle.current === cleanup) controller.dispose()
      })
    }
  }, [controller, start])
  return state
}

export function useLiveProjection<
  Observer,
  Projection,
  Transient,
  ControlState,
  ControlCommand,
  TimerHandle,
>(
  controller: LiveProjectionController<
    Observer,
    Projection,
    Transient,
    ControlState,
    ControlCommand,
    TimerHandle
  >,
): LiveProjectionState<Projection, ControlState> {
  const start = useCallback(() => controller.start(), [controller])
  return useManagedController(controller, start)
}

export function usePresentationPlayback<Item, Actor>(
  controller: PresentationPlaybackController<Item, Actor>,
  update: PresentationPlaybackUpdate<Item, Actor>,
): PresentationPlaybackState<Actor> {
  const state = useManagedController(controller)
  useEffect(() => controller.update(update), [controller, update])
  return state
}

export function useFollowLatest(controller: FollowLatestController): FollowLatestState {
  return useManagedController(controller)
}

export function useSequencedCues<Cue, Key>(
  controller: SequencedCueQueue<Cue, Key>,
  update: SequencedCueUpdate<Cue>,
): SequencedCueState<Cue> {
  const state = useManagedController(controller)
  useEffect(() => controller.update(update), [controller, update])
  return state
}
