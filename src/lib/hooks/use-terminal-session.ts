import { onCleanup, type Setter } from 'solid-js'
import { debounce } from '@solid-primitives/scheduled'
import { makeEventListener } from '@solid-primitives/event-listener'

import { initKeyboardInsets } from '#lib/terminal/keyboard.ts'
import {
  startSandboxWarmup,
  type WarmupController,
} from '#lib/sandbox/warmup.ts'
import type { StatusMode } from '#components/status.tsx'
import { TerminalManager } from '#lib/terminal/manager.ts'
import { createTerminalState } from '#lib/terminal/state.ts'
import type { ClientSessionState } from '#context/session.tsx'

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
  terminalManager: TerminalManager
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function useTerminalSession({
  session,
  terminalElement,
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
  let recoveringSession = false
  let isRefreshing = false
  let refreshShortcutPending = false
  let refreshShortcutTimer: number | undefined
  let disposed = false

  // PTY WebSocket state
  let ptySocket: WebSocket | undefined
  let ptyConnected = false
  let dataListener: import('ghostty-web').IDisposable | undefined

  // Initialize terminal with PTY input handler
  const terminal = terminalManager.init(terminalElement, {
    onPaste: text => sendPtyInput(text),
  })

  const fitAddon = terminalManager.fitAddon
  const serializer = terminalManager.serializeAddon

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

  // Use term.onResize for PTY notification
  terminal.onResize(({ cols, rows }) => {
    sendPtyJson({ type: 'resize', cols, rows })
  })

  // Window resize triggers fit()
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
    closePtySocket()
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

  // ============================================================================
  // PTY WebSocket Functions
  // ============================================================================

  function openPtySocket() {
    const url = websocketUrl(window.location.origin, session.sessionId)
    const socket = new WebSocket(url)

    socket.binaryType = 'arraybuffer'
    ptySocket = socket

    socket.addEventListener('open', () => {
      ptyConnected = true
      state.actions.setOnline()

      // Initialize PTY with terminal dimensions
      sendPtyJson({
        type: 'init',
        cols: terminal.cols,
        rows: terminal.rows,
      })

      // Wire up terminal input to PTY
      dataListener = terminal.onData(data => {
        // Handle local commands (clear, reset) before sending to PTY
        if (data === '\r') {
          // Enter key - check for local commands after the fact
          // The shell will handle the command, but we intercept reset/clear
        }
        sendPtyInput(data)
      })

      // Handle prefilled command
      handlePrefilledCommand()
    })

    socket.addEventListener('message', handlePtyMessage)

    socket.addEventListener('close', () => {
      ptyConnected = false
      dataListener?.dispose()
      dataListener = undefined
      if (!disposed) {
        state.actions.setIdle()
        // Attempt to reconnect after a short delay
        setTimeout(() => {
          if (!disposed && !ptyConnected) {
            openPtySocket()
          }
        }, 1000)
      }
    })

    socket.addEventListener('error', event => {
      console.error('PTY socket error', event)
      ptyConnected = false
      state.actions.setError('Connection error')
    })
  }

  function handlePtyMessage(event: MessageEvent) {
    const { data } = event

    if (typeof data === 'string') {
      try {
        const payload: unknown = JSON.parse(data)
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'type' in payload
        ) {
          const messageType = (payload as { type: unknown }).type
          if (messageType === 'pong' || messageType === 'ready') return
          if (messageType === 'process-exit') {
            const exitCode =
              'exitCode' in payload &&
              typeof (payload as { exitCode: unknown }).exitCode === 'number'
                ? (payload as { exitCode: number }).exitCode
                : 'unknown'
            terminal.writeln(`\r\n[shell exited with code ${exitCode}]`)
            state.actions.setBroken('Shell exited')
            return
          }
        }
      } catch {
        terminal.write(data, () => {
          if (session.logLevel === 'debug') console.info(serializer.serialize())
        })
      }
      return
    }

    if (data instanceof ArrayBuffer) {
      const text = textDecoder.decode(new Uint8Array(data))
      if (text) {
        terminal.write(text, () => {
          if (session.logLevel === 'debug') console.info(serializer.serialize())
        })
      }
      return
    }

    if (data instanceof Uint8Array) {
      const text = textDecoder.decode(data)
      if (text) {
        terminal.write(text, () => {
          if (session.logLevel === 'debug') console.info(serializer.serialize())
        })
      }
    }
  }

  function sendPtyInput(text: string) {
    if (!text) return
    if (!ptySocket || ptySocket.readyState !== WebSocket.OPEN) {
      if (session.logLevel === 'debug') {
        console.warn(
          'PTY socket not open, input discarded:',
          text.length,
          'chars',
        )
      }
      return
    }
    try {
      ptySocket.send(textEncoder.encode(text))
    } catch (error) {
      if (session.logLevel === 'debug') {
        console.error('Failed to send PTY input:', error)
      }
    }
  }

  function sendPtyJson(payload: unknown) {
    if (!ptySocket || ptySocket.readyState !== WebSocket.OPEN) {
      return
    }
    ptySocket.send(JSON.stringify(payload))
  }

  function closePtySocket() {
    if (ptySocket && ptySocket.readyState === WebSocket.OPEN) {
      ptySocket.close()
    }
    ptySocket = undefined
    ptyConnected = false
    dataListener?.dispose()
    dataListener = undefined
  }

  // ============================================================================
  // Command Handling
  // ============================================================================

  function handlePrefilledCommand() {
    if (!session.prefilledCommand) return

    setTimeout(() => {
      sendPtyInput(session.prefilledCommand ?? '')

      if (session.embedMode && !session.autoRun) {
        terminal.options.disableStdin = true
      }

      if (session.autoRun) {
        setTimeout(() => {
          sendPtyInput('\r')
        }, 100)
      }
    }, 100)
  }

  function executeEmbedCommand() {
    if (!session.embedMode) return
    terminal.options.disableStdin = false
    sendPtyInput('\r')
    setTimeout(() => {
      if (session.embedMode) terminal.options.disableStdin = true
    }, 200)
  }

  async function resetSandboxSession() {
    if (recoveringSession) return
    recoveringSession = true
    state.actions.setRecovering()
    terminal.writeln('\nResetting sandbox session...')

    closePtySocket()

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
  // Expose reset function on window for local command handling
  ;(
    window as unknown as { resetSandboxSession?: () => Promise<void> }
  ).resetSandboxSession = resetSandboxSession

  // Initial sync and start after warmup completes
  syncStatus()

  // Wait for initial warmup to complete before connecting PTY
  warmupController.ready
    .then(() => {
      // Re-fit and scroll after warmup content is written
      fitAddon.fit()
      terminal.scrollToBottom()
      // Connect to PTY
      openPtySocket()
    })
    .catch(error => {
      console.error('Warmup failed:', error)
      state.actions.setError('Warmup failed')
      // Still try to connect PTY
      openPtySocket()
    })

  return {
    terminalManager,
  }
}

function websocketUrl(wsEndpoint: string, sessionId: string) {
  const base = new URL(wsEndpoint)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = '/api/ws'
  base.searchParams.set('sessionId', sessionId)
  return base.toString()
}
