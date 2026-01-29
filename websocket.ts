#!/usr/bin/env node

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import crossws from 'crossws/adapters/node'
import { spawn, type IPty } from 'node-pty'
import type { AdapterInternal, Peer } from 'crossws'

const [DEFAULT_COLS, DEFAULT_ROWS] = [120, 32]
const DEFAULT_SHELL = '/bin/bash --norc --noprofile'

// Buffer settings for output batching (from xterm.js demo best practices)
const BUFFER_TIMEOUT_MS = 3
const BUFFER_MAX_SIZE = 262_144 // 256KB

type PtySession = {
  id: string
  pty: IPty
  cols: number
  rows: number
  outputBuffer: string
  userInputPending: boolean
  flushTimer: ReturnType<typeof setTimeout> | null
}

type SessionState =
  | { status: 'idle'; sessionId: string }
  | { status: 'ready'; sessionId: string; session: PtySession }

type ControlMessage =
  | { type: 'init'; cols?: number; rows?: number; shell?: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping'; id?: string }

const sessions = new WeakMap<Peer<AdapterInternal>, SessionState>()

const ws = crossws({
  hooks: {
    open: peer => {
      const sessionId = randomUUID().slice(0, 8)
      sessions.set(peer, { status: 'idle', sessionId })

      peer.send(JSON.stringify({ type: 'ready' }))
      console.info('[pty] connection opened', { sessionId })
    },

    message: (peer, message) => {
      const state = sessions.get(peer)
      if (!state) return
      const data = message.text()
      const payload = parseControlMessage(data)

      if (payload) {
        if (payload.type === 'ping') {
          peer.send(JSON.stringify({ type: 'pong', id: payload.id }))
          return
        }

        if (payload.type === 'init') {
          if (state.status === 'ready') return
          const session = spawnPty(peer, state.sessionId, {
            cols: payload.cols,
            rows: payload.rows,
            shell: payload.shell,
          })
          sessions.set(peer, {
            status: 'ready',
            sessionId: state.sessionId,
            session,
          })
          return
        }

        if (payload.type !== 'resize') return
        if (state.status !== 'ready') return
        resizePty({
          session: state.session,
          cols: payload.cols,
          rows: payload.rows,
        })
        return
      }

      // Not a control message - treat as terminal input
      if (state.status !== 'ready') {
        console.warn('[pty] dropping input before init')
        return
      }

      state.session.userInputPending = true
      state.session.pty.write(data)
    },

    close: (peer, event) => {
      const state = sessions.get(peer)
      if (state?.status === 'ready') {
        if (state.session.flushTimer) clearTimeout(state.session.flushTimer)
        state.session.pty.kill()
      }
      console.info('[pty] connection closed', {
        sessionId: state?.sessionId,
        code: event.code,
        reason: event.reason || undefined,
      })
      sessions.delete(peer)
    },

    error: (peer, error) => {
      console.error('[pty] connection error', error)
      const state = sessions.get(peer)
      if (state?.status === 'ready') {
        if (state.session.flushTimer) clearTimeout(state.session.flushTimer)
        state.session.pty.kill()
      }
      sessions.delete(peer)
    },

    upgrade: request => {
      console.info('[pty] upgrade', request.url)
      return { headers: {} }
    },
  },
})

const port = Number(process.env.WS_PORT || 80_80)

const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('PTY Server')
})
  .on('upgrade', ws.handleUpgrade)
  .listen(port, '0.0.0.0', () => {
    console.log(`[pty] 👂 ws://0.0.0.0:${port}`)
  })

const shutdown = () => {
  ;[console.log('[pty] shutting down...'), server.close(), process.exit(0)]
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGQUIT', shutdown)

function spawnPty(
  peer: Peer,
  sessionId: string,
  options: { cols?: number; rows?: number; shell?: string },
): PtySession {
  const cols =
    typeof options.cols === 'number' && options.cols > 0
      ? options.cols
      : DEFAULT_COLS
  const rows =
    typeof options.rows === 'number' && options.rows > 0
      ? options.rows
      : DEFAULT_ROWS

  const shell =
    typeof options.shell === 'string' && options.shell.trim().length > 0
      ? options.shell.trim()
      : DEFAULT_SHELL

  const shellParts = shell.split(/\s+/)
  const shellPath = shellParts[0]
  const shellArgs = shellParts.slice(1)

  console.info('[pty] starting session', {
    sessionId,
    cols,
    rows,
    shell: shellPath,
    args: shellArgs,
  })

  const pty = spawn(shellPath, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: '/workspace',
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
      CLICOLOR: '1',
      PS1: '\\[\\033[32m\\]$ \\[\\033[0m\\]',
      JQ_COLORS: '1;30:0;37:0;37:0;37:0;32:1;37:1;37',
      GCC_COLORS:
        'error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01',
    } as Record<string, string>,
  })

  const session: PtySession = {
    id: sessionId,
    pty,
    cols,
    rows,
    outputBuffer: '',
    flushTimer: null,
    userInputPending: false,
  }

  function flushOutput() {
    if (session.outputBuffer.length === 0) return
    if (peer.websocket.readyState === 1) peer.send(session.outputBuffer)

    session.outputBuffer = ''
    if (session.flushTimer) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }
  }

  pty.onData((data: string) => {
    session.outputBuffer += data

    if (
      session.userInputPending ||
      session.outputBuffer.length > BUFFER_MAX_SIZE
    ) {
      session.userInputPending = false
      flushOutput()
      return
    }

    if (!session.flushTimer) {
      session.flushTimer = setTimeout(flushOutput, BUFFER_TIMEOUT_MS)
    }
  })

  pty.onExit(({ exitCode, signal }) => {
    console.info('[pty] process exited', { sessionId, exitCode, signal })
    flushOutput()
    if (peer.websocket.readyState === 1) {
      peer.send(JSON.stringify({ type: 'process-exit', exitCode, signal }))
      peer.close(1000, 'process exited')
    }
  })

  return session
}

function resizePty(params: {
  session: PtySession
  cols: number
  rows: number
}): void {
  const { session, cols, rows } = params
  if (cols <= 0 || rows <= 0) return
  session.cols = cols
  session.rows = rows
  session.pty.resize(cols, rows)
}

function parseControlMessage(raw: string): ControlMessage | undefined {
  try {
    const payload = JSON.parse(raw) as ControlMessage
    if (!payload || typeof payload !== 'object') return undefined
    if (payload.type === 'init') return payload
    if (payload.type === 'resize') return payload
    if (payload.type === 'ping') return payload
  } catch {
    // Not JSON - terminal input
  }
  return undefined
}
