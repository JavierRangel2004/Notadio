import type { LiveSession } from "../types.js"

type SessionListener = (session: LiveSession) => void

class LiveSessionStore {
  private readonly sessions = new Map<string, LiveSession>()
  private readonly listeners = new Map<string, Set<SessionListener>>()

  get(sessionId: string): LiveSession | undefined {
    return this.sessions.get(sessionId)
  }

  getAll(): LiveSession[] {
    return Array.from(this.sessions.values())
  }

  set(session: LiveSession): void {
    this.sessions.set(session.id, session)
    this.notifyListeners(session)
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.listeners.delete(sessionId)
  }

  addListener(sessionId: string, listener: SessionListener): void {
    let set = this.listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(listener)
  }

  removeListener(sessionId: string, listener: SessionListener): void {
    const set = this.listeners.get(sessionId)
    if (!set) return
    set.delete(listener)
    if (set.size === 0) {
      this.listeners.delete(sessionId)
    }
  }

  private notifyListeners(session: LiveSession): void {
    const set = this.listeners.get(session.id)
    if (!set) return
    for (const listener of set) {
      try {
        listener(session)
      } catch {
        // Listener errors must not break the store
      }
    }
  }
}

export const liveSessionStore = new LiveSessionStore()
