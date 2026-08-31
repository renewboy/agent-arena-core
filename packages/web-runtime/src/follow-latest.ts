import type { FollowLatestState } from './contracts.js'
import { ObservableState } from './observable.js'

export class FollowLatestController {
  readonly #store = new ObservableState<FollowLatestState>({
    following: true,
    detachedByUser: false,
    hasNewActivity: false,
  })

  public snapshot = (): FollowLatestState => this.#store.snapshot()

  public subscribe = (listener: () => void): (() => void) => this.#store.subscribe(listener)

  public contentChanged(): boolean {
    const current = this.snapshot()
    if (current.following) return true
    if (!current.hasNewActivity) this.#store.set({ ...current, hasNewActivity: true })
    return false
  }

  public detach(): void {
    const current = this.snapshot()
    if (!current.following && current.detachedByUser) return
    this.#store.set({ ...current, following: false, detachedByUser: true })
  }

  public observeDistance(distanceFromEnd: number, threshold: number): void {
    const current = this.snapshot()
    const following = current.detachedByUser ? distanceFromEnd <= 1 : distanceFromEnd < threshold
    const next = {
      following,
      detachedByUser: current.detachedByUser && !following,
      hasNewActivity: following ? false : current.hasNewActivity,
    }
    if (
      current.following === next.following &&
      current.detachedByUser === next.detachedByUser &&
      current.hasNewActivity === next.hasNewActivity
    ) {
      return
    }
    this.#store.set(next)
  }

  public returnToLatest(): void {
    const current = this.snapshot()
    if (current.following && !current.detachedByUser && !current.hasNewActivity) return
    this.#store.set({ following: true, detachedByUser: false, hasNewActivity: false })
  }

  public dispose(): void {
    this.#store.clear()
  }
}
