import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@agent-arena/contracts': fileURLToPath(
        new URL('./packages/contracts/src/index.ts', import.meta.url),
      ),
      '@agent-arena/devtools-react': fileURLToPath(
        new URL('./packages/devtools-react/src/index.ts', import.meta.url),
      ),
      '@agent-arena/harness': fileURLToPath(
        new URL('./packages/harness/src/index.ts', import.meta.url),
      ),
      '@agent-arena/ruleset': fileURLToPath(
        new URL('./packages/ruleset/src/index.ts', import.meta.url),
      ),
      '@agent-arena/game-runtime': fileURLToPath(
        new URL('./packages/game-runtime/src/index.ts', import.meta.url),
      ),
      '@agent-arena/prompt-runtime': fileURLToPath(
        new URL('./packages/prompt-runtime/src/index.ts', import.meta.url),
      ),
      '@agent-arena/react': fileURLToPath(
        new URL('./packages/react/src/index.ts', import.meta.url),
      ),
      '@agent-arena/match-runtime': fileURLToPath(
        new URL('./packages/match-runtime/src/index.ts', import.meta.url),
      ),
      '@agent-arena/simulation': fileURLToPath(
        new URL('./packages/simulation/src/index.ts', import.meta.url),
      ),
      '@agent-arena/storage-sqlite': fileURLToPath(
        new URL('./packages/storage-sqlite/src/index.ts', import.meta.url),
      ),
      '@agent-arena/testkit': fileURLToPath(
        new URL('./packages/testkit/src/index.ts', import.meta.url),
      ),
      '@agent-arena/web-runtime': fileURLToPath(
        new URL('./packages/web-runtime/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/*/tests/**/*.test.{ts,tsx}',
      'examples/*/tests/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/index.ts'],
      thresholds: {
        perFile: true,
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    restoreMocks: true,
  },
})
