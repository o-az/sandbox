import { randomUUID } from 'node:crypto'
import type { ServerWebSocket } from 'bun'

/**
 * WebSocket-based PTY bridge
 * Used only for interactive commands (REPLs, chisel, node, etc.)
 */

const [DEFAULT_COLS, DEFAULT_ROWS] = [120, 32]
const DEFAULT_SHELL = 'bash --noprofile --norc -i'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

type ShellSession = {
  id: string
  cols: number
  rows: number
  close: () => void
  suppressions: Array<Suppression>
  process: ReturnType<typeof Bun.spawn>
  stdin: { end?: () => unknown; write?: (chunk: Uint8Array) => unknown }
}

type SessionState =
  | { status: 'idle'; sessionId: string }
  | { status: 'ready'; sessionId: string; session: ShellSession }

type ControlMessage =
  | { type: 'init'; cols?: number; rows?: number; shell?: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping'; id?: string }

type Suppression = { bytes: Uint8Array; index: number }

const server = Bun.serve<SessionState>({
  hostname: '0.0.0.0',
  port: Number(Bun.env.WS_PORT || 8080),
  development: Bun.env.ENVIRONMENT !== 'production',
  fetch: (request, server) => {
    const sessionId =
      request.headers.get('x-sandbox-session-id') ?? randomUUID().slice(0, 8)

    if (
      server.upgrade(request, {
        headers: {
          'x-sandbox-session-id': sessionId,
        },
        data: {
          status: 'idle',
          sessionId,
        },
      })
    ) {
      return
    }

    return new Response('Cloudflare Sandbox WebSocket shell server')
  },
  websocket: {
    open: ws => {
      ws.send(JSON.stringify({ type: 'ready' }))
    },
    message: (ws, message) => {
      const state = ws.data
      if (!state) return

      if (typeof message === 'string') {
        const payload = parseControlMessage(message)
        if (!payload) return

        if (payload.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', id: payload.id }))
          return
        }

        if (payload.type === 'init') {
          if (state.status === 'ready') return
          const session = spawnShell(ws, {
            cols: payload.cols,
            rows: payload.rows,
            shell: payload.shell,
          })
          ws.data = {
            status: 'ready',
            sessionId: state.sessionId,
            session,
          }
          return
        }

        if (payload.type === 'resize') {
          if (state.status !== 'ready') return
          applyResize(state.session, payload.cols, payload.rows)
        }

        return
      }

      if (state.status !== 'ready') {
        console.warn('[shell] dropping binary payload before init')
        return
      }

      const session = state.session
      if (message instanceof ArrayBuffer) {
        writeInput(session, new Uint8Array(message))
        return
      }

      if (message instanceof Uint8Array) {
        writeInput(session, message)
        return
      }

      if (ArrayBuffer.isView(message)) {
        const view = message as ArrayBufferView
        writeInput(
          session,
          new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
        )
        return
      }

      console.warn('[shell] unsupported payload type', typeof message)
    },
    close: (ws, code, reason) => {
      const state = ws.data
      if (state?.status === 'ready') {
        state.session.close()
      }
      console.info(
        '[shell] websocket closed',
        JSON.stringify({
          sessionId: state?.sessionId,
          code,
          reason,
        }),
      )
    },
  },
  error: error => {
    console.error('[shell] server error', error)
    const message =
      error instanceof Error ? error.message : 'Unknown server error'
    return new Response(message, { status: 500 })
  },
})

function queueSuppression(
  suppressions: Array<Suppression>,
  text: string,
): void {
  suppressions.push({ bytes: encoder.encode(text), index: 0 })
}

function stripSuppressed(
  suppressions: Array<Suppression>,
  data: Uint8Array,
): Uint8Array {
  if (!suppressions.length || !data.length) return data
  const output: Array<number> = []
  let idx = 0

  while (idx < data.length) {
    if (!suppressions.length) {
      output.push(data[idx])
      idx++
      continue
    }

    const [current] = suppressions
    if (data[idx] === current.bytes[current.index]) {
      current.index++
      idx++
      if (current.index === current.bytes.length) {
        suppressions.shift()
      }
      continue
    }

    if (current.index > 0) {
      output.push(...current.bytes.slice(0, current.index))
      suppressions.shift()
      continue
    }

    suppressions.shift()
  }

  return Uint8Array.from(output)
}

function removeResizeEcho(data: Uint8Array): Uint8Array {
  if (!data.length) return data
  const text = decoder.decode(data)
  if (!text.includes('stty cols')) return data
  const cleaned = text.replace(
    /(?:\r?\n)?(?:[^\r\n]*?#\s*)?stty cols \d+ rows \d+(?:\r?\n)?/g,
    '',
  )
  if (!cleaned.includes('bash-')) return encoder.encode(cleaned)
  const lines = cleaned.split(/\r?\n/)
  const promptPattern = /^bash-[^#]+#\s*$/
  const filtered: Array<string> = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      const last = filtered[filtered.length - 1]
      if (!last || last.trim().length === 0) continue
      filtered.push('')
      continue
    }
    if (
      promptPattern.test(trimmed) &&
      (filtered.length === 0 ||
        promptPattern.test(filtered[filtered.length - 1].trim()))
    ) {
      continue
    }
    filtered.push(line)
  }
  const collapsed = filtered.join('\n').replace(/\n{3,}/g, '\n\n')
  return encoder.encode(collapsed)
}

function writeInput(session: ShellSession, data: Uint8Array) {
  try {
    const sink = session.stdin
    if (!sink) return
    const result = sink.write?.(data)
    if (result instanceof Promise) {
      result.catch(error => {
        console.error('[shell] write failed (async)', error)
      })
    }
  } catch (error) {
    console.error('[shell] write failed', error)
  }
}

function applyResize(session: ShellSession, cols: number, rows: number) {
  session.cols = cols
  session.rows = rows
  const commandText = `stty cols ${cols} rows ${rows}`
  const command = encoder.encode(`${commandText}\r`)
  writeInput(session, command)
  queueSuppression(session.suppressions, commandText)
  queueSuppression(session.suppressions, '\r')
  queueSuppression(session.suppressions, '\n')
}

function spawnShell(
  ws: ServerWebSocket<SessionState>,
  options: { cols?: number; rows?: number; shell?: string },
): ShellSession {
  const cols =
    typeof options.cols === 'number' && options.cols > 0
      ? options.cols
      : DEFAULT_COLS
  const rows =
    typeof options.rows === 'number' && options.rows > 0
      ? options.rows
      : DEFAULT_ROWS

  const shellCommand =
    typeof options.shell === 'string' && options.shell.trim().length > 0
      ? options.shell.trim()
      : DEFAULT_SHELL

  const sessionId = ws.data?.sessionId ?? randomUUID()
  console.info(
    '[shell] starting session',
    JSON.stringify({ sessionId, cols, rows, shell: shellCommand }),
  )

  const cmd = ['script', '-qf', '-c', shellCommand, '/dev/null']

  const subprocess = Bun.spawn({
    cmd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PS1: '\u001b[32m$ \u001b[0m',
      TERM: 'xterm-256color',
      COLUMNS: String(cols),
      LINES: String(rows),
    },
    maxBuffer: 1_000_000, // 1MB
  })

  const suppressionQueue: Array<Suppression> = []
  const pumps: Array<Promise<void>> = []

  const forwardStream = (
    stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  ): Promise<void> => {
    const reader = stream.getReader()
    return (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value?.byteLength) continue
          const filtered = removeResizeEcho(
            stripSuppressed(suppressionQueue, new Uint8Array(value)),
          )
          if (!filtered.length) continue

          if (ws.readyState === WebSocket.OPEN) ws.send(filtered)
          else break
        }
      } catch (error) {
        console.error('[shell] stream failure', error)
      } finally {
        reader.releaseLock()
      }
    })()
  }

  pumps.push(forwardStream(subprocess.stdout))
  pumps.push(forwardStream(subprocess.stderr))

  subprocess.exited
    .then((exitCode: number) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'process-exit',
            exitCode,
          }),
        )
        ws.close(1000, 'process exited')
      }
    })
    .catch((error: unknown) => {
      console.error('[shell] process exited with error', error)
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'process failure')
    })

  const close = () => {
    try {
      subprocess.kill('SIGTERM')
    } catch (error) {
      console.warn('[shell] failed to terminate process', error)
    }

    const sink = subprocess.stdin
    try {
      sink?.end?.()
    } catch (error) {
      console.warn('[shell] failed to close stdin', error)
    }

    Promise.allSettled(pumps).catch(() => {
      /* ignore pump errors on shutdown */
    })
  }

  const session: ShellSession = {
    id: sessionId,
    process: subprocess,
    stdin: subprocess.stdin,
    cols,
    rows,
    suppressions: suppressionQueue,
    close,
  }

  applyResize(session, cols, rows)
  return session
}

function parseControlMessage(raw: string): ControlMessage | undefined {
  try {
    const payload = JSON.parse(raw) as ControlMessage
    if (!payload || typeof payload !== 'object') return undefined
    if (payload.type === 'init') return payload
    if (payload.type === 'resize') return payload
    if (payload.type === 'ping') return payload
  } catch (error) {
    console.warn('[shell] invalid control payload', error)
  }
  return undefined
}

const stopAndExit = () => {
  server.stop()
  process.exit(0)
}

process.on('SIGINT', stopAndExit)
process.on('SIGTERM', stopAndExit)
process.on('SIGQUIT', stopAndExit)

console.log(
  `Sandbox shell WebSocket server listening on ws://${server.hostname}:${server.port}`,
)
