export interface ProcessLaunchSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}
