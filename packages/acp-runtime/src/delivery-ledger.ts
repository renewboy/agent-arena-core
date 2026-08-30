export interface DeliveryAttempt {
  readonly id: string
  readonly fromSequence: number
  readonly toSequence: number
  readonly startedAt: string
  readonly state: 'in-flight' | 'uncertain'
  readonly error?: string
}

export interface DeliveryLedgerSnapshot {
  readonly acknowledgedSequence: number
  readonly activeAttempt: DeliveryAttempt | null
}

export class DeliveryLedger {
  #acknowledgedSequence: number
  #activeAttempt: DeliveryAttempt | null

  public constructor(snapshot?: DeliveryLedgerSnapshot) {
    this.#acknowledgedSequence = snapshot?.acknowledgedSequence ?? 0
    this.#activeAttempt = snapshot?.activeAttempt ?? null
  }

  public get acknowledgedSequence(): number {
    return this.#acknowledgedSequence
  }

  public get activeAttempt(): DeliveryAttempt | null {
    return this.#activeAttempt
  }

  public begin(
    id: string,
    toSequence: number,
    startedAt = new Date().toISOString(),
  ): DeliveryAttempt {
    if (this.#activeAttempt) {
      throw new Error(`Delivery ${this.#activeAttempt.id} must be resolved before another begins`)
    }
    if (toSequence < this.#acknowledgedSequence) {
      throw new Error('Delivery cannot move the cursor backwards')
    }
    const attempt: DeliveryAttempt = {
      id,
      fromSequence: this.#acknowledgedSequence + 1,
      toSequence,
      startedAt,
      state: 'in-flight',
    }
    this.#activeAttempt = attempt
    return attempt
  }

  public acknowledge(id: string): number {
    const attempt = this.#requireAttempt(id)
    if (attempt.state === 'uncertain') {
      throw new Error(`Uncertain delivery ${id} cannot be acknowledged automatically`)
    }
    this.#acknowledgedSequence = Math.max(this.#acknowledgedSequence, attempt.toSequence)
    this.#activeAttempt = null
    return this.#acknowledgedSequence
  }

  public markUncertain(id: string, error: string): DeliveryAttempt {
    const attempt = this.#requireAttempt(id)
    const uncertain: DeliveryAttempt = { ...attempt, state: 'uncertain', error }
    this.#activeAttempt = uncertain
    return uncertain
  }

  public clearUnsent(id: string): void {
    const attempt = this.#requireAttempt(id)
    if (attempt.state !== 'in-flight') {
      throw new Error(`Delivery ${id} is not safely clearable`)
    }
    this.#activeAttempt = null
  }

  public abandonUncertain(id: string): number {
    const attempt = this.#requireAttempt(id)
    if (attempt.state !== 'uncertain') {
      throw new Error(`Delivery ${id} is not uncertain`)
    }
    this.#acknowledgedSequence = Math.max(this.#acknowledgedSequence, attempt.toSequence)
    this.#activeAttempt = null
    return this.#acknowledgedSequence
  }

  public snapshot(): DeliveryLedgerSnapshot {
    return {
      acknowledgedSequence: this.#acknowledgedSequence,
      activeAttempt: this.#activeAttempt,
    }
  }

  #requireAttempt(id: string): DeliveryAttempt {
    if (!this.#activeAttempt || this.#activeAttempt.id !== id) {
      throw new Error(`Delivery ${id} is not active`)
    }
    return this.#activeAttempt
  }
}
