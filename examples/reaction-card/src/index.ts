import { z } from 'zod'
import {
  DecisionIdSchema,
  GameIdSchema,
  MatchIdSchema,
  ParticipantIdSchema,
  PluginIdSchema,
  RulesetIdSchema,
  SemanticIdSchema,
  canObserve,
  type GameAction,
  type GameEvent,
  type JsonValue,
  type MatchId,
  type Observer,
  type ParticipantId,
  type RulesetLock,
} from '@agent-arena/contracts'
import {
  EventJournal,
  SeededRandom,
  shuffled,
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

const CardSchema = z.enum(['strike', 'guard', 'focus'])
type Card = z.infer<typeof CardSchema>

export const ReactionCardSetupSchema = z
  .object({
    participants: z.array(ParticipantIdSchema).length(2),
    startingHealth: z.number().int().min(1).max(10).default(2),
    deck: z.array(CardSchema).min(4).optional(),
  })
  .strict()
  .superRefine((setup, context) => {
    if (new Set(setup.participants).size !== setup.participants.length) {
      context.addIssue({ code: 'custom', message: 'Participant IDs must be unique' })
    }
  })
export type ReactionCardSetup = z.infer<typeof ReactionCardSetupSchema>

const ReactionCardOutcomeSchema = z
  .object({
    winnerId: ParticipantIdSchema,
    health: z.record(ParticipantIdSchema, z.number().int()),
  })
  .strict()
export type ReactionCardOutcome = z.infer<typeof ReactionCardOutcomeSchema>

interface PendingStrike {
  readonly attackerId: ParticipantId
  readonly targetId: ParticipantId
}

interface ReactionCardState {
  readonly participants: readonly ParticipantId[]
  readonly activeIndex: number
  readonly stage: 'main' | 'response' | 'ended'
  readonly health: Readonly<Record<string, number>>
  readonly hands: Readonly<Record<string, readonly Card[]>>
  readonly deck: readonly Card[]
  readonly pendingStrike: PendingStrike | null
  readonly outcome: ReactionCardOutcome | null
}

interface ReactionFacts {
  readonly stage: ReactionCardState['stage']
  readonly activeParticipantId: string
  readonly health: Readonly<Record<string, number>>
  readonly hand: readonly Card[]
  readonly handCounts: Readonly<Record<string, number>>
  readonly deckCount: number
}

type SemanticKind = 'action' | 'event' | 'card'

class ReactionRegistrar extends RulesetRegistrar<SemanticKind> {
  public readonly actions = new Set<string>()
  public readonly events = new Set<string>()
  public readonly cards = new Set<string>()

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

  public card(value: Card): void {
    this.own('card', SemanticIdSchema.parse(`card.${value}`))
    this.cards.add(value)
  }
}

const turnPlugin: RulePlugin<ReactionRegistrar> = {
  id: PluginIdSchema.parse('plugin-reaction-turn'),
  version: 1,
  register: (registrar) => {
    for (const action of ['turn.pass', 'response.pass']) registrar.action(action)
    for (const event of ['match.started', 'deck.configured', 'card.drawn', 'turn.changed']) {
      registrar.event(event)
    }
  },
}

const cardPlugin: RulePlugin<ReactionRegistrar> = {
  id: PluginIdSchema.parse('plugin-reaction-cards'),
  version: 1,
  requires: [{ id: turnPlugin.id, version: 1 }],
  register: (registrar) => {
    for (const card of CardSchema.options) registrar.card(card)
    for (const action of ['card.play', 'card.respond']) registrar.action(action)
    for (const event of [
      'card.played',
      'strike.pending',
      'strike.blocked',
      'damage.dealt',
      'match.ended',
    ]) {
      registrar.event(event)
    }
  },
}

const PlayPayloadSchema = z.object({ card: z.enum(['strike', 'focus']) }).strict()
const RespondPayloadSchema = z.object({ card: z.literal('guard') }).strict()
const PassPayloadSchema = z.object({}).strict()

export function createReactionCardModule(): GameModule<
  ReactionCardSetup,
  ReactionCardState,
  ReactionFacts,
  ReactionCardOutcome
> {
  const ruleset = new RulesetBuilder({
    id: RulesetIdSchema.parse('ruleset-reaction-card'),
    revision: 1,
    semanticKinds: ['action', 'event', 'card'] as const,
    plugins: [cardPlugin, turnPlugin],
    createRegistrar: (ownership) => new ReactionRegistrar(ownership),
    finalize: ({ registrar }) => ({
      actions: Object.freeze([...registrar.actions]),
      events: Object.freeze([...registrar.events]),
      cards: Object.freeze([...registrar.cards]),
    }),
  }).build()
  return new ReactionCardModule(ruleset.lock)
}

class ReactionCardModule implements GameModule<
  ReactionCardSetup,
  ReactionCardState,
  ReactionFacts,
  ReactionCardOutcome
> {
  public readonly id = GameIdSchema.parse('game-reaction-card')
  public readonly setupSchema = ReactionCardSetupSchema
  public readonly outcomeSchema = ReactionCardOutcomeSchema

  public constructor(public readonly ruleset: RulesetLock) {}

  public create(options: {
    readonly matchId: MatchId
    readonly setup: ReactionCardSetup
    readonly seed: number
    readonly clock?: () => Date
  }): ReactionCardMachine {
    const setup = this.setupSchema.parse(options.setup)
    const machine = new ReactionCardMachine(options.matchId, setup, [], options.clock)
    machine.start(options.seed)
    return machine
  }

  public restore(options: {
    readonly matchId: MatchId
    readonly setup: ReactionCardSetup
    readonly events: readonly GameEvent[]
    readonly clock?: () => Date
  }): ReactionCardMachine {
    return new ReactionCardMachine(
      options.matchId,
      this.setupSchema.parse(options.setup),
      options.events,
      options.clock,
    )
  }

  public observe(machine: ReactionCardMachine, observer: Observer): GameObservation<ReactionFacts> {
    const visible = machine.events.filter((event) => canObserve(event.audience, observer))
    const participantId = observer.kind === 'participant' ? observer.participantId : null
    return {
      revision: machine.events.at(-1)?.sequence ?? 0,
      observer,
      visibleEventSequences: visible.map((event) => event.sequence),
      facts: {
        stage: machine.state.stage,
        activeParticipantId: machine.state.participants[machine.state.activeIndex]!,
        health: machine.state.health,
        hand: participantId ? (machine.state.hands[participantId] ?? []) : [],
        handCounts: Object.fromEntries(
          machine.state.participants.map((id) => [id, machine.state.hands[id]?.length ?? 0]),
        ),
        deckCount: machine.state.deck.length,
      },
    }
  }

  public groups(): ReadonlyMap<string, ReadonlySet<ParticipantId>> {
    return new Map()
  }
}

class ReactionCardMachine implements GameMachine<ReactionCardState, ReactionCardOutcome> {
  readonly #journal: EventJournal<ReactionCardState>

  public constructor(
    public readonly matchId: MatchId,
    public readonly setup: ReactionCardSetup,
    events: readonly GameEvent[],
    clock?: () => Date,
  ) {
    this.#journal = new EventJournal({
      matchId,
      initialState: initialState(setup),
      reducer: reduceReactionEvent,
      events,
      ...(clock ? { clock } : {}),
    })
  }

  public get state(): ReactionCardState {
    return this.#journal.state
  }

  public get events(): readonly GameEvent[] {
    return this.#journal.events
  }

  public get outcome(): ReactionCardOutcome | null {
    return this.state.outcome
  }

  public start(seed: number): void {
    if (this.events.length > 0) return
    this.#journal.append({
      eventType: SemanticIdSchema.parse('match.started'),
      schemaVersion: 1,
      audience: { kind: 'public' },
      payload: { participants: this.setup.participants, startingHealth: this.setup.startingHealth },
    })
    const sourceDeck = this.setup.deck ?? [
      'strike',
      'guard',
      'focus',
      'strike',
      'guard',
      'focus',
      'strike',
      'guard',
    ]
    const deck = this.setup.deck ? [...sourceDeck] : shuffled(sourceDeck, new SeededRandom(seed))
    this.#journal.append({
      eventType: SemanticIdSchema.parse('deck.configured'),
      schemaVersion: 1,
      audience: { kind: 'host' },
      payload: { cards: deck },
    })
    for (const participantId of this.setup.participants) this.#draw(participantId)
  }

  public currentDecision(): DecisionBoundary | null {
    if (this.state.stage === 'ended') return null
    const participantId =
      this.state.stage === 'response'
        ? this.state.pendingStrike!.targetId
        : this.state.participants[this.state.activeIndex]!
    const response = this.state.stage === 'response'
    return {
      id: DecisionIdSchema.parse(`decision-${this.state.stage}-${this.#journal.revision + 1}`),
      kind: SemanticIdSchema.parse(response ? 'response.choose' : 'turn.choose'),
      mode: 'single',
      observationRevision: this.#journal.revision,
      actors: [
        {
          participantId,
          actions: response
            ? [
                {
                  actionType: SemanticIdSchema.parse('card.respond'),
                  toolName: 'respond_card',
                  inputMode: 'structured',
                  schema: RespondPayloadSchema,
                },
                {
                  actionType: SemanticIdSchema.parse('response.pass'),
                  toolName: 'pass_response',
                  inputMode: 'structured',
                  schema: PassPayloadSchema,
                },
              ]
            : [
                {
                  actionType: SemanticIdSchema.parse('card.play'),
                  toolName: 'play_card',
                  inputMode: 'structured',
                  schema: PlayPayloadSchema,
                },
                {
                  actionType: SemanticIdSchema.parse('turn.pass'),
                  toolName: 'pass_turn',
                  inputMode: 'structured',
                  schema: PassPayloadSchema,
                },
              ],
        },
      ],
    }
  }

  public validate(action: GameAction): GameAction {
    const boundary = this.currentDecision()
    if (!boundary) throw new Error('Reaction Card has ended')
    const parsed = validateDecisionAction(boundary, action)
    if (parsed.actionType === 'card.play' || parsed.actionType === 'card.respond') {
      const payload = CardSchema.parse((parsed.payload as { card?: unknown }).card)
      if (!(this.state.hands[parsed.actorId] ?? []).includes(payload)) {
        throw new Error(`Participant ${parsed.actorId} does not hold ${payload}`)
      }
    }
    return parsed
  }

  public submit(inputs: readonly GameAction[]): readonly GameEvent[] {
    const boundary = this.currentDecision()
    if (!boundary) throw new Error('Reaction Card has ended')
    const [action] = validateDecisionBatch(boundary, inputs).map((entry) => this.validate(entry))
    const from = this.#journal.revision
    if (action!.actionType === 'card.play') this.#play(action!)
    else if (action!.actionType === 'card.respond') this.#respond(action!)
    else if (action!.actionType === 'response.pass') this.#takeDamage(action!.actorId)
    else this.#passTurn()
    return this.events.slice(from)
  }

  #play(action: GameAction): void {
    const card = PlayPayloadSchema.parse(action.payload).card
    this.#journal.append({
      eventType: SemanticIdSchema.parse('card.played'),
      schemaVersion: 1,
      audience: { kind: 'public' },
      payload: { participantId: action.actorId, card },
    })
    if (card === 'focus') {
      this.#draw(action.actorId)
      return
    }
    const targetId = this.state.participants.find((id) => id !== action.actorId)!
    this.#journal.append({
      eventType: SemanticIdSchema.parse('strike.pending'),
      schemaVersion: 1,
      audience: { kind: 'public' },
      payload: { attackerId: action.actorId, targetId },
    })
  }

  #respond(action: GameAction): void {
    RespondPayloadSchema.parse(action.payload)
    this.#journal.append({
      eventType: SemanticIdSchema.parse('card.played'),
      schemaVersion: 1,
      audience: { kind: 'public' },
      payload: { participantId: action.actorId, card: 'guard' },
    })
    this.#journal.append({
      eventType: SemanticIdSchema.parse('strike.blocked'),
      schemaVersion: 1,
      audience: { kind: 'public' },
      payload: { participantId: action.actorId },
    })
  }

  #takeDamage(targetId: ParticipantId): void {
    const attackerId = this.state.pendingStrike!.attackerId
    this.#journal.append({
      eventType: SemanticIdSchema.parse('damage.dealt'),
      schemaVersion: 1,
      audience: { kind: 'public' },
      payload: { sourceId: attackerId, targetId, amount: 1 },
    })
    if ((this.state.health[targetId] ?? 0) <= 0) {
      this.#journal.append({
        eventType: SemanticIdSchema.parse('match.ended'),
        schemaVersion: 1,
        audience: { kind: 'public' },
        payload: { winnerId: attackerId, health: this.state.health },
      })
    }
  }

  #passTurn(): void {
    const activeIndex = (this.state.activeIndex + 1) % this.state.participants.length
    const participantId = this.state.participants[activeIndex]!
    this.#journal.append({
      eventType: SemanticIdSchema.parse('turn.changed'),
      schemaVersion: 1,
      audience: { kind: 'public' },
      payload: { activeIndex },
    })
    this.#draw(participantId)
  }

  #draw(participantId: ParticipantId): void {
    const card = this.state.deck[0]
    if (!card) return
    this.#journal.append({
      eventType: SemanticIdSchema.parse('card.drawn'),
      schemaVersion: 1,
      audience: { kind: 'participants', participantIds: [participantId] },
      payload: { participantId, card },
    })
  }
}

function initialState(setup: ReactionCardSetup): ReactionCardState {
  return {
    participants: setup.participants,
    activeIndex: 0,
    stage: 'main',
    health: Object.fromEntries(
      setup.participants.map((participantId) => [participantId, setup.startingHealth]),
    ),
    hands: Object.fromEntries(setup.participants.map((participantId) => [participantId, []])),
    deck: [],
    pendingStrike: null,
    outcome: null,
  }
}

function reduceReactionEvent(state: ReactionCardState, event: GameEvent): ReactionCardState {
  const payload = event.payload as Record<string, JsonValue>
  switch (event.eventType) {
    case 'deck.configured':
      return { ...state, deck: z.array(CardSchema).parse(payload['cards']) }
    case 'card.drawn': {
      const participantId = ParticipantIdSchema.parse(payload['participantId'])
      const card = CardSchema.parse(payload['card'])
      if (state.deck[0] !== card) throw new Error(`Drawn card ${card} is not on top of the deck`)
      return {
        ...state,
        deck: state.deck.slice(1),
        hands: {
          ...state.hands,
          [participantId]: [...(state.hands[participantId] ?? []), card],
        },
      }
    }
    case 'card.played': {
      const participantId = ParticipantIdSchema.parse(payload['participantId'])
      const card = CardSchema.parse(payload['card'])
      const hand = [...(state.hands[participantId] ?? [])]
      const index = hand.indexOf(card)
      if (index < 0) throw new Error(`Played card ${card} is absent from ${participantId}`)
      hand.splice(index, 1)
      return { ...state, hands: { ...state.hands, [participantId]: hand } }
    }
    case 'strike.pending':
      return {
        ...state,
        stage: 'response',
        pendingStrike: {
          attackerId: ParticipantIdSchema.parse(payload['attackerId']),
          targetId: ParticipantIdSchema.parse(payload['targetId']),
        },
      }
    case 'strike.blocked':
      return { ...state, stage: 'main', pendingStrike: null }
    case 'damage.dealt': {
      const targetId = ParticipantIdSchema.parse(payload['targetId'])
      return {
        ...state,
        stage: 'main',
        pendingStrike: null,
        health: {
          ...state.health,
          [targetId]: (state.health[targetId] ?? 0) - Number(payload['amount']),
        },
      }
    }
    case 'turn.changed':
      return { ...state, activeIndex: Number(payload['activeIndex']) }
    case 'match.ended':
      return {
        ...state,
        stage: 'ended',
        outcome: ReactionCardOutcomeSchema.parse(payload),
      }
    default:
      return state
  }
}

export function reactionCardAction(input: {
  readonly decisionId: string
  readonly actorId: string
  readonly actionType: 'card.play' | 'turn.pass' | 'card.respond' | 'response.pass'
  readonly payload?: JsonValue
}): GameAction {
  return {
    matchId: MatchIdSchema.parse('match-reaction-card'),
    decisionId: DecisionIdSchema.parse(input.decisionId),
    actorId: ParticipantIdSchema.parse(input.actorId),
    actionType: SemanticIdSchema.parse(input.actionType),
    payload: input.payload ?? {},
  }
}

export function reactionCardSetup(deck?: readonly Card[]): ReactionCardSetup {
  return ReactionCardSetupSchema.parse({
    participants: ['participant-one', 'participant-two'],
    startingHealth: 2,
    ...(deck ? { deck } : {}),
  })
}
