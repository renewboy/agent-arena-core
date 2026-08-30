import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [guardian, agentFixture, infoPath, readyPath] = process.argv.slice(2)
if (!guardian || !agentFixture || !infoPath || !readyPath) {
  throw new Error('guardian, agent fixture, info path, and ready path are required')
}

const guarded = spawn('/bin/sh', [guardian, process.execPath, agentFixture], {
  detached: true,
  env: { ...process.env, AGENT_ARENA_PROCESS_TREE_INFO: infoPath },
  stdio: ['pipe', 'ignore', 'ignore'],
})
if (!guarded.pid) throw new Error('Guardian did not start')
writeFileSync(readyPath, JSON.stringify({ guardianPid: guarded.pid }))
setInterval(() => undefined, 1_000)
