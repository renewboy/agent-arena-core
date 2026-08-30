import type { PromptMatchValue, PromptPresentation } from './contracts.js'

export interface PromptEventAdapter<Event> {
  eventType(event: Event): string
  payload(event: Event): unknown
}

export function validatePromptPresentationMatchers<Event>(
  presentations: readonly PromptPresentation<Event, string>[],
): void {
  for (const [index, left] of presentations.entries()) {
    for (const right of presentations.slice(index + 1)) {
      if (
        left.eventType === right.eventType &&
        specificity(left) === specificity(right) &&
        matchersOverlap(left.where, right.where)
      ) {
        throw new Error(
          `Ambiguous Prompt event matchers for ${left.eventType}: ${left.owner}, ${right.owner}`,
        )
      }
    }
  }
}

export function selectPromptPresentation<Event, Audience extends string>(
  presentations: readonly PromptPresentation<Event, Audience>[],
  event: Event,
  adapter: PromptEventAdapter<Event>,
): PromptPresentation<Event, Audience> {
  const eventType = adapter.eventType(event)
  const matches = presentations
    .filter(
      (presentation) =>
        presentation.eventType === eventType &&
        Object.entries(presentation.where).every(([path, expected]) =>
          matchesValue(propertyAt(adapter.payload(event), path), expected),
        ),
    )
    .sort((left, right) => specificity(right) - specificity(left))
  if (matches.length === 0) throw new Error(`No Prompt event presentation for ${eventType}`)
  if (matches[1] && specificity(matches[0]!) === specificity(matches[1])) {
    throw new Error(
      `Ambiguous Prompt event presentation for ${eventType}: ${matches[0]!.owner}, ${matches[1].owner}`,
    )
  }
  return matches[0]!
}

function specificity(value: PromptPresentation<unknown, string>): number {
  return 1 + Object.keys(value.where).length
}

function matchersOverlap(
  left: Readonly<Record<string, PromptMatchValue>>,
  right: Readonly<Record<string, PromptMatchValue>>,
): boolean {
  for (const path of Object.keys(left).filter((candidate) => candidate in right)) {
    const leftValue = left[path]!
    const rightValue = right[path]!
    if (isExists(leftValue) || isExists(rightValue)) continue
    if (leftValue !== rightValue) return false
  }
  return true
}

function matchesValue(value: unknown, expected: PromptMatchValue): boolean {
  if (isExists(expected)) return expected.exists ? value !== undefined : value === undefined
  return value === expected
}

function isExists(value: PromptMatchValue): value is { readonly exists: boolean } {
  return typeof value === 'object' && value !== null
}

function propertyAt(value: unknown, path: string): unknown {
  let current = value
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
