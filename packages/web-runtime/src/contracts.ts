export type LiveConnectionState = 'connecting' | 'live' | 'reconnecting' | 'settled' | 'unavailable'

export type LiveServerEvent<Observer, Projection, Transient, ControlState> =
  | {
      readonly type: 'snapshot'
      readonly observer: Observer
      readonly projection: Projection
    }
  | {
      readonly type: 'transient'
      readonly value: Transient
    }
  | {
      readonly type: 'control'
      readonly state: ControlState
    }
  | {
      readonly type: 'error'
      readonly error: Error
      readonly fatal?: boolean
    }

export type LiveClientCommand<Observer, ControlCommand> =
  | { readonly type: 'observer.set'; readonly observer: Observer }
  | { readonly type: 'control'; readonly command: ControlCommand }

export interface LiveProjectionState<Projection, ControlState> {
  readonly projection: Projection | null
  readonly controlState: ControlState
  readonly connectionState: LiveConnectionState
  readonly observerPending: boolean
  readonly error: Error | null
}

export interface LiveChannel<Observer, ControlCommand> {
  send(command: LiveClientCommand<Observer, ControlCommand>): boolean
  close(): void
}

export interface LiveChannelHandlers<Observer, Projection, Transient, ControlState> {
  open(): void
  event(event: LiveServerEvent<Observer, Projection, Transient, ControlState>): void
  error(error: unknown): void
  close(): void
}

export interface LiveProjectionTransport<
  Observer,
  Projection,
  Transient,
  ControlState,
  ControlCommand,
> {
  loadSnapshot(observer: Observer, signal: AbortSignal): Promise<Projection>
  openChannel(
    observer: Observer,
    handlers: LiveChannelHandlers<Observer, Projection, Transient, ControlState>,
  ): LiveChannel<Observer, ControlCommand>
}

export interface RuntimeScheduler<Handle = unknown> {
  set(delayMs: number, callback: () => void): Handle
  clear(handle: Handle): void
}

export interface LiveProjectionControllerOptions<
  Observer,
  Projection,
  Transient,
  ControlState,
  ControlCommand,
  TimerHandle = unknown,
> {
  readonly observer: Observer
  readonly initialControlState: ControlState
  readonly transport: LiveProjectionTransport<
    Observer,
    Projection,
    Transient,
    ControlState,
    ControlCommand
  >
  readonly scheduler: RuntimeScheduler<TimerHandle>
  readonly observerKey: (observer: Observer) => string
  readonly applyTransient: (projection: Projection, transient: Transient) => Projection
  readonly isSettled: (projection: Projection) => boolean
  readonly isUnavailableError: (error: unknown) => boolean
  readonly disconnectedControlState: (current: ControlState) => ControlState
  readonly initialReconnectDelayMs?: number
  readonly maximumReconnectDelayMs?: number
}

export type PresentationOutcome = 'completed' | 'skipped'
export type PresentationWaitOutcome = PresentationOutcome | 'not-required'

export interface PresentationBarrierState<Key> {
  readonly enabled: boolean
  readonly controlledByThisConnection: boolean
  readonly pendingKey: Key | null
}

export type PresentationControlEvent<Key> =
  | { readonly type: 'presentation.enabled'; readonly enabled: boolean }
  | {
      readonly type: 'presentation.resolved'
      readonly key: Key
      readonly outcome: PresentationOutcome
    }
  | { readonly type: 'presentation.disconnected'; readonly key: Key | null }

export interface PlaybackCallbacks {
  end(): void
  error(error?: unknown): void
}

export interface PlaybackPort {
  readonly supported: boolean
  speak(text: string, callbacks: PlaybackCallbacks): void
  cancel(): void
}

export type PlaybackNotice =
  | 'automatic-unsupported-skipped'
  | 'automatic-failed-skipped'
  | 'manual-failed'

export interface PresentationPlaybackState<Actor> {
  readonly supported: boolean
  readonly automaticSequence: number | null
  readonly automaticActor: Actor | null
  readonly automaticBusy: boolean
  readonly manualSequence: number | null
  readonly notice: PlaybackNotice | null
}

export interface PresentationStream<Actor> {
  readonly actor: Actor
  readonly text: string
  readonly final: boolean
}

export interface PresentationPlaybackUpdate<Item, Actor> {
  readonly items: readonly Item[]
  readonly activeStream: PresentationStream<Actor> | null
  readonly controlled: boolean
  readonly pendingSequence: number | null
  readonly projectionKey: string
  readonly observerPending: boolean
}

export interface SegmentedText {
  readonly segments: readonly string[]
  readonly consumedLength: number
}

export interface PresentationPlaybackOptions<Item, Actor> {
  readonly port: PlaybackPort
  readonly isPresentable: (item: Item) => boolean
  readonly sequence: (item: Item) => number
  readonly actor: (item: Item) => Actor | null
  readonly text: (item: Item) => string
  readonly segment: (text: string) => SegmentedText
  readonly sameActor: (left: Actor, right: Actor) => boolean
  readonly resolve: (sequence: number, outcome: PresentationOutcome) => boolean
}

export interface FollowLatestState {
  readonly following: boolean
  readonly detachedByUser: boolean
  readonly hasNewActivity: boolean
}

export interface SequencedCueState<Cue> {
  readonly current: Cue | null
  readonly pendingCount: number
}
