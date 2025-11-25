#!/usr/bin/env node

import { randomUUID } from 'node:crypto'

import { App } from 'uWebSockets.js'
import { spawn, type IPty } from 'node-pty'
import crossws from 'crossws/adapters/uws'

/**
 * WebSocket-based PTY bridge using node-pty + crossws + uWebSockets.js
 * Used for interactive commands (REPLs, chisel, node, etc.)
 *
 * node-pty provides a true PTY with:
 * - Native resize (SIGWINCH) - no echo artifacts
 * - Proper terminal capabilities
 * - Full escape sequence support
 *
 * uWebSockets.js provides high-performance WebSocket handling
 */

const [DEFAULT_COLS, DEFAULT_ROWS] = [120, 32]
const DEFAULT_SHELL = '/bin/bash --norc --noprofile'

type PtySession = {
  id: string
  pty: IPty
  cols: number
  rows: number
}

type SessionState =
  | { status: 'idle'; sessionId: string }
  | { status: 'ready'; sessionId: string; session: PtySession }

type ControlMessage =
  | { type: 'init'; cols?: number; rows?: number; shell?: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping'; id?: string }

type Peer = {
  send: (data: string | ArrayBuffer) => void
  close: (code?: number, reason?: string) => void
  readyState: number
}

const sessions = new WeakMap<Peer, SessionState>()

const ws = crossws({
  hooks: {
    open(peer) {
      const sessionId = randomUUID().slice(0, 8)
      sessions.set(peer, { status: 'idle', sessionId })
      peer.send(JSON.stringify({ type: 'ready' }))
      console.info('[pty] connection opened', { sessionId })
    },

    message(peer, message) {
      const state = sessions.get(peer)
      if (!state) return

      const data = message.text()

      // Try parsing as control message first
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

        if (payload.type === 'resize') {
          if (state.status !== 'ready') return
          resizePty(state.session, payload.cols, payload.rows)
          return
        }

        return
      }

      // Not a control message - treat as terminal input
      if (state.status !== 'ready') {
        console.warn('[pty] dropping input before init')
        return
      }

      state.session.pty.write(data)
    },

    close(peer, details) {
      const state = sessions.get(peer)
      if (state?.status === 'ready') {
        state.session.pty.kill()
      }
      console.info('[pty] connection closed', {
        sessionId: state?.sessionId,
        code: details.code,
        reason: details.reason,
      })
      sessions.delete(peer)
    },

    error(peer, error) {
      console.error('[pty] connection error', error)
      const state = sessions.get(peer)
      if (state?.status === 'ready') {
        state.session.pty.kill()
      }
      sessions.delete(peer)
    },
  },
})

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

  // Parse shell command - could be "bash" or "bash --noprofile --norc -i"
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
    cwd: process.env.HOME || '/workspace',
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // PS1 escape codes wrapped in \[...\] for bash readline cursor calculation
      // Using \e for escape (bash interprets this)
      PS1: '\\[\\033[32m\\]$ \\[\\033[0m\\]',
    } as Record<string, string>,
  })

  // Forward PTY output to WebSocket
  pty.onData((data: string) => {
    if (peer.readyState === 1) peer.send(data)
  })

  // Handle PTY exit
  pty.onExit(({ exitCode, signal }) => {
    console.info('[pty] process exited', { sessionId, exitCode, signal })
    if (peer.readyState === 1) {
      peer.send(JSON.stringify({ type: 'process-exit', exitCode, signal }))
      peer.close(1000, 'process exited')
    }
  })

  return { id: sessionId, pty, cols, rows }
}

function resizePty(session: PtySession, cols: number, rows: number): void {
  if (cols <= 0 || rows <= 0) return
  session.cols = cols
  session.rows = rows
  // node-pty's resize() sends SIGWINCH - no echo, no artifacts
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
    // Not a JSON control message - likely terminal input
  }
  return undefined
}

const port = Number(process.env.WS_PORT || 8080)

const server = App()
  .ws('/*', ws.websocket)
  .get('/*', response => {
    response.writeStatus('200 OK')
    response.writeHeader('Content-Type', 'text/plain')
    response.end(
      'Cloudflare Sandbox WebSocket PTY server (node-pty + uWebSockets.js)',
    )
  })

server.listen(port, listenSocket => {
  if (listenSocket) {
    console.log(`[pty] WebSocket PTY server listening on ws://0.0.0.0:${port}`)
  } else {
    console.error(`[pty] Failed to listen on port ${port}`)
    process.exit(1)
  }
})

const shutdown = () => {
  console.log('[pty] shutting down...')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGQUIT', shutdown)
