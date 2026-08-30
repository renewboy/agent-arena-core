import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import {
  SemanticIdSchema,
  SimulationIdSchema,
  type SemanticId,
  type SimulationId,
} from '@agent-arena/contracts'
import {
  SimulationApprovalResultSchema,
  SimulationCaptureSchema,
  SimulationCandidateResultSchema,
  SimulationFixtureSchema,
  SimulationReviewResultSchema,
  SimulationRunReportSchema,
  SimulationVariantSchema,
  type SimulationApprovalRequest,
  type SimulationCapture,
  type SimulationFixture,
  type SimulationRunReport,
  type SimulationVariant,
} from './contracts.js'
import { reviewedSimulationExpected, scanSimulationSecrets } from './canonical.js'

type SimulationInput = SimulationCapture | SimulationFixture

export interface SimulationRunner {
  readonly id: SemanticId
  run(input: SimulationInput, variant: SimulationVariant): Promise<SimulationRunReport>
}

export interface SimulationWorkflowConfig {
  readonly projectRoot: string
  readonly candidateDirectory: string
  readonly fixtureDirectory: string
  readonly runners: readonly SimulationRunner[]
  readonly reviewVariant?: SimulationVariant
  variants(capture: SimulationCapture): readonly SimulationVariant[]
  normalize?(capture: SimulationCapture): SimulationCapture
  scanSecrets?(value: unknown): readonly string[]
}

interface RunnerReview {
  readonly first: SimulationRunReport
  readonly second: SimulationRunReport
  readonly deterministic: boolean
}

interface ReviewDetails {
  readonly capture: SimulationCapture
  readonly runners: readonly RunnerReview[]
  readonly result: ReturnType<typeof SimulationReviewResultSchema.parse>
}

export class SimulationWorkflowError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'SimulationWorkflowError'
  }
}

export async function addSimulationCandidate(
  config: SimulationWorkflowConfig,
  input: SimulationCapture,
) {
  const capture = SimulationCaptureSchema.parse(input)
  await mkdir(config.candidateDirectory, { recursive: true })
  const path = candidatePath(config, capture.simulationId)
  let created = true
  try {
    await writeFile(path, `${JSON.stringify(capture, null, 2)}\n`, { flag: 'wx' })
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    const existing = SimulationCaptureSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    if (existing.source.fingerprint !== capture.source.fingerprint) {
      throw new SimulationWorkflowError('A candidate with this ID contains other source data')
    }
    created = false
  }
  return SimulationCandidateResultSchema.parse({
    simulationId: capture.simulationId,
    relativePath: relative(config.projectRoot, path),
    created,
    warnings: capture.warnings,
  })
}

export async function reviewSimulationCandidate(config: SimulationWorkflowConfig, idValue: string) {
  return (await reviewDetails(config, SimulationIdSchema.parse(idValue))).result
}

export async function approveSimulationCandidate(
  config: SimulationWorkflowConfig,
  idValue: string,
  options: SimulationApprovalRequest,
) {
  const id = SimulationIdSchema.parse(idValue)
  const review = await reviewDetails(config, id)
  if (review.result.secretWarnings.length > 0) {
    throw new SimulationWorkflowError(
      `Capture contains sensitive content: ${review.result.secretWarnings.join(', ')}`,
    )
  }
  if (review.result.warnings.length > 0 && !options.acknowledgeWarnings) {
    throw new SimulationWorkflowError('Capture warnings require acknowledgement')
  }
  if (!review.result.canApprove && !options.acceptCurrent) {
    throw new SimulationWorkflowError('Captured behavior differs from the runner result')
  }
  if (options.acceptCurrent && !review.result.canAcceptCurrent) {
    throw new SimulationWorkflowError('Runner results cannot be accepted')
  }
  const variants = config
    .variants(review.capture)
    .map((variant) => SimulationVariantSchema.parse(variant))
  if (variants.length === 0) throw new SimulationWorkflowError('Approval requires variants')
  const accepted = options.acceptCurrent ? review.runners[0]!.first.actual : review.capture.observed
  const fixture = SimulationFixtureSchema.parse({
    schemaVersion: 1,
    stage: 'approved',
    simulationId: review.capture.simulationId,
    title: review.capture.title,
    gameId: review.capture.gameId,
    ruleset: review.capture.ruleset,
    matchId: review.capture.matchId,
    source: {
      status: review.capture.source.status,
      cutoffSequence: review.capture.source.cutoffSequence,
      fingerprint: review.capture.source.fingerprint,
    },
    setup: review.capture.setup,
    turns: review.capture.turns,
    controls: review.capture.controls,
    expected: reviewedSimulationExpected(accepted),
    variants,
  })
  await mkdir(config.fixtureDirectory, { recursive: true })
  const path = resolve(config.fixtureDirectory, `${id}.sim.json`)
  let created = true
  let approvedVariants = variants
  try {
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, { flag: 'wx' })
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    const existing = SimulationFixtureSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    if (existing.source.fingerprint !== fixture.source.fingerprint) {
      throw new SimulationWorkflowError('An approved fixture with this ID contains other data')
    }
    if (JSON.stringify(existing.expected) !== JSON.stringify(fixture.expected)) {
      throw new SimulationWorkflowError('The approved fixture contains another reviewed result')
    }
    approvedVariants = existing.variants
    created = false
  }
  return SimulationApprovalResultSchema.parse({
    simulationId: id,
    relativePath: relative(config.projectRoot, path),
    created,
    variants: approvedVariants,
  })
}

export async function readSimulationCandidate(
  config: SimulationWorkflowConfig,
  idValue: string,
): Promise<SimulationCapture> {
  const id = SimulationIdSchema.parse(idValue)
  const capture = SimulationCaptureSchema.parse(
    JSON.parse(await readFile(candidatePath(config, id), 'utf8')),
  )
  return config.normalize?.(capture) ?? capture
}

async function reviewDetails(
  config: SimulationWorkflowConfig,
  id: SimulationId,
): Promise<ReviewDetails> {
  if (config.runners.length < 2) {
    throw new SimulationWorkflowError('Review requires at least two independent runners')
  }
  const capture = await readSimulationCandidate(config, id)
  const variant = config.reviewVariant ?? SemanticIdSchema.parse('recorded')
  const runners = await Promise.all(
    config.runners.map(async (runner): Promise<RunnerReview> => {
      const first = parseRunReport(await runner.run(capture, variant), runner.id, id, variant)
      const second = parseRunReport(await runner.run(capture, variant), runner.id, id, variant)
      return { first, second, deterministic: sameResult(first, second) }
    }),
  )
  const runnersAgree = runners
    .slice(1)
    .every((runner) => sameResult(runners[0]!.first, runner.first))
  const secretWarnings = [...(config.scanSecrets?.(capture) ?? scanSimulationSecrets(capture))]
  const canAcceptCurrent =
    runners.every((runner) => runner.deterministic) && runnersAgree && secretWarnings.length === 0
  const result = SimulationReviewResultSchema.parse({
    simulationId: id,
    relativePath: relative(config.projectRoot, candidatePath(config, id)),
    sourceStatus: capture.source.status,
    turns: capture.turns.length,
    events: capture.observed.events.length,
    runners: runners.map((runner) => ({
      runnerId: runner.first.runnerId,
      deterministic: runner.deterministic,
      ok: runner.first.ok,
      failures: runner.first.failures,
    })),
    runnersAgree,
    canApprove: canAcceptCurrent && runners.every((runner) => runner.first.ok),
    canAcceptCurrent,
    failures: [...new Set(runners.flatMap((runner) => runner.first.failures))],
    warnings: capture.warnings,
    secretWarnings,
  })
  return { capture, runners, result }
}

function parseRunReport(
  input: SimulationRunReport,
  runnerId: SemanticId,
  simulationId: SimulationId,
  variant: SimulationVariant,
): SimulationRunReport {
  const report = SimulationRunReportSchema.parse(input)
  if (
    report.runnerId !== runnerId ||
    report.simulationId !== simulationId ||
    report.variant !== variant
  ) {
    throw new SimulationWorkflowError(`Runner ${runnerId} returned a mismatched report`)
  }
  return report
}

function candidatePath(config: SimulationWorkflowConfig, id: SimulationId): string {
  return resolve(config.candidateDirectory, `${id}.sim.json`)
}

function sameResult(left: SimulationRunReport, right: SimulationRunReport): boolean {
  return JSON.stringify(left.actual) === JSON.stringify(right.actual)
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}
