import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncActionStatus = 'idle' | 'working' | 'success' | 'error'

export interface AsyncActionState<Result, Arguments extends readonly unknown[]> {
  readonly status: AsyncActionStatus
  readonly result: Result | null
  readonly error: Error | null
  readonly run: (...arguments_: Arguments) => Promise<Result>
  readonly reset: () => void
}

export function useAsyncAction<Result, Arguments extends readonly unknown[]>(
  action: (...arguments_: Arguments) => Promise<Result>,
): AsyncActionState<Result, Arguments> {
  const mounted = useRef(true)
  const operation = useRef(0)
  const [status, setStatus] = useState<AsyncActionStatus>('idle')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current += 1
    }
  }, [])

  const run = useCallback(
    async (...arguments_: Arguments): Promise<Result> => {
      const current = ++operation.current
      setStatus('working')
      setResult(null)
      setError(null)
      try {
        const value = await action(...arguments_)
        if (mounted.current && current === operation.current) {
          setResult(value)
          setStatus('success')
        }
        return value
      } catch (cause) {
        const nextError = cause instanceof Error ? cause : new Error(String(cause))
        if (mounted.current && current === operation.current) {
          setError(nextError)
          setStatus('error')
        }
        throw nextError
      }
    },
    [action],
  )

  const reset = useCallback(() => {
    operation.current += 1
    setStatus('idle')
    setResult(null)
    setError(null)
  }, [])

  return { status, result, error, run, reset }
}
