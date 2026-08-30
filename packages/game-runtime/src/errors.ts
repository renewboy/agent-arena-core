export class RuleViolation extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RuleViolation'
  }
}

export function assertRule(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new RuleViolation(message)
  }
}
