import { debounce } from '@solid-primitives/scheduled'
import { createFileRoute } from '@tanstack/solid-router'
import { createSignal, onCleanup, onMount } from 'solid-js'

import {
  useSession,
  STREAMING_COMMANDS,
  INTERACTIVE_COMMANDS,
} from '#context/session.tsx'
import { startSandboxWarmup } from '#lib/warmup.ts'
import { TerminalManager } from '#lib/terminal-manager.ts'
import { initKeyboardInsets } from '#lib/keyboard-insets.ts'
import { createCommandRunner } from '#lib/command-runner.ts'
import { ExtraKeyboard } from '#components/extra-keyboard.tsx'
import { Status, type StatusMode } from '#components/status.tsx'
import { createInteractiveSession } from '#lib/interactive-session.ts'
import { createVirtualKeyboardBridge } from '#lib/virtual-keyboard.ts'

const PROMPT = ' \u001b[32m$\u001b[0m '
const LOCAL_COMMANDS = new Set(['clear', 'reset'])

export const Route = createFileRoute('/')({
  component: Page,
})

function Page() {
  const {
    ensureClientSession,
    markRefreshIntent,
    consumeRefreshIntent,
    clearStoredSessionState,
  } = useSession()
  const [statusMode, setStatusMode] = createSignal<StatusMode>('offline')
  const [sessionLabel, setSessionLabel] = createSignal('')
  const [statusMessage, setStatusMessage] = createSignal('Ready')

  let terminalRef: HTMLDivElement | undefined
  let virtualKeyboardBridge:
    | ReturnType<typeof createVirtualKeyboardBridge>
    | undefined

  onMount(() => {
    const session = ensureClientSession()
    setSessionLabel(session.sessionId)

    const terminalManager = new TerminalManager()
    const terminalElement = terminalRef
    if (!terminalElement) throw new Error('Terminal mount missing')

    let stopWarmup: (() => void) | undefined
    let cleanupInsets: (() => void) | undefined
    let resizeRaf: number | undefined
    let teardownScheduled = false
    let awaitingInput = false
    let commandInProgress = false
    let hasPrefilledCommand = false
    let sessionBroken = false
    let recoveringSession = false
    let isRefreshing = false
    let altNavigationDelegate: ((event: KeyboardEvent) => boolean) | undefined

    const terminal = terminalManager.init(terminalElement, {
      onAltNavigation: event => altNavigationDelegate?.(event) ?? false,
    })
    const fitAddon = terminalManager.fitAddon
    const xtermReadline = terminalManager.readline
    const readlineApi = xtermReadline as unknown as {
      read: (prompt: string) => Promise<string>
      println: (line: string) => void
      setCtrlCHandler: (handler: () => void) => void
    }
    const serializeAddon = terminalManager.serializeAddon

    const { runCommand } = createCommandRunner({
      sessionId: session.sessionId,
      terminal,
      setStatus: setStatusMode,
      displayError,
      streamingCommands: STREAMING_COMMANDS,
    })

    const {
      startInteractiveSession,
      sendInteractiveInput,
      notifyResize,
      isInteractiveMode,
    } = createInteractiveSession({
      terminal,
      serializeAddon,
      sessionId: session.sessionId,
      setStatus: setStatusMode,
      onSessionExit: () => {
        commandInProgress = false
        setStatusMessage('Ready')
        startInputLoop()
      },
      logLevel: session.logLevel,
    })

    virtualKeyboardBridge = createVirtualKeyboardBridge({
      xtermReadline,
      sendInteractiveInput,
      isInteractiveMode,
    })
    altNavigationDelegate = virtualKeyboardBridge.handleAltNavigation

    cleanupInsets = initKeyboardInsets()

    terminal.writeln('\r')
    terminal.focus()
    setStatusMode(navigator.onLine ? 'online' : 'offline')

    const resumed = consumeRefreshIntent()
    if (resumed) {
      console.debug('Session resumed after refresh:', {
        sessionId: session.sessionId,
        tabId: session.tabId,
      })
    }

    const stopWarmupLoop = startSandboxWarmup({
      sessionId: session.sessionId,
      tabId: session.tabId,
    })
    stopWarmup = stopWarmupLoop

    const handleOnline = () => {
      if (!isInteractiveMode()) setStatusMode('online')
    }
    const handleOffline = () => setStatusMode('offline')
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'execute') {
        terminal.options.disableStdin = false
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
        terminal.textarea?.dispatchEvent(enterEvent)
        setTimeout(() => {
          if (session.embedMode) terminal.options.disableStdin = true
        }, 200)
      }
    }
    window.addEventListener('message', handleMessage)

    const debouncedHandleResize = debounce(() => {
      fitAddon.fit()
      notifyResize({ cols: terminal.cols, rows: terminal.rows })
    }, 400)

    let resizeListener = () => {}
    const handleResize = () => {
      if (document.hidden) return
      if (resizeRaf) cancelAnimationFrame(resizeRaf)
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = undefined
        debouncedHandleResize()
      })
    }
    resizeListener = handleResize
    window.addEventListener('resize', resizeListener)

    readlineApi.setCtrlCHandler(() => {
      if (isInteractiveMode() || commandInProgress) return
      readlineApi.println('^C')
      setStatusMode('online')
      setStatusMessage('Ready')
      startInputLoop()
    })

    const handleBeforeUnload = () => {
      markRefreshIntent()
      isRefreshing = true
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    const teardownSandbox = () => {
      if (teardownScheduled) return
      teardownScheduled = true
      if (resizeRaf) cancelAnimationFrame(resizeRaf)
      resizeRaf = undefined
      stopWarmup?.()
      cleanupInsets?.()
      terminalManager.dispose()

      if (isRefreshing) {
        console.debug(
          'Page refreshing, keeping sandbox alive:',
          session.sessionId,
        )
        return
      }

      const body = JSON.stringify({
        sessionId: session.sessionId,
        tabId: session.tabId,
      })
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' })
        navigator.sendBeacon('/api/reset', blob)
        return
      }
      fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        // keepalive: true,
      }).catch(() => {
        // ignore errors during teardown
      })
    }

    window.addEventListener('pagehide', teardownSandbox, { once: true })

    const cleanup = () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('resize', resizeListener)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', teardownSandbox)
      teardownSandbox()
    }

    startInputLoop()

    onCleanup(cleanup)

    function startInputLoop() {
      if (isInteractiveMode() || awaitingInput) return
      awaitingInput = true

      readlineApi
        .read(PROMPT)
        .then(async rawCommand => {
          awaitingInput = false
          await processCommand(rawCommand)
          startInputLoop()
        })
        .catch(error => {
          awaitingInput = false
          if (isInteractiveMode()) return
          console.error('xtermReadline error', error)
          setStatusMode('error')
          startInputLoop()
        })

      if (!hasPrefilledCommand && session.prefilledCommand) {
        hasPrefilledCommand = true
        setTimeout(() => {
          const dataTransfer = new DataTransfer()
          dataTransfer.setData('text/plain', session.prefilledCommand ?? '')
          const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
          })
          terminal.textarea?.dispatchEvent(pasteEvent)

          if (session.embedMode && !session.autoRun) {
            terminal.options.disableStdin = true
          }

          if (session.autoRun) {
            setTimeout(() => {
              const enterEvent = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
              })
              terminal.textarea?.dispatchEvent(enterEvent)
            }, 100)
          }
        }, 50)
      }
    }

    async function processCommand(rawCommand: string) {
      const trimmed = rawCommand.trim()
      if (!trimmed) {
        setStatusMode(navigator.onLine ? 'online' : 'offline')
        setStatusMessage('Ready')
        return
      }

      const normalized = trimmed.toLowerCase()
      if (sessionBroken && normalized !== 'reset') {
        setStatusMode('error')
        displayError(
          'Sandbox shell is unavailable. Type `reset` or refresh the page to start a new session.',
        )
        return
      }

      if (isLocalCommand(trimmed)) {
        executeLocalCommand(trimmed)
        return
      }

      if (INTERACTIVE_COMMANDS.has(normalized)) {
        commandInProgress = true
        setStatusMessage(`Interactive: ${trimmed}`)
        await startInteractiveSession(rawCommand)
        return
      }

      commandInProgress = true
      setStatusMode('online')
      setStatusMessage(`Running: ${trimmed}`)

      try {
        await runCommand(rawCommand)
        if (!isInteractiveMode()) {
          setStatusMode('online')
          setStatusMessage('Ready')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isFatalSandboxError(message)) {
          handleFatalSandboxError(message)
          return
        }
        setStatusMode('error')
        setStatusMessage('Error')
        displayError(message)
      } finally {
        commandInProgress = false
      }
    }

    function isLocalCommand(command: string) {
      return LOCAL_COMMANDS.has(command.trim().toLowerCase())
    }

    function executeLocalCommand(command: string) {
      const normalized = command.trim().toLowerCase()
      if (normalized === 'clear') {
        terminal.clear()
        setStatusMode('online')
        setStatusMessage('Ready')
        return
      }
      if (normalized === 'reset') {
        void resetSandboxSession()
      }
    }

    function displayError(message: string) {
      terminal.writeln(`\u001b[31m${message}\u001b[0m`)
    }

    function isFatalSandboxError(message: string) {
      const normalized = message.toLowerCase()
      return (
        normalized.includes('shell has died') ||
        normalized.includes('session is dead') ||
        normalized.includes('shell terminated unexpectedly') ||
        normalized.includes('not ready or shell has died')
      )
    }

    function handleFatalSandboxError(message: string) {
      sessionBroken = true
      setStatusMode('error')
      displayError(
        `${message}\nType \`reset\` or refresh the page to create a new sandbox session.`,
      )
    }

    async function resetSandboxSession() {
      if (recoveringSession) return
      recoveringSession = true
      setStatusMode('error')
      setStatusMessage('Resetting...')
      terminal.writeln('\nResetting sandbox session...')

      try {
        await fetch('/api/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: session.sessionId,
            tabId: session.tabId,
          }),
        })
      } catch (error) {
        console.error('Failed to reset sandbox session', error)
      }

      clearStoredSessionState()
      setTimeout(() => window.location.reload(), 500)
    }
  })

  return (
    <main
      id="terminal-wrapper"
      class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header class="relative">
        <Status mode={statusMode()} message={statusMessage()} />
      </header>
      <div id="terminal-container" class="flex-1 overflow-hidden bg-[#0d1117]">
        <div
          id="terminal"
          data-element="terminal"
          ref={terminalRef}
          class="h-full w-full"
        />
      </div>
      <footer
        id="footer"
        class="flex items-center justify-between gap-4 pl-1 text-[10px] uppercase tracking-wide text-white/10 hover:text-white">
        <span>{sessionLabel()}</span>
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
