import {
  onMount,
  getOwner,
  onCleanup,
  createSignal,
  runWithOwner,
} from 'solid-js'
import { createFileRoute } from '@tanstack/solid-router'

import {
  useSession,
  STREAMING_COMMANDS,
  INTERACTIVE_COMMANDS,
} from '#context/session.tsx'
import { ShareButton } from '#components/share-button.tsx'
import { ExtraKeyboard } from '#components/extra-keyboard.tsx'
import { Status, type StatusMode } from '#components/status.tsx'
import { waitForTerminalRuntime } from '#lib/terminal/runtime.ts'
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
  const [statusMessage, setStatusMessage] = createSignal('Ready')
  const [statusMode, setStatusMode] = createSignal<StatusMode>('offline')
  const [prefilledCommand, setPrefilledCommand] = createSignal<string | null>(
    null,
  )
  const [getTerminalHtml, setGetTerminalHtml] = createSignal<
    (() => string) | null
  >(null)

  let terminalRef!: HTMLDivElement
  let virtualKeyboardBridge:
    | ReturnType<typeof createVirtualKeyboardBridge>
    | undefined

  let isActive = true
  onCleanup(() => {
    isActive = false
  })

  const componentOwner = getOwner()

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

    void (async () => {
      try {
        await waitForTerminalRuntime()
      } catch (error) {
        console.error('Failed to initialize terminal runtime', error)
        setStatusMode('error')
        setStatusMessage('Terminal failed to load')
        return
      }

      if (!isActive || !componentOwner) return

      runWithOwner(componentOwner, () => {
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

        // Expose terminal HTML serialization for sharing
        setGetTerminalHtml(() => () => {
          const { serializeAddon } = terminalSession.terminalManager
          return serializeAddon.serializeAsHTML({
            includeGlobalBackground: true,
          })
        })
      })
    })()
  })

  return (
    <main
      id="terminal-wrapper"
      class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header class="relative">
        <Status mode={statusMode()} message={statusMessage()} />
        <div class="absolute top-1 right-1 z-50">
          <ShareButton
            prefilledCommand={prefilledCommand()}
            getTerminalHtml={getTerminalHtml()}
          />
        </div>
      </header>

      <div
        id="terminal-container"
        class="min-h-0 flex-1 overflow-hidden bg-[#0d1117]">
        <div
          id="terminal"
          ref={terminalRef}
          class="size-full"
          data-element="terminal"
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
