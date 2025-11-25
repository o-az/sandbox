import * as z from 'zod/mini'
import { env } from 'cloudflare:workers'
import { json } from '@tanstack/solid-start'
import { createFileRoute } from '@tanstack/solid-router'
import { getSandbox, type ExecResult } from '@cloudflare/sandbox'

import { ensureSandboxSession } from '#lib/server-sandbox.ts'

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

        const sandboxId = ensureSandboxSession(sessionId).sandboxId
        const sandbox = getSandbox(env.Sandbox, sandboxId)

        try {
          const result = await sandbox.exec(command, {
            timeout: DEFAULT_TIMEOUT_MS,
          })
          return json({ ...result, sandboxId }, { status: 200 })
        } catch (error) {
          // Handle race condition where session is being created by another request
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('already exists')) {
            // Retry once after a brief delay
            await new Promise(resolve => setTimeout(resolve, 100))
            const result = await sandbox.exec(command, {
              timeout: DEFAULT_TIMEOUT_MS,
            })
            return json({ ...result, sandboxId }, { status: 200 })
          }
          throw error
        }
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

const _fakeResult = (): ExecResult => ({
  success: true,
  exitCode: 0,
  stdout:
    ' _____\n< moo >\n -----\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||',
  stderr: '',
  command: "npx cowsay 'moo'",
  duration: 729,
  timestamp: '1989-01-01T00:00:00.000Z',
  sessionId: 'session-01010101-0202-0303-0404-050505050505',
})
