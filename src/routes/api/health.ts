import * as z from 'zod/mini'
import { env } from 'cloudflare:workers'
import { json } from '@tanstack/solid-start'
import { getSandbox } from '@cloudflare/sandbox'
import { createFileRoute } from '@tanstack/solid-router'

import { ensureSandboxSession, getActiveTabCount } from '#lib/server-sandbox.ts'

const HEALTH_TIMEOUT_MS = 5_000

const HealthRequestSchema = z.object({
  sessionId: z.string({ error: 'Missing sessionId' }),
  tabId: z.optional(z.string()),
})

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => new Response('ok', { status: 200 }),
      POST: async ({ request }) => {
        const body = await request.json()
        const payload = HealthRequestSchema.safeParse(body)

        if (!payload.success)
          return json({ error: payload.error.message }, { status: 400 })

        const { sessionId, tabId } = payload.data

        const sandboxId = ensureSandboxSession(sessionId, tabId).sandboxId
        const sandbox = getSandbox(env.Sandbox, sandboxId, {
          // keepAlive: true,
        })

        try {
          await sandbox.exec('true', { timeout: HEALTH_TIMEOUT_MS })
          return json(
            { activeTabs: getActiveTabCount(sessionId) },
            { status: 200 },
          )
        } catch (error) {
          // Handle race condition where session is being created by another request
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('already exists')) {
            // Retry once after a brief delay
            await new Promise(resolve => setTimeout(resolve, 100))
            await sandbox.exec('true', { timeout: HEALTH_TIMEOUT_MS })
            return json(
              { activeTabs: getActiveTabCount(sessionId) },
              { status: 200 },
            )
          }
          console.error('Sandbox warmup failed', error)
          return json({ error: 'Sandbox warmup failed' }, { status: 500 })
        }
      },
    },
  },
})
