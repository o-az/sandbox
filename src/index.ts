import { env } from 'cloudflare:workers'
import {
  getSandbox,
  parseSSEStream,
  proxyToSandbox,
  type ExecEvent,
} from '@cloudflare/sandbox'

export { Sandbox } from '@cloudflare/sandbox'

const sessions = new Map<string, string>()
const STREAMABLE_COMMANDS = new Set(['anvil'])
const textEncoder = new TextEncoder()
const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
}
const COMMAND_WS_PORT = Number(env.WS_PORT ?? 8080)
type SandboxInstance = ReturnType<typeof getSandbox>

export default {
  async fetch(request, env, _context) {
    const ip = request.headers.get('cf-connecting-ip')

    if (env.ENVIRONMENT === 'production') {
      const { success } = await env.RATE_LIMITER.limit({ key: ip || '' })
      if (!success) return new Response('Rate limit exceeded', { status: 429 })
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    const url = new URL(request.url)
    const upgrade = request.headers.get('Upgrade')?.toLowerCase()

    if (url.pathname === '/') return env.Web.fetch(request)

    if (
      url.pathname === '/ping' ||
      url.pathname === '/api/ping' ||
      url.pathname === '/health'
    )
      return new Response('ok')

    if (upgrade === 'websocket' && url.pathname === '/api/ws')
      return handleWebSocket(request, env, url)

    // Required for preview URLs (if exposing ports)
    const proxyResponse = await proxyToSandbox(request, env)
    if (proxyResponse) return proxyResponse

    if (url.pathname === '/api/exec') return handleExec(request, env)

    if (url.pathname === '/api/reset') return handleReset(request, env)

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Cloudflare.Env>

async function handleExec(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  let sandbox: SandboxInstance | null = null
  try {
    const { command, sessionId } = await request.json<{
      command: string
      sessionId: string
    }>()

    if (!command || !sessionId) {
      return Response.json(
        { success: false, error: 'Missing command or sessionId' },
        { status: 400 },
      )
    }

    const sandboxId = getOrCreateSandboxId(sessionId)
    sandbox = getSandbox(env.Sandbox, sandboxId)

    if (shouldStreamCommand(command))
      return await streamExecCommand(command, sandbox)

    const result = await sandbox.exec(command, {
      timeout: 25_000, // 25s
    })

    return Response.json(
      {
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  } finally {
    /**
     * TODO: Properly destroy / cleanup sandbox instance
     */
  }
}

async function handleReset(
  request: Request,
  _env: Cloudflare.Env,
): Promise<Response> {
  try {
    const { sessionId } = await request.json<{ sessionId: string }>()

    if (!sessionId) {
      return Response.json(
        { success: false, error: 'Missing sessionId' },
        { status: 400 },
      )
    }

    // Create a new sandbox ID for this session (effectively resetting)
    const newSandboxId = `sandbox-${sessionId}-${Date.now()}`
    sessions.set(sessionId, newSandboxId)

    return Response.json(
      { success: true, message: 'Sandbox reset successfully' },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

function getOrCreateSandboxId(sessionId: string): string {
  const existing = sessions.get(sessionId)
  if (existing) return existing
  const sandboxId = `sandbox-${sessionId}`
  sessions.set(sessionId, sandboxId)
  return sandboxId
}

function shouldStreamCommand(command: string): boolean {
  const firstToken = command.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return STREAMABLE_COMMANDS.has(firstToken)
}

async function streamExecCommand(
  command: string,
  sandbox: SandboxInstance,
): Promise<Response> {
  const stream = await sandbox.execStream(command)
  const sseEvents = parseSSEStream<ExecEvent>(stream)
  const { readable, writable } = new TransformStream<Uint8Array>()
  const writer = writable.getWriter()

  ;(async () => {
    try {
      for await (const event of sseEvents) {
        const payload = JSON.stringify(event)
        await writer.write(textEncoder.encode('data: ' + payload + '\n\n'))
      }
    } catch (error) {
      const serializedError = JSON.stringify(formatStreamError(error))
      await writer.write(
        textEncoder.encode('data: ' + serializedError + '\n\n'),
      )
    } finally {
      await writer.close()
    }
  })().catch(error => {
    console.error('streaming pipeline failed', error)
  })

  return new Response(readable, {
    headers: SSE_HEADERS,
  })
}

function formatStreamError(error: unknown) {
  return {
    type: 'error',
    timestamp: new Date().toISOString(),
    error: error instanceof Error ? error.message : 'Unknown stream error',
  }
}

async function handleWebSocket(
  request: Request,
  env: Cloudflare.Env,
  url: URL,
): Promise<Response> {
  const sessionId =
    url.searchParams.get('sessionId') ||
    request.headers.get('x-sandbox-session-id') ||
    ''

  if (!sessionId) return new Response('Missing sessionId', { status: 400 })

  const sandboxId = getOrCreateSandboxId(sessionId)
  const sandbox = getSandbox(env.Sandbox, sandboxId)

  return sandbox.wsConnect(request, COMMAND_WS_PORT)
}
