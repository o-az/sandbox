import { env } from 'cloudflare:workers'
import { streamSSE } from 'hono/streaming'
import { getSandbox } from '@cloudflare/sandbox'

export { Sandbox } from '@cloudflare/sandbox'

import { app } from '#setup.ts'

const sessions = new Map<string, string>()
const COMMAND_WS_PORT = Number(env.WS_PORT || 80_80)

app.get('/ping', context => context.text('ok'))
app.get('/health', context => context.text('ok'))
app.get('/api/ping', context => context.text('ok'))

app.get('/', context => context.env.Web.fetch(context.req.raw))

app.get('/.well-known', context =>
  context.redirect('https://h0n0.evm.workers.dev/cat'),
)

app.post('/api/exec', async context => {
  const { command, sessionId } = await context.req.json<{
    command: string
    sessionId: string
  }>()

  const sandboxId = getOrCreateSandboxId(sessionId)
  const sandbox = getSandbox(context.env.Sandbox, sandboxId)

  const result = await sandbox.exec(command, {
    timeout: 25_000, // 25s
  })

  return context.json(result)
})

app.on(['GET', 'POST'], '/api/reset', async context => {
  const { sessionId } =
    context.req.method === 'GET'
      ? context.req.query()
      : await context.req.json<{ sessionId: string }>()

  const sandbox = getSandbox(
    context.env.Sandbox,
    getOrCreateSandboxId(sessionId),
  )
  const result = await sandbox.deleteSession(sessionId)
  const success = result.success && sessions.delete(sessionId)

  return context.json({
    success,
    message: success ? 'Sandbox reset successfully' : 'Failed to reset sandbox',
  })
})

app.get('/api/ws', context => {
  const sessionId =
    context.req.query('sessionId') || context.req.header('x-sandbox-session-id')

  if (!sessionId)
    return context.json({ error: 'Missing sessionId' }, { status: 400 })

  const sandboxId = getOrCreateSandboxId(sessionId)
  const sandbox = getSandbox(context.env.Sandbox, sandboxId)
  return sandbox.wsConnect(context.req.raw, COMMAND_WS_PORT)
})

app.use('/sse/*', async (context, next) => {
  context.header('Content-Type', 'text/event-stream')
  context.header('Cache-Control', 'no-cache')
  context.header('Connection', 'keep-alive')

  await next()
})

app.get('/sse', async context => {
  return streamSSE(context, async stream => {
    while (true) {
      await stream.writeSSE({ data: 'ping', event: 'message' })
      await stream.sleep(500)
    }
  })
})

export default {
  async fetch(request, env, context) {
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

    return app.fetch(request, env, context)
  },
} satisfies ExportedHandler<Cloudflare.Env>

function getOrCreateSandboxId(sessionId: string): string {
  const existing = sessions.get(sessionId)
  if (existing) return existing
  const sandboxId = `sandbox-${sessionId}`
  sessions.set(sessionId, sandboxId)
  return sandboxId
}
