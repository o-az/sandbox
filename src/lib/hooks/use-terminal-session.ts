import { onCleanup, type Setter } from 'solid-js'
import { debounce } from '@solid-primitives/scheduled'
import { makeEventListener } from '@solid-primitives/event-listener'

import {
  initKeyboardInsets,
  createVirtualKeyboardBridge,
} from '#lib/terminal/keyboard.ts'
import {
  startSandboxWarmup,
  type WarmupController,
} from '#lib/sandbox/warmup.ts'
import type { StatusMode } from '#components/status.tsx'
import { TerminalManager } from '#lib/terminal/manager.ts'
import { createTerminalState } from '#lib/terminal/state.ts'
import type { ClientSessionState } from '#context/session.tsx'
import { createCommandRunner } from '#lib/sandbox/command-runner.ts'
import { createInteractiveSession } from '#lib/sandbox/interactive.ts'

export type UseTerminalSessionOptions = {
  session: ClientSessionState
  terminalElement: HTMLDivElement
  streamingCommands: Set<string>
  interactiveCommands: Set<string>
  localCommands: Set<string>
  prompt: string
  isHotReload?: boolean
  setStatusMode: Setter<StatusMode>
  setStatusMessage: Setter<string>
  onRefreshIntent: () => void
  onClearSession: () => void
}

export type UseTerminalSessionReturn = {
  virtualKeyboardBridge: ReturnType<typeof createVirtualKeyboardBridge>
  terminalManager: TerminalManager
}

export function useTerminalSession({
  session,
  terminalElement,
  streamingCommands,
  interactiveCommands,
  localCommands,
  prompt,
  isHotReload = false,
  setStatusMode,
  setStatusMessage,
  onRefreshIntent,
  onClearSession,
}: UseTerminalSessionOptions): UseTerminalSessionReturn {
  const internalState = createTerminalState()
  const terminalManager = new TerminalManager()

  // Sync internal state to external signals
  const syncStatus = () => {
    setStatusMode(internalState.statusMode())
    setStatusMessage(internalState.statusMessage())
  }

  // Wrap state actions to sync after each call
  const state = {
    ...internalState,
    actions: Object.fromEntries(
      Object.entries(internalState.actions).map(([key, fn]) => [
        key,
        (...args: unknown[]) => {
          ;(fn as (...args: unknown[]) => void)(...args)
          syncStatus()
        },
      ]),
    ) as typeof internalState.actions,
  }

  let warmupController: WarmupController | undefined
  let cleanupInsets: (() => void) | undefined
  let resizeRaf: number | undefined
  let teardownScheduled = false
  let awaitingInput = false
  let hasPrefilledCommand = false
  let recoveringSession = false
  let isRefreshing = false
  let refreshShortcutPending = false
  let refreshShortcutTimer: number | undefined
  let inputLoopReady = false
  let pendingEmbedExecute = false
  let disposed = false

  // Initialize terminal
  let altNavigationDelegate: ((event: KeyboardEvent) => boolean) | undefined
  let clearLineDelegate: (() => boolean) | undefined
  let jumpToLineEdgeDelegate: ((edge: 'start' | 'end') => boolean) | undefined
  const terminal = terminalManager.init(terminalElement, {
    onAltNavigation: event => altNavigationDelegate?.(event) ?? false,
    onClearLine: () => clearLineDelegate?.() ?? false,
    onJumpToLineEdge: edge => jumpToLineEdgeDelegate?.(edge) ?? false,
  })

  const fitAddon = terminalManager.fitAddon
  const xtermReadline = terminalManager.readline
  const serializer = terminalManager.serializeAddon

  // Command runner
  const { runCommand } = createCommandRunner({
    sessionId: session.sessionId,
    terminal,
    setStatus: mode => {
      if (mode === 'online') state.actions.setOnline()
      else if (mode === 'offline') state.actions.setOffline()
      else if (mode === 'error') state.actions.setError('')
    },
    displayError,
    streamingCommands,
  })

  // Interactive session
  const {
    startInteractiveSession,
    sendInteractiveInput,
    notifyResize,
    isInteractiveMode,
  } = createInteractiveSession({
    terminal,
    serializer,
    sessionId: session.sessionId,
    setStatus: mode => {
      if (mode === 'interactive') return // handled by state machine
      if (mode === 'online') state.actions.setOnline()
      else if (mode === 'error') state.actions.setError('')
    },
    onSessionExit: () => {
      state.actions.setIdle()
      startInputLoop()
    },
    logLevel: session.logLevel,
  })

  // Virtual keyboard
  const virtualKeyboardBridge = createVirtualKeyboardBridge({
    xtermReadline,
    sendInteractiveInput,
    isInteractiveMode: () => state.isInteractiveMode(),
  })
  altNavigationDelegate = virtualKeyboardBridge.handleAltNavigation
  clearLineDelegate = virtualKeyboardBridge.handleClearLine
  jumpToLineEdgeDelegate = virtualKeyboardBridge.handleJumpToLineEdge

  // Keyboard insets
  cleanupInsets = initKeyboardInsets()

  // Initial setup
  terminal.writeln('\r')
  terminal.focus()
  state.actions.updateOnlineStatus()

  // Warmup - wait for initial warmup before allowing commands
  warmupController = startSandboxWarmup({
    sessionId: session.sessionId,
    tabId: session.tabId,
    skipImmediate: isHotReload,
  })

  // Online/offline handlers
  makeEventListener(window, 'online', () => state.actions.setOnline())
  makeEventListener(window, 'offline', () => state.actions.setOffline())

  // Embed mode message handler
  makeEventListener(window, 'message', (event: MessageEvent) => {
    if (event.data?.type === 'execute') executeEmbedCommand()
  })

  // Embed mode keyboard handler
  if (session.embedMode) {
    makeEventListener(
      terminalElement,
      'keydown',
      (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !state.isCommandInProgress()) {
          event.preventDefault()
          executeEmbedCommand()
        }
      },
      { capture: true },
    )
  }

  // Use term.onResize for PTY notification (xterm.js demo best practice)
  // This fires whenever terminal dimensions actually change, more reliable than window resize
  terminal.onResize(({ cols, rows }) => {
    notifyResize({ cols, rows })
    // Refresh readline display after resize to maintain cursor position
    virtualKeyboardBridge.handleResize()
  })

  // Window resize triggers fit(), which may trigger term.onResize if dimensions change
  const debouncedHandleResize = debounce(() => {
    fitAddon.fit()
  }, 400)

  makeEventListener(window, 'resize', () => {
    if (document.hidden) return
    if (resizeRaf) cancelAnimationFrame(resizeRaf)
    resizeRaf = window.requestAnimationFrame(() => {
      resizeRaf = undefined
      debouncedHandleResize()
    })
  })

  // Ctrl+C handler
  xtermReadline.setCtrlCHandler(() => {
    if (state.isInteractiveMode() || state.isCommandInProgress()) return
    xtermReadline.println('^C')
    state.actions.setIdle()
    startInputLoop()
  })

  // Refresh intent tracking
  makeEventListener(window, 'beforeunload', () => {
    if (refreshShortcutPending) {
      onRefreshIntent()
      isRefreshing = true
    } else {
      isRefreshing = false
    }
  })

  makeEventListener(window, 'keydown', (event: KeyboardEvent) => {
    const key = event.key
    const isReloadShortcut =
      key === 'F5' ||
      (key.toLowerCase() === 'r' && (event.metaKey || event.ctrlKey))

    if (!isReloadShortcut) return
    refreshShortcutPending = true
    window.clearTimeout(refreshShortcutTimer)
    refreshShortcutTimer = window.setTimeout(() => {
      refreshShortcutPending = false
    }, 1500)
  })

  // Teardown
  const teardownSandbox = () => {
    if (teardownScheduled) return
    teardownScheduled = true

    if (resizeRaf) cancelAnimationFrame(resizeRaf)
    resizeRaf = undefined
    warmupController?.stop()
    cleanupInsets?.()
    terminalManager.dispose()

    // Skip sandbox destruction during HMR or page refresh
    if (import.meta.hot || isRefreshing) {
      console.debug(
        'Keeping sandbox alive (HMR or refresh):',
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
    }).catch(() => {
      // ignore errors during teardown
    })
  }

  makeEventListener(window, 'pagehide', teardownSandbox, { once: true })

  // Cleanup
  onCleanup(() => {
    disposed = true
    window.clearTimeout(refreshShortcutTimer)
    debouncedHandleResize.clear?.()
    teardownSandbox()
  })

  // Input loop
  function startInputLoop() {
    if (disposed || state.isInteractiveMode() || awaitingInput) return
    awaitingInput = true
    state.actions.setAwaitingInput()

    // Ensure bracketed paste mode is disabled before reading input
    // (interactive programs like vi may have enabled it)
    terminal.write('\x1b[?2004l')

    xtermReadline
      .read(prompt)
      .then(async rawCommand => {
        awaitingInput = false
        await processCommand(rawCommand)
        startInputLoop()
      })
      .catch(error => {
        awaitingInput = false
        if (disposed || state.isInteractiveMode()) return
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        console.error('xtermReadline error:', errorMessage, error)
        state.actions.setError(`Input error: ${errorMessage}`)
        startInputLoop()
      })

    handlePrefilledCommand()
  }

  function handlePrefilledCommand() {
    if (hasPrefilledCommand || !session.prefilledCommand) {
      // No prefilled command, mark ready immediately
      inputLoopReady = true
      processPendingEmbedExecute()
      return
    }
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

      // Mark ready after prefilled command is pasted
      inputLoopReady = true
      processPendingEmbedExecute()

      if (session.autoRun) {
        setTimeout(() => {
          dispatchEnterKey()
        }, 100)
      }
    }, 50)
  }

  function executeEmbedCommand() {
    if (!session.embedMode) return

    // If the input loop isn't ready yet, queue the execution for later
    if (!inputLoopReady) {
      pendingEmbedExecute = true
      return
    }

    terminal.options.disableStdin = false
    dispatchEnterKey()
    setTimeout(() => {
      if (session.embedMode) terminal.options.disableStdin = true
    }, 200)
  }

  function processPendingEmbedExecute() {
    if (!pendingEmbedExecute) return
    pendingEmbedExecute = false
    // Small delay to ensure everything is settled
    setTimeout(() => executeEmbedCommand(), 50)
  }

  function dispatchEnterKey() {
    try {
      if (typeof terminal.input === 'function') {
        terminal.input('\r', true)
        return
      }
    } catch (error) {
      console.debug('terminal.input failed', error)
    }

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    terminal.textarea?.dispatchEvent(enterEvent)
  }

  async function processCommand(rawCommand: string) {
    const trimmed = rawCommand.trim()
    if (!trimmed) {
      state.actions.setIdle()
      return
    }

    const normalized = trimmed.toLowerCase()
    const firstWord = normalized.split(/\s+/)[0] ?? ''

    if (state.isSessionBroken() && firstWord !== 'reset') {
      state.actions.setError('Session broken')
      displayError(
        'Sandbox shell is unavailable. Type `reset` or refresh the page to start a new session.',
      )
      return
    }

    // Local commands
    if (localCommands.has(firstWord)) {
      executeLocalCommand(trimmed)
      return
    }

    // Interactive commands
    if (interactiveCommands.has(firstWord)) {
      state.actions.setInteractive(trimmed)
      try {
        await startInteractiveSession(rawCommand)
      } catch (error) {
        state.actions.setIdle()
        const message = error instanceof Error ? error.message : String(error)
        displayError(message)
      }
      return
    }

    // Regular commands
    state.actions.setRunningCommand(trimmed)

    try {
      await runCommand(rawCommand)
      if (!state.isInteractiveMode()) {
        state.actions.setIdle()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isFatalSandboxError(message)) {
        handleFatalSandboxError(message)
        return
      }
      state.actions.setError('Error')
      displayError(message)
    }
  }

  function executeLocalCommand(command: string) {
    const normalized = command.trim().toLowerCase()

    if (normalized === 'clear') {
      terminal.clear()
      state.actions.setIdle()
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
    state.actions.setBroken('Session broken')
    displayError(
      `${message}\nType \`reset\` or refresh the page to create a new sandbox session.`,
    )
  }

  async function resetSandboxSession() {
    if (recoveringSession) return
    recoveringSession = true
    state.actions.setRecovering()
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

    onClearSession()
    setTimeout(() => void window.location.reload(), 500)
  }

  // Initial sync and start after warmup completes
  syncStatus()

  // Wait for initial warmup to complete before accepting commands
  // This prevents race conditions where commands and warmup both try to create the session
  warmupController.ready
    .then(() => {
      // Re-fit and scroll after warmup content is written to ensure viewport is correct
      fitAddon.fit()
      terminal.scrollToBottom()
      startInputLoop()
    })
    .catch(error => {
      console.error('Warmup failed:', error)
      state.actions.setError('Warmup failed')
      // Still start the input loop so user can interact
      startInputLoop()
    })

  return {
    virtualKeyboardBridge,
    terminalManager,
  }
}
