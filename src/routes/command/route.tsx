import * as z from 'zod/mini'
import { Terminal } from '@xterm/xterm'
import { SerializeAddon } from '@xterm/addon-serialize'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { createFileRoute, notFound } from '@tanstack/solid-router'

export const Route = createFileRoute('/command')({
  component: RouteComponent,
  validateSearch: z.object({
    cmd: z.string().check(z.minLength(2)),
  }),
  ssr: true,
  loaderDeps: ({ search }) => ({ search }),
  loader: async context => {
    const { cmd } = context.deps.search
    const sessionId = `html-${crypto.randomUUID()}`

    const url = new URL(context.location.url)
    url.pathname = '/api/exec'

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: cmd,
        sessionId,
      }),
    })

    if (!response.ok) throw notFound({ data: response.statusText })

    const json = await response.json()
    const parseResult = ExecResultSchema.safeParse(json)

    if (!parseResult.success) throw notFound({ data: parseResult.error })

    return parseResult.data
  },
})

function RouteComponent() {
  const search = Route.useSearch()

  return <HtmlTerminalOutput command={search().cmd} />
}

const ExecResultSchema = z.object({
  stdout: z.optional(z.string()),
  stderr: z.optional(z.string()),
  error: z.optional(z.string()),
  success: z.optional(z.boolean()),
  exitCode: z.optional(z.number()),
})

function HtmlTerminalOutput(props: { command: string }) {
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [htmlContent, setHtmlContent] = createSignal<string | null>(null)

  const data = Route.useLoaderData()

  let terminal: Terminal
  let containerRef!: HTMLPreElement
  let serializeAddon: SerializeAddon
  let disposed = false

  onMount(async () => {
    // Create a hidden terminal to render the output
    terminal = new Terminal({
      cols: 180,
      rows: 24,
      scrollback: 10000,
      convertEol: true,
      allowProposedApi: true,
      theme: {
        background: 'transparent',
      },
    })

    serializeAddon = new SerializeAddon()
    terminal.loadAddon(serializeAddon)

    // Create hidden container and open terminal
    const hiddenContainer = document.createElement('div')

    Object.assign(hiddenContainer, {
      style: {
        left: '-9999px',
        position: 'absolute',
        visibility: 'hidden',
      },
    })

    document.body.appendChild(hiddenContainer)
    terminal.open(hiddenContainer)

    try {
      const { stderr, stdout, success, error, exitCode } = data()

      if (!success)
        console.error(JSON.stringify({ exitCode, error }, undefined, 2))

      // Show the command first with a prompt
      terminal.writeln(`\x1b[32m$\x1b[0m ${props.command}`)
      terminal.writeln('')

      if (stdout) terminal.write(stdout)
      if (stderr) terminal.write(`\x1b[31m${stderr}\x1b[0m`)
      if (error) terminal.write(`\x1b[31m${error}\x1b[0m`)

      // Give terminal a moment to render
      await new Promise(resolve => setTimeout(resolve, 50))

      if (disposed || !serializeAddon) return

      const rawHtml = serializeAddon.serializeAsHTML({
        includeGlobalBackground: true,
      })
      // Extract just the content inside <pre>...</pre>
      const preMatch = rawHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
      const html = preMatch ? preMatch[1] : rawHtml
      setHtmlContent(html)

      // Cleanup hidden container
      document.body.removeChild(hiddenContainer)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  })

  onCleanup(() => {
    disposed = true
    serializeAddon?.dispose()
    terminal?.dispose()
  })

  return (
    <main class="min-h-screen h-screen overflow-auto p-4">
      <Show when={loading()}>
        <div class="text-white/50">Running command...</div>
      </Show>
      <Show when={error()}>
        <div class="text-red-500">{error()}</div>
      </Show>
      <Show when={htmlContent()}>
        <pre
          ref={containerRef}
          class="font-mono text-sm overflow-x-auto whitespace-pre-wrap break-all"
          innerHTML={htmlContent()!}
        />
      </Show>
    </main>
  )
}
