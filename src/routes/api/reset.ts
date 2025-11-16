import * as z from 'zod/mini'
import { env } from 'cloudflare:workers'
import { json } from '@tanstack/solid-start'
import { getSandbox } from '@cloudflare/sandbox'
import { createFileRoute } from '@tanstack/solid-router'

import {
  clearSandboxSession,
  ensureSandboxSession,
  readSandboxSession,
  removeActiveTab,
} from '#lib/server-sandbox.ts'

const ResetPayloadSchema = z.object({
  sessionId: z.string({ error: 'Missing sessionId' }),
  tabId: z.optional(z.string()),
})

type ResetPayload = z.infer<typeof ResetPayloadSchema>

export const Route = createFileRoute('/api/reset')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json()
        const payload = ResetPayloadSchema.safeParse(body)

        if (!payload.success)
          return json({ error: payload.error.message }, { status: 400 })

        return handleReset(payload.data)
      },
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const payload = ResetPayloadSchema.safeParse(
          Object.fromEntries(url.searchParams.entries()),
        )

        if (!payload.success)
          return json({ error: payload.error.message }, { status: 400 })

        return handleReset(payload.data)
      },
    },
  },
})

async function handleReset({ sessionId, tabId }: ResetPayload) {
  const existingSession = readSandboxSession(sessionId)
  if (!existingSession) {
    return json({ success: true, message: 'Session already destroyed' })
  }

  // Ensure session is registered so active tabs reflect latest info
  ensureSandboxSession(sessionId, tabId)

  const remainingTabs = removeActiveTab(sessionId, tabId)
  if (remainingTabs > 0) {
    return json(
      {
        message: `Sandbox kept alive (${remainingTabs} tabs remaining)`,
        activeTabs: remainingTabs,
      },
      { status: 200 },
    )
  }

  const sandbox = getSandbox(env.Sandbox, existingSession.sandboxId, {
    // keepAlive: true,
  })

  try {
    await sandbox.destroy()
    clearSandboxSession(sessionId)
    return json(
      { message: 'Sandbox destroyed (last tab closed)' },
      { status: 200 },
    )
  } catch (error) {
    console.error('Failed to destroy sandbox', error)
    return json({ message: 'Failed to destroy sandbox' }, { status: 500 })
  }
}
