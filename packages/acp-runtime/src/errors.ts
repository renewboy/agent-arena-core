export class AcpLifecycleError extends Error {
  public constructor(
    message: string,
    public readonly stderrTail: string = '',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AcpLifecycleError'
  }
}

export class AcpDeliveryUncertainError extends Error {
  public readonly sessionReusable: boolean

  public constructor(
    message: string,
    options?: ErrorOptions & { readonly sessionReusable?: boolean },
  ) {
    super(message, options)
    this.name = 'AcpDeliveryUncertainError'
    this.sessionReusable = options?.sessionReusable ?? false
  }
}
