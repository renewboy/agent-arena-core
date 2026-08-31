import { dirname, isAbsolute, relative, resolve } from 'node:path'

const notePattern =
  /^\.agents\/notes\/(proposed|implemented|rejected|archived)\/(feature|bug-fix|simplification|architecture|process|testing)\/(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/

export function validateAgentNote(relativePath: string, content: string): string[] {
  const errors: string[] = []
  const match = relativePath.match(notePattern)
  if (!match) {
    return [`${relativePath} must use .agents/notes/<lifecycle>/<class>/YYYY-MM-DD-<slug>.md`]
  }
  const lifecycle = match[1]!
  const lines = content.split(/\r?\n/)
  if (!/^# Agent Note: \S/.test(lines[0] ?? '')) {
    errors.push(`${relativePath} must start with # Agent Note: <title>`)
  }
  const status = lines.find((line) => line.startsWith('Status:'))
  const expectedStatus =
    lifecycle === 'rejected'
      ? /^Status: rejected — .+$/
      : lifecycle === 'archived'
        ? /^Status: implemented$/
        : new RegExp(`^Status: ${lifecycle}$`)
  if (!status || !expectedStatus.test(status)) {
    errors.push(`${relativePath} status does not match its lifecycle`)
  }
  for (const heading of ['## Problem', '## Alternatives considered']) {
    if (!content.includes(heading)) errors.push(`${relativePath} is missing ${heading}`)
  }
  const requiredHeadings =
    lifecycle === 'implemented' || lifecycle === 'archived'
      ? ['## Decision', '## Consequences']
      : ['## Proposal']
  for (const heading of requiredHeadings) {
    if (!content.includes(heading)) errors.push(`${relativePath} is missing ${heading}`)
  }
  if (lifecycle === 'proposed') {
    for (const heading of ['## Acceptance criteria', '## Risks']) {
      if (!content.includes(heading)) errors.push(`${relativePath} is missing ${heading}`)
    }
  }
  if (
    (lifecycle === 'implemented' || lifecycle === 'archived') &&
    (/^## (?:Proposal|Plan|Migration plan|Acceptance criteria)\b/im.test(content) ||
      /- \[ \]|\bTODO\b/im.test(content))
  ) {
    errors.push(`${relativePath} contains unfinished proposal or checklist content`)
  }
  return errors
}

export function closestAncestorAgents(
  instructionPath: string,
  instructionFiles: ReadonlySet<string>,
  projectRoot: string,
): string | null {
  let ancestorDirectory = dirname(dirname(instructionPath))
  for (;;) {
    if (!isWithin(projectRoot, ancestorDirectory)) return null
    const candidate = resolve(ancestorDirectory, 'AGENTS.md')
    if (instructionFiles.has(candidate)) return candidate
    if (ancestorDirectory === projectRoot) return null
    const parentDirectory = dirname(ancestorDirectory)
    if (parentDirectory === ancestorDirectory) return null
    ancestorDirectory = parentDirectory
  }
}

export function agentsParentReference(instructionPath: string, parentPath: string): string {
  return relative(dirname(instructionPath), parentPath).replaceAll('\\', '/')
}

export function currentStateNarration(relativePath: string, content: string): string[] {
  return /旧版|替代旧|原来.{0,20}现在|不再使用|相比上一版/.test(content)
    ? [`${relativePath} contains migration narration in a current-state document`]
    : []
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}
