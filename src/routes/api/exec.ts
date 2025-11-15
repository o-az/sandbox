import * as z from 'zod/mini'
import { env } from 'cloudflare:workers'
import { json } from '@tanstack/solid-start'
import { getSandbox } from '@cloudflare/sandbox'
import { createFileRoute } from '@tanstack/solid-router'

import { getOrCreateSandboxId } from '#lib/sandbox-session.ts'

const DEFAULT_TIMEOUT_MS = 25_000

const ExecCommandRequestSchema = z.object({
  command: z.string(),
  sessionId: z.string({ error: 'Missing sessionId' }),
})

export const Route = createFileRoute('/api/exec')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json()
        const payload = ExecCommandRequestSchema.safeParse(body)

        if (!payload.success)
          return json({ error: payload.error.message }, { status: 400 })

        const { command, sessionId } = payload.data

        const sandboxId = getOrCreateSandboxId(sessionId)
        const sandbox = getSandbox(env.Sandbox, sandboxId, {
          keepAlive: true,
        })

        const result = await sandbox.exec(command, {
          timeout: DEFAULT_TIMEOUT_MS,
        })
        return json({ ...result, sandboxId }, { status: 200 })
      },
      OPTIONS: () =>
        new Response(null, {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers':
              'Content-Type, Authorization, X-Session-ID, X-Tab-ID',
          },
        }),
    },
  },
})
