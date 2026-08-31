import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  agentsParentReference,
  closestAncestorAgents,
  currentStateNarration,
  validateAgentNote,
} from './documentation-policy.js'

describe('documentation policy', () => {
  it('accepts complete proposed and implemented Agent Notes', () => {
    expect(
      validateAgentNote(
        '.agents/notes/proposed/architecture/2026-08-31-boundary.md',
        proposedNote(),
      ),
    ).toEqual([])
    expect(
      validateAgentNote(
        '.agents/notes/implemented/process/2026-08-31-governance.md',
        implementedNote(),
      ),
    ).toEqual([])
  })

  it('rejects invalid paths, lifecycle drift, and unfinished implemented content', () => {
    expect(validateAgentNote('.agents/notes/implemented/note.md', implementedNote())[0]).toMatch(
      /must use/,
    )
    expect(
      validateAgentNote(
        '.agents/notes/implemented/process/2026-08-31-governance.md',
        implementedNote().replace('Status: implemented', 'Status: proposed'),
      ),
    ).toContain(
      '.agents/notes/implemented/process/2026-08-31-governance.md status does not match its lifecycle',
    )
    expect(
      validateAgentNote(
        '.agents/notes/implemented/process/2026-08-31-governance.md',
        `${implementedNote()}\n## Plan\n\n- [ ] Later\n`,
      ),
    ).toContain(
      '.agents/notes/implemented/process/2026-08-31-governance.md contains unfinished proposal or checklist content',
    )
  })

  it('finds the closest instruction ancestor and its relative link', () => {
    const root = resolve('/workspace/core')
    const rootAgents = resolve(root, 'AGENTS.md')
    const docsAgents = resolve(root, 'docs/AGENTS.md')
    const nested = resolve(root, 'docs/reference/AGENTS.md')
    const instructions = new Set([rootAgents, docsAgents, nested])
    expect(closestAncestorAgents(nested, instructions, root)).toBe(docsAgents)
    expect(agentsParentReference(nested, docsAgents)).toBe('../AGENTS.md')
    expect(closestAncestorAgents(rootAgents, instructions, root)).toBeNull()
  })

  it('flags migration narration only in current-state content', () => {
    expect(currentStateNarration('README.md', '当前系统提供 contracts。')).toEqual([])
    expect(currentStateNarration('README.md', '相比上一版，当前系统更简单。')).toEqual([
      'README.md contains migration narration in a current-state document',
    ])
  })
})

function proposedNote(): string {
  return `# Agent Note: Boundary

Status: proposed

## Problem

Problem.

## Proposal

Proposal.

## Alternatives considered

Alternative.

## Acceptance criteria

Criteria.

## Risks

Risk.
`
}

function implementedNote(): string {
  return `# Agent Note: Governance

Status: implemented

## Problem

Problem.

## Decision

Decision.

## Alternatives considered

Alternative.

## Consequences

Consequence.
`
}
