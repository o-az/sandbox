import type { Terminal } from '@xterm/xterm'
import type { SerializeAddon } from '@xterm/addon-serialize'

import type { StatusMode } from '#components/status.tsx'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export type InteractiveSessionOptions = {
  terminal: Terminal
  serializeAddon: SerializeAddon
  sessionId: string
  setStatus: (mode: StatusMode) => void
  onSessionExit?: (mode: StatusMode) => void
  logLevel?: 'info' | 'debug'
  wsEndpoint?: string
}

export type InteractiveSessionAPI = {
  startInteractiveSession: (command: string) => Promise<void>
  sendInteractiveInput: (data: string) => void
  notifyResize: (options: { cols: number; rows: number }) => void
  isInteractiveMode: () => boolean
}

export function createInteractiveSession({
  terminal,
  serializeAddon,
  sessionId,
  setStatus,
  onSessionExit,
  logLevel = 'debug',
  wsEndpoint,
}: InteractiveSessionOptions): InteractiveSessionAPI {
  const resolvedWsEndpoint =
    wsEndpoint ?? (typeof window !== 'undefined' ? window.location.origin : '')
  let interactiveSocket: WebSocket | undefined
  let interactiveMode = false
  let interactiveInitQueued = ''
  let interactiveResolve: (() => void) | undefined
  let interactiveReject: ((reason?: unknown) => void) | undefined
  let dataListener: import('@xterm/xterm').IDisposable | undefined

  function startInteractiveSession(command: string) {
    if (interactiveMode) {
      terminal.writeln(
        '\u001b[33mInteractive session already active. Type `exit` to close it.\u001b[0m',
      )
      setStatus('interactive')
      return Promise.resolve()
    }

    // Reject any pending promise before starting a new session
    interactiveReject?.(
      new Error('Session replaced by new interactive session'),
    )
    interactiveResolve = undefined
    interactiveReject = undefined

    interactiveMode = true
    interactiveInitQueued = command.endsWith('\n') ? command : `${command}\n`
    setStatus('interactive')
    terminal.writeln('\r\n\u001b[90mOpening interactive shell...\u001b[0m')

    dataListener = terminal.onData(data => {
      if (interactiveMode) sendInteractiveInput(data)
    })

    return new Promise<void>((resolve, reject) => {
      interactiveResolve = resolve
      interactiveReject = reject
      openInteractiveSocket()
    })
  }

  function openInteractiveSocket() {
    const url = websocketUrl(resolvedWsEndpoint, sessionId)
    const socket = new WebSocket(url)

    socket.binaryType = 'arraybuffer'
    interactiveSocket = socket

    socket.addEventListener('open', () => {
      sendInteractiveJson({
        type: 'init',
        cols: terminal.cols,
        rows: terminal.rows,
      })

      if (!interactiveInitQueued) return

      setTimeout(() => {
        sendInteractiveInput(interactiveInitQueued)
        interactiveInitQueued = ''
      }, 100)
    })
    socket.addEventListener('message', handleInteractiveMessage)
    socket.addEventListener('close', () => resetInteractiveState('online'))
    socket.addEventListener('error', event => {
      console.error('Interactive socket error', event)
      resetInteractiveState('error')
    })
  }

  function handleInteractiveMessage(event: MessageEvent) {
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
            terminal.writeln(
              `\r\n[interactive session exited with code ${exitCode}]`,
            )
            resetInteractiveState('online')
            return
          }
        }
      } catch {
        terminal.write(data, () => {
          if (logLevel === 'debug') console.info(serializeAddon.serialize())
        })
      }
      return
    }

    if (data instanceof ArrayBuffer) {
      const text = textDecoder.decode(new Uint8Array(data))
      if (text) {
        terminal.write(text, () => {
          if (logLevel === 'debug') console.info(serializeAddon.serialize())
        })
      }
      return
    }

    if (data instanceof Uint8Array) {
      const text = textDecoder.decode(data)
      if (text) {
        terminal.write(text, () => {
          if (logLevel === 'debug') console.info(serializeAddon.serialize())
        })
      }
    }
  }

  function resetInteractiveState(mode: StatusMode) {
    if (interactiveSocket && interactiveSocket.readyState === WebSocket.OPEN) {
      interactiveSocket.close()
    }
    interactiveSocket = undefined
    interactiveMode = false
    interactiveInitQueued = ''

    dataListener?.dispose()
    dataListener = undefined

    setStatus(mode)
    if (mode === 'error') {
      interactiveReject?.(new Error('Interactive session ended with error'))
    } else {
      interactiveResolve?.()
    }
    interactiveResolve = undefined
    interactiveReject = undefined
    onSessionExit?.(mode)
  }

  function sendInteractiveInput(text: string) {
    if (!text) return
    if (!interactiveSocket || interactiveSocket.readyState !== WebSocket.OPEN) {
      if (logLevel === 'debug') {
        console.warn(
          'WebSocket not open, input discarded:',
          text.length,
          'chars',
        )
      }
      return
    }
    try {
      interactiveSocket.send(textEncoder.encode(text))
    } catch (error) {
      if (logLevel === 'debug') {
        console.error('Failed to send input:', error)
      }
    }
  }

  function sendInteractiveJson(payload: unknown) {
    if (!interactiveSocket || interactiveSocket.readyState !== WebSocket.OPEN) {
      return
    }
    interactiveSocket.send(JSON.stringify(payload))
  }

  function notifyResize({ cols, rows }: { cols: number; rows: number }) {
    if (!interactiveMode) return
    sendInteractiveJson({ type: 'resize', cols, rows })
  }

  function isInteractiveMode() {
    return interactiveMode
  }

  return {
    startInteractiveSession,
    sendInteractiveInput,
    notifyResize,
    isInteractiveMode,
  }
}

function websocketUrl(wsEndpoint: string, sessionId: string) {
  const base = new URL(wsEndpoint)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = '/api/ws'
  base.searchParams.set('sessionId', sessionId)
  return base.toString()
}
