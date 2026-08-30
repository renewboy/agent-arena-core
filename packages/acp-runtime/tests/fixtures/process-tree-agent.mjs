import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const infoPath = process.env['AGENT_ARENA_PROCESS_TREE_INFO']
if (!infoPath) throw new Error('AGENT_ARENA_PROCESS_TREE_INFO is required')

const childFixture = fileURLToPath(new URL('./process-tree-child.mjs', import.meta.url))
const child = spawn(process.execPath, [childFixture], { stdio: 'ignore' })
if (!child.pid) throw new Error('Process-tree child did not start')

writeFileSync(infoPath, JSON.stringify({ agentPid: process.pid, childPid: child.pid }))
process.on('SIGINT', () => undefined)
process.on('SIGTERM', () => undefined)
setInterval(() => undefined, 1_000)
