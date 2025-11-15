import type { Terminal } from '@xterm/xterm'
import type { SerializeAddon } from '@xterm/addon-serialize'

import type { StatusMode } from '#lib/status-indicator.ts'

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
  setStatus,
  onSessionExit,
  sessionId,
  logLevel = 'info',
  wsEndpoint = '/api/ws',
}: InteractiveSessionOptions): InteractiveSessionAPI {
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
    const url = websocketUrl(wsEndpoint, sessionId)
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    interactiveSocket = socket
    socket.addEventListener('open', () => {
      sendInteractiveJson({
        type: 'init',
        cols: terminal.cols ?? 120,
        rows: terminal.rows ?? 32,
      })
      if (interactiveInitQueued) {
        setTimeout(() => {
          sendInteractiveInput(interactiveInitQueued)
          interactiveInitQueued = ''
        }, 100)
      }
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
        const payload: any = JSON.parse(data)
        if (payload?.type === 'pong' || payload?.type === 'ready') return
        if (payload?.type === 'process-exit') {
          const exitCode =
            typeof payload.exitCode === 'number' ? payload.exitCode : 'unknown'
          terminal.writeln(
            `\r\n[interactive session exited with code ${exitCode}]`,
          )
          resetInteractiveState('online')
          return
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
      return
    }
    interactiveSocket.send(textEncoder.encode(text))
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

function websocketUrl(endpoint: string, sessionId: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.host
  const search = new URLSearchParams({ sessionId }).toString()
  return `${protocol}://${host}${endpoint}?${search}`
}
