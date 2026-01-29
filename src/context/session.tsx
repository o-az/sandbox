import { createSignal } from 'solid-js'
import { makePersisted } from '@solid-primitives/storage'
import { createContextProvider } from '@solid-primitives/context'

export const STREAMING_COMMANDS = new Set(['anvil'])
export const INTERACTIVE_COMMANDS = new Set([
  'chisel',
  'node',
  'vi',
  'vim',
  'vim.tiny',
])

export type ClientSessionState = {
  sessionId: string
  tabId: string
  isNewSession: boolean
  prefilledCommand: string | null
  embedMode: boolean
  autoRun: boolean
  logLevel: 'info' | 'debug'
}

type SessionContextValue = {
  ensureClientSession: () => ClientSessionState
  markRefreshIntent: () => void
  consumeRefreshIntent: () => boolean
  clearStoredSessionState: () => void
}

const [SessionProvider, useSessionContext] = createContextProvider<
  SessionContextValue,
  {}
>(() => {
  const [sessionState, setSessionState] = createSignal<
    ClientSessionState | undefined
  >()
  const [sessionId, setSessionId] = makePersisted(
    createSignal<string | null>(null),
    { name: 'client-session-id' },
  )

  const browserSessionStorage =
    typeof window === 'undefined' ? undefined : window.sessionStorage

  const [tabId, setTabId] = makePersisted(createSignal<string | null>(null), {
    name: 'client-tab-id',
    storage: browserSessionStorage,
  })
  const [sessionActive, setSessionActive] = makePersisted(
    createSignal<boolean | null>(null),
    { name: 'client-session-active', storage: browserSessionStorage },
  )
  const [refreshIntent, setRefreshIntent] = makePersisted(
    createSignal<boolean | null>(null),
    { name: 'client-refresh-intent', storage: browserSessionStorage },
  )

  function ensureClientSession(): ClientSessionState {
    const existing = sessionState()
    if (existing) return existing
    if (typeof window === 'undefined') {
      throw new Error('Client session can only be initialized in the browser')
    }

    const resolvedSessionId = sessionId() ?? generateIdentifier('session')
    if (!sessionId()) setSessionId(resolvedSessionId)

    const resolvedTabId = tabId() ?? generateIdentifier('tab')
    if (!tabId()) setTabId(resolvedTabId)

    const wasActive = Boolean(sessionActive())
    setSessionActive(true)

    const params = new URL(window.location.href).searchParams

    const nextState: ClientSessionState = {
      sessionId: resolvedSessionId,
      tabId: resolvedTabId,
      isNewSession: !wasActive,
      prefilledCommand: params.get('cmd'),
      embedMode: params.get('embed') === 'true',
      autoRun: params.get('autorun') === 'true',
      logLevel: params.get('log') === 'debug' ? 'debug' : 'info',
    }

    setSessionState(nextState)
    return nextState
  }

  const markRefreshIntent = () => setRefreshIntent(true)

  function consumeRefreshIntent() {
    const hadIntent = refreshIntent() === true
    if (hadIntent) setRefreshIntent(null)
    return hadIntent
  }

  function clearStoredSessionState() {
    setTabId(null)
    setSessionId(null)
    setSessionActive(null)
    setRefreshIntent(null)
    setSessionState(undefined)
  }

  return {
    markRefreshIntent,
    ensureClientSession,
    consumeRefreshIntent,
    clearStoredSessionState,
  }
})

export { SessionProvider }

export function useSession() {
  const context = useSessionContext()
  if (!context)
    throw new Error('useSession must be used within a SessionProvider')

  return context
}

function generateIdentifier(prefix: string) {
  const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 9)
  return `${prefix}-${id}`
}
