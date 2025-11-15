import type {
  ExecutionContext,
  DurableObjectNamespace,
} from '@cloudflare/workers-types'
import handler, { createServerEntry } from '@tanstack/solid-start/server-entry'

export default createServerEntry({
  fetch: handler.fetch,
})

declare module '@tanstack/solid-start' {
  interface Register {
    server: {
      requestContext?: {
        executionContext: ExecutionContext
        env: Cloudflare.Env & { Sandbox: DurableObjectNamespace }
      }
    }
  }
}

export { Sandbox } from '@cloudflare/sandbox'
