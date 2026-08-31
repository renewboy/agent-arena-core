import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  agentsParentReference,
  closestAncestorAgents,
  currentStateNarration,
  validateAgentNote,
} from './documentation-policy.js'
import { sourceFiles, text, localPath, failIfErrors, projectRoot } from './files.js'

const packageDirectories = [
  'packages/acp-runtime',
  'packages/contracts',
  'packages/game-runtime',
  'packages/harness',
  'packages/match-runtime',
  'packages/prompt-runtime',
  'packages/ruleset',
  'packages/simulation',
  'packages/storage-sqlite',
  'packages/testkit',
  'packages/trajectory',
] as const
const exampleDirectories = ['examples/hidden-team', 'examples/reaction-card'] as const
const required = [
  'AGENTS.md',
  'README.md',
  'artifacts_rules.md',
  'docs/AGENTS.md',
  'docs/architecture.md',
  '.agents/notes/AGENTS.md',
  '.agents/notes/README.md',
  '.agents/notes/proposed/AGENTS.md',
  '.agents/notes/implemented/AGENTS.md',
  '.agents/notes/rejected/AGENTS.md',
  '.agents/notes/archived/AGENTS.md',
  ...packageDirectories.flatMap((directory) => [
    `${directory}/AGENTS.md`,
    `${directory}/README.md`,
  ]),
  ...exampleDirectories.flatMap((directory) => [
    `${directory}/AGENTS.md`,
    `${directory}/README.md`,
  ]),
]
const errors: string[] = []

for (const path of required) {
  try {
    await access(resolve(projectRoot, path))
  } catch {
    errors.push(`missing required document ${path}`)
  }
}

for (const retired of ['.agents/notes/index.md', 'docs/decisions', 'docs/plans']) {
  try {
    await access(resolve(projectRoot, retired))
    errors.push(`${retired} is a retired documentation location`)
  } catch {
    // Retired locations remain absent.
  }
}

const markdownFiles = await sourceFiles(['.'], new Set(['.md']))
const rootAgentsPath = resolve(projectRoot, 'AGENTS.md')
const instructionFiles = new Set(
  markdownFiles.filter((path) => localPath(path).endsWith('AGENTS.md')),
)

for (const path of instructionFiles) {
  const lines = (await text(path)).split(/\r?\n/).length
  if (lines > 200) errors.push(`${localPath(path)} exceeds the 200-line AGENTS.md limit`)
}

const architecturePath = resolve(projectRoot, 'docs/architecture.md')
if ((await text(architecturePath)).split(/\r?\n/).length > 500) {
  errors.push('docs/architecture.md exceeds the 500-line architecture limit')
}

const currentStateDocuments = [
  'README.md',
  'docs/architecture.md',
  ...packageDirectories.map((directory) => `${directory}/README.md`),
  ...exampleDirectories.map((directory) => `${directory}/README.md`),
]
for (const path of currentStateDocuments) {
  errors.push(...currentStateNarration(path, await text(resolve(projectRoot, path))))
}

const noteFiles = (await sourceFiles(['.agents/notes'], new Set(['.md']))).filter(
  (path) => !path.endsWith('/AGENTS.md') && !path.endsWith('/README.md'),
)
for (const path of noteFiles) {
  errors.push(...validateAgentNote(localPath(path), await text(path)))
}

for (const path of instructionFiles) {
  if (path === rootAgentsPath) continue
  const parentPath = closestAncestorAgents(path, instructionFiles, projectRoot)
  if (!parentPath) {
    errors.push(`${localPath(path)} has no ancestor AGENTS.md`)
    continue
  }
  const parentReference = agentsParentReference(path, parentPath)
  if (!(await text(path)).includes(`](${parentReference})`)) {
    errors.push(`${localPath(path)} must link to ${parentReference}`)
  }
}

for (const path of markdownFiles) {
  const content = await text(path)
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]!
    if (/^(?:https?:|mailto:|#)/.test(target)) continue
    const localTarget = target.split('#')[0]!
    if (!localTarget) continue
    try {
      await access(resolve(dirname(path), localTarget))
    } catch {
      errors.push(`${localPath(path)} links to missing ${target}`)
    }
  }
}

const rootAgents = await text(rootAgentsPath)
if (!rootAgents.includes('](artifacts_rules.md)')) {
  errors.push('AGENTS.md must link to artifacts_rules.md')
}
const purityRules = await text(resolve(projectRoot, 'artifacts_rules.md'))
if (!purityRules.startsWith('# 当前态交付物纯净性规则')) {
  errors.push('artifacts_rules.md must retain the current-state purity contract')
}
for (let section = 1; section <= 10; section += 1) {
  if (!purityRules.includes(`## ${section}.`)) {
    errors.push(`artifacts_rules.md is missing section ${section}`)
  }
}

const architecture = await text(architecturePath)
for (const forbidden of ['AgentWolf', '原来', '替代旧', '相比上一版']) {
  if (architecture.includes(forbidden)) {
    errors.push(`docs/architecture.md contains non-current narrative ${forbidden}`)
  }
}

failIfErrors(errors, 'docs')
