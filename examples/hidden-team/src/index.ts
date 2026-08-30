import { z } from 'zod'
import {
  GameIdSchema,
  GroupIdSchema,
  DecisionIdSchema,
  MatchIdSchema,
  ParticipantIdSchema,
  PluginIdSchema,
  RulesetIdSchema,
  SemanticIdSchema,
  canObserve,
  type GameAction,
  type GameEvent,
  type GroupId,
  type JsonValue,
  type MatchId,
  type Observer,
  type ParticipantId,
  type RulesetLock,
} from '@agent-arena/contracts'
import {
  EventJournal,
  decisionDescriptor,
  validateDecisionAction,
  validateDecisionBatch,
  type DecisionBoundary,
  type GameMachine,
  type GameModule,
  type GameObservation,
} from '@agent-arena/game-runtime'
import {
  RulesetBuilder,
  RulesetRegistrar,
  type RulePlugin,
  type SemanticOwnershipRecorder,
} from '@agent-arena/ruleset'

const ParticipantSetupSchema = z
  .object({
    id: ParticipantIdSchema,
    groupId: GroupIdSchema,
  })
  .strict()

export const HiddenTeamSetupSchema = z
  .object({
    participants: z.array(ParticipantSetupSchema).length(4),
    secrets: z.record(GroupIdSchema, z.string().trim().min(1).max(40)),
    rounds: z.number().int().min(1).max(8).default(2),
  })
  .strict()
  .superRefine((setup, context) => {
    const participantIds = setup.participants.map((participant) => participant.id)
    if (new Set(participantIds).size !== participantIds.length) {
      context.addIssue({ code: 'custom', message: 'Participant IDs must be unique' })
    }
    const counts = new Map<GroupId, number>()
    for (const participant of setup.participants) {
      counts.set(participant.groupId, (counts.get(participant.groupId) ?? 0) + 1)
    }
    if (counts.size !== 2 || [...counts.values()].some((count) => count !== 2)) {
      context.addIssue({ code: 'custom', message: 'Hidden Team requires two groups of two' })
    }
    if ([...counts.keys()].some((groupId) => setup.secrets[groupId] === undefined)) {
      context.addIssue({ code: 'custom', message: 'Every group requires one secret' })
    }
  })
export type HiddenTeamSetup = z.infer<typeof HiddenTeamSetupSchema>

const HiddenTeamOutcomeSchema = z
  .object({
    winningGroupIds: z.array(GroupIdSchema).min(1),
    scores: z.record(GroupIdSchema, z.number().int().nonnegative()),
  })
  .strict()
export type HiddenTeamOutcome = z.infer<typeof HiddenTeamOutcomeSchema>

interface HiddenTeamState {
  readonly round: number
  readonly stage: 'clue' | 'guess' | 'ended'
  readonly clues: Readonly<Record<string, string>>
  readonly scores: Readonly<Record<string, number>>
  readonly outcome: HiddenTeamOutcome | null
}

interface HiddenFacts {
  readonly round: number
  readonly stage: HiddenTeamState['stage']
  readonly scores: Readonly<Record<string, number>>
  readonly ownGroupId: string | null
  readonly ownSecret: string | null
  readonly clues: Readonly<Record<string, string>>
}

type SemanticKind = 'action' | 'event'

class HiddenTeamRegistrar extends RulesetRegistrar<SemanticKind> {
  public readonly actions = new Set<string>()
  public readonly events = new Set<string>()

  public constructor(ownership: SemanticOwnershipRecorder<SemanticKind>) {
    super(ownership)
  }

  public action(value: string): void {
    this.own('action', SemanticIdSchema.parse(value))
    this.actions.add(value)
  }

  public event(value: string): void {
    this.own('event', SemanticIdSchema.parse(value))
    this.events.add(value)
  }
}

const hiddenTeamPlugin: RulePlugin<HiddenTeamRegistrar> = {
  id: PluginIdSchema.parse('plugin-hidden-team'),
  version: 1,
  register: (registrar) => {
    for (const action of ['clue.submit', 'guess.submit']) registrar.action(action)
    for (const event of [
      'match.started',
      'group.secret',
      'clue.published',
      'guess.revealed',
      'score.changed',
      'round.started',
      'match.ended',
    ]) {
      registrar.event(event)
    }
  },
}

const CluePayloadSchema = z.object({ text: z.string().trim().min(1).max(120) }).strict()
const GuessPayloadSchema = z
  .object({ targetGroupId: GroupIdSchema, value: z.string().trim().min(1).max(40) })
  .strict()

export function createHiddenTeamModule(): GameModule<
  HiddenTeamSetup,
  HiddenTeamState,
  HiddenFacts,
  HiddenTeamOutcome
> {
  const ruleset = new RulesetBuilder({
    id: RulesetIdSchema.parse('ruleset-hidden-team'),
    revision: 1,
    semanticKinds: ['action', 'event'] as const,
    plugins: [hiddenTeamPlugin],
    createRegistrar: (ownership) => new HiddenTeamRegistrar(ownership),
    finalize: ({ registrar }) => ({
      actions: Object.freeze([...registrar.actions]),
      events: Object.freeze([...registrar.events]),
    }),
  }).build()
  return new HiddenTeamModule(ruleset.lock)
}

class HiddenTeamModule implements GameModule<
  HiddenTeamSetup,
  HiddenTeamState,
  HiddenFacts,
  HiddenTeamOutcome
> {
  public readonly id = GameIdSchema.parse('game-hidden-team')
  public readonly setupSchema = HiddenTeamSetupSchema
  public readonly outcomeSchema = HiddenTeamOutcomeSchema

  public constructor(public readonly ruleset: RulesetLock) {}

  public create(options: {
    readonly matchId: MatchId
    readonly setup: HiddenTeamSetup
    readonly seed: number
    readonly clock?: () => Date
  }): HiddenTeamMachine {
    const setup = this.setupSchema.parse(options.setup)
    const machine = new HiddenTeamMachine(options.matchId, setup, [], options.clock)
    machine.start()
    return machine
  }

  public restore(options: {
    readonly matchId: MatchId
    readonly setup: HiddenTeamSetup
    readonly events: readonly GameEvent[]
    readonly clock?: () => Date
  }): HiddenTeamMachine {
    return new HiddenTeamMachine(
      options.matchId,
      this.setupSchema.parse(options.setup),
      options.events,
      options.clock,
    )
  }

  public observe(machine: HiddenTeamMachine, observer: Observer): GameObservation<HiddenFacts> {
    const groupId =
      observer.kind === 'participant'
        ? (machine.setup.participants.find(
            (participant) => participant.id === observer.participantId,
          )?.groupId ?? null)
        : null
    const visible = machine.events.filter((event) =>
      canObserve(event.audience, observer, this.groups(machine)),
    )
    return {
      revision: machine.events.at(-1)?.sequence ?? 0,
      observer,
      visibleEventSequences: visible.map((event) => event.sequence),
      facts: {
        round: machine.state.round,
        stage: machine.state.stage,
        scores: machine.state.scores,
        ownGroupId: groupId,
        ownSecret:
          observer.kind === 'host'
            ? null
            : groupId
              ? (machine.setup.secrets[groupId] ?? null)
              : null,
        clues: machine.state.clues,
      },
    }
  }

  public groups(machine: HiddenTeamMachine): ReadonlyMap<string, ReadonlySet<ParticipantId>> {
    const groups = new Map<string, Set<ParticipantId>>()
    for (const participant of machine.setup.participants) {
      const members = groups.get(participant.groupId) ?? new Set<ParticipantId>()
      members.add(participant.id)
      groups.set(participant.groupId, members)
    }
    return groups
  }
}

class HiddenTeamMachine implements GameMachine<HiddenTeamState, HiddenTeamOutcome> {
  readonly #journal: EventJournal<HiddenTeamState>

  public constructor(
    public readonly matchId: MatchId,
    public readonly setup: HiddenTeamSetup,
    events: readonly GameEvent[],
    clock?: () => Date,
  ) {
    this.#journal = new EventJournal({
      matchId,
      initialState: initialState(setup),
      reducer: reduceHiddenTeamEvent,
      events,
      ...(clock ? { clock } : {}),
    })
  }

  public get state(): HiddenTeamState {
    return this.#journal.state
  }

  public get events(): readonly GameEvent[] {
    return this.#journal.events
  }

  public get outcome(): HiddenTeamOutcome | null {
    return this.state.outcome
  }

  public start(): void {
    if (this.events.length > 0) return
    this.#journal.append({
      eventType: SemanticIdSchema.parse('match.started'),
      schemaVersion: 1,
      audience: { kind: 'public' },
      payload: { round: 1 },
    })
    for (const [groupId, secret] of Object.entries(this.setup.secrets)) {
      this.#journal.append({
        eventType: SemanticIdSchema.parse('group.secret'),
        schemaVersion: 1,
        audience: { kind: 'group', groupId: GroupIdSchema.parse(groupId) },
        payload: { groupId, secret },
      })
    }
  }

  public currentDecision(): DecisionBoundary | null {
    if (this.state.stage === 'ended') return null
    const groups = groupParticipants(this.setup)
    const actorIndex = (this.state.round - 1) % 2
    const actionType = this.state.stage === 'clue' ? 'clue.submit' : 'guess.submit'
    return {
      id: DecisionIdSchema.parse(`decision-${this.state.stage}-${this.state.round}`),
      kind: SemanticIdSchema.parse(actionType),
      mode: 'barrier',
      observationRevision: this.#journal.revision,
      actors: [...groups.values()].map((members) => ({
        participantId: members[this.state.stage === 'clue' ? actorIndex : 1 - actorIndex]!,
        actions: [
          {
            actionType: SemanticIdSchema.parse(actionType),
            toolName: this.state.stage === 'clue' ? 'submit_clue' : 'submit_guess',
            inputMode: this.state.stage === 'clue' ? 'text' : 'structured',
            schema: this.state.stage === 'clue' ? CluePayloadSchema : GuessPayloadSchema,
            ...(this.state.stage === 'clue' ? { streamAudience: { kind: 'public' as const } } : {}),
          },
        ],
      })),
    }
  }

  public validate(action: GameAction): GameAction {
    const boundary = this.currentDecision()
    if (!boundary) throw new Error('Hidden Team has ended')
    const parsed = validateDecisionAction(boundary, action)
    if (parsed.actionType === 'guess.submit') {
      const payload = GuessPayloadSchema.parse(parsed.payload)
      const actorGroup = participantGroup(this.setup, parsed.actorId)
      if (payload.targetGroupId === actorGroup) throw new Error('A group must guess another group')
    }
    return parsed
  }

  public submit(inputs: readonly GameAction[]): readonly GameEvent[] {
    const boundary = this.currentDecision()
    if (!boundary) throw new Error('Hidden Team has ended')
    const actions = validateDecisionBatch(boundary, inputs).map((action) => this.validate(action))
    const from = this.#journal.revision
    if (this.state.stage === 'clue') this.#submitClues(actions)
    else this.#submitGuesses(actions)
    return this.events.slice(from)
  }

  #submitClues(actions: readonly GameAction[]): void {
    for (const action of actions) {
      const groupId = participantGroup(this.setup, action.actorId)
      const payload = CluePayloadSchema.parse(action.payload)
      this.#journal.append({
        eventType: SemanticIdSchema.parse('clue.published'),
        schemaVersion: 1,
        audience: { kind: 'public' },
        payload: { groupId, actorId: action.actorId, text: payload.text },
      })
    }
  }

  #submitGuesses(actions: readonly GameAction[]): void {
    for (const action of actions) {
      const groupId = participantGroup(this.setup, action.actorId)
      const payload = GuessPayloadSchema.parse(action.payload)
      const correct = this.setup.secrets[payload.targetGroupId] === payload.value
      this.#journal.append({
        eventType: SemanticIdSchema.parse('guess.revealed'),
        schemaVersion: 1,
        audience: { kind: 'public' },
        payload: { groupId, actorId: action.actorId, ...payload, correct },
      })
      if (correct) {
        this.#journal.append({
          eventType: SemanticIdSchema.parse('score.changed'),
          schemaVersion: 1,
          audience: { kind: 'public' },
          payload: { groupId, delta: 1 },
        })
      }
    }
    if (this.state.round >= this.setup.rounds) {
      const highScore = Math.max(...Object.values(this.state.scores))
      const winningGroupIds = Object.entries(this.state.scores)
        .filter(([, score]) => score === highScore)
        .map(([groupId]) => groupId)
      this.#journal.append({
        eventType: SemanticIdSchema.parse('match.ended'),
        schemaVersion: 1,
        audience: { kind: 'public' },
        payload: { winningGroupIds, scores: this.state.scores },
      })
    } else {
      this.#journal.append({
        eventType: SemanticIdSchema.parse('round.started'),
        schemaVersion: 1,
        audience: { kind: 'public' },
        payload: { round: this.state.round + 1 },
      })
    }
  }
}

function initialState(setup: HiddenTeamSetup): HiddenTeamState {
  return {
    round: 1,
    stage: 'clue',
    clues: {},
    scores: Object.fromEntries(Object.keys(setup.secrets).map((groupId) => [groupId, 0])),
    outcome: null,
  }
}

function reduceHiddenTeamEvent(state: HiddenTeamState, event: GameEvent): HiddenTeamState {
  const payload = event.payload as Record<string, JsonValue>
  switch (event.eventType) {
    case 'clue.published':
      return {
        ...state,
        clues: {
          ...state.clues,
          [GroupIdSchema.parse(payload['groupId'])]: z.string().parse(payload['text']),
        },
        stage: Object.keys(state.clues).length === 1 ? 'guess' : state.stage,
      }
    case 'score.changed': {
      const groupId = GroupIdSchema.parse(payload['groupId'])
      return {
        ...state,
        scores: {
          ...state.scores,
          [groupId]: (state.scores[groupId] ?? 0) + Number(payload['delta']),
        },
      }
    }
    case 'round.started':
      return { ...state, round: Number(payload['round']), stage: 'clue', clues: {} }
    case 'match.ended':
      return {
        ...state,
        stage: 'ended',
        outcome: HiddenTeamOutcomeSchema.parse(payload),
      }
    default:
      return state
  }
}

function groupParticipants(setup: HiddenTeamSetup): ReadonlyMap<GroupId, ParticipantId[]> {
  const groups = new Map<GroupId, ParticipantId[]>()
  for (const participant of setup.participants) {
    const members = groups.get(participant.groupId) ?? []
    members.push(participant.id)
    groups.set(participant.groupId, members)
  }
  return groups
}

function participantGroup(setup: HiddenTeamSetup, participantId: ParticipantId): GroupId {
  const participant = setup.participants.find((candidate) => candidate.id === participantId)
  if (!participant) throw new Error(`Unknown participant ${participantId}`)
  return participant.groupId
}

export function hiddenTeamAction(input: {
  readonly matchId?: string
  readonly decisionId: string
  readonly actorId: string
  readonly actionType: 'clue.submit' | 'guess.submit'
  readonly payload: JsonValue
}): GameAction {
  return {
    matchId: MatchIdSchema.parse(input.matchId ?? 'match-hidden-team'),
    decisionId: DecisionIdSchema.parse(input.decisionId),
    actorId: ParticipantIdSchema.parse(input.actorId),
    actionType: SemanticIdSchema.parse(input.actionType),
    payload: input.payload,
  }
}

export function hiddenTeamSetup(): HiddenTeamSetup {
  return HiddenTeamSetupSchema.parse({
    participants: [
      { id: 'participant-red-one', groupId: 'group-red' },
      { id: 'participant-red-two', groupId: 'group-red' },
      { id: 'participant-blue-one', groupId: 'group-blue' },
      { id: 'participant-blue-two', groupId: 'group-blue' },
    ],
    secrets: { 'group-red': 'ember', 'group-blue': 'ocean' },
    rounds: 2,
  })
}

export function assertHiddenTeamBoundary(boundary: DecisionBoundary): void {
  decisionDescriptor(boundary)
}
