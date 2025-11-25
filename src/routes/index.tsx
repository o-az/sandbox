import { createSignal, onMount } from 'solid-js'
import { createFileRoute } from '@tanstack/solid-router'

import {
  useSession,
  STREAMING_COMMANDS,
  INTERACTIVE_COMMANDS,
} from '#context/session.tsx'
import { ShareButton } from '#components/share-button.tsx'
import { ExtraKeyboard } from '#components/extra-keyboard.tsx'
import { Status, type StatusMode } from '#components/status.tsx'
import { useTerminalSession } from '#lib/hooks/use-terminal-session.ts'
import type { createVirtualKeyboardBridge } from '#lib/terminal/keyboard.ts'

const hot = import.meta.hot
const hotData = hot?.data as { hmrReloaded?: boolean } | undefined
const isHotReload = Boolean(hotData?.hmrReloaded)
if (hotData) hotData.hmrReloaded = false
hot?.dispose(data => {
  data.hmrReloaded = true
})

const PROMPT = ' \u001b[32m$\u001b[0m '
const LOCAL_COMMANDS = new Set(['clear', 'reset'])

export const Route = createFileRoute('/')({
  component: Page,
})

function Page() {
  const {
    markRefreshIntent,
    ensureClientSession,
    consumeRefreshIntent,
    clearStoredSessionState,
  } = useSession()

  const [sessionLabel, setSessionLabel] = createSignal('')
  const [statusMode, setStatusMode] = createSignal<StatusMode>('offline')
  const [statusMessage, setStatusMessage] = createSignal('Ready')
  const [prefilledCommand, setPrefilledCommand] = createSignal<string | null>(
    null,
  )

  let terminalRef: HTMLDivElement | undefined
  let virtualKeyboardBridge:
    | ReturnType<typeof createVirtualKeyboardBridge>
    | undefined

  onMount(() => {
    const session = ensureClientSession()
    setSessionLabel(session.sessionId)
    setPrefilledCommand(session.prefilledCommand)

    if (!terminalRef) throw new Error('Terminal mount missing')

    const resumed = consumeRefreshIntent()
    if (resumed) {
      console.debug('Session resumed after refresh:', {
        sessionId: session.sessionId,
        tabId: session.tabId,
      })
    }

    const terminalSession = useTerminalSession({
      session,
      terminalElement: terminalRef,
      streamingCommands: STREAMING_COMMANDS,
      interactiveCommands: INTERACTIVE_COMMANDS,
      localCommands: LOCAL_COMMANDS,
      prompt: PROMPT,
      isHotReload,
      setStatusMode,
      setStatusMessage,
      onRefreshIntent: markRefreshIntent,
      onClearSession: clearStoredSessionState,
    })

    virtualKeyboardBridge = terminalSession.virtualKeyboardBridge
  })

  return (
    <main
      id="terminal-wrapper"
      class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header class="relative">
        <Status mode={statusMode()} message={statusMessage()} />
        <div class="absolute top-1 right-1 z-50">
          <ShareButton prefilledCommand={prefilledCommand()} />
        </div>
      </header>
      <div
        id="terminal-container"
        class="min-h-0 flex-1 overflow-hidden bg-[#0d1117]">
        <div
          id="terminal"
          data-element="terminal"
          ref={terminalRef}
          class="size-full"
        />
      </div>
      <footer
        id="footer"
        class="flex items-center justify-between gap-4 px-2 py-1 text-[10px] uppercase tracking-wide text-white/10 hover:text-white">
        <span class="hidden" data-todo="true">
          {sessionLabel()}
        </span>
        <ExtraKeyboard
          onVirtualKey={event => {
            const { key, modifiers } = event.detail
            if (!key) return
            virtualKeyboardBridge?.sendVirtualKeyboardInput({
              key,
              ctrl: modifiers.includes('Control'),
              shift: modifiers.includes('Shift'),
            })
          }}
        />
      </footer>
    </main>
  )
}
