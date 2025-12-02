import * as z from 'zod/mini'
import { Terminal } from 'ghostty-web'
import { createFileRoute } from '@tanstack/solid-router'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'

import {
  setAutorunParam,
  CommandSearchSchema,
  normalizeCommandSearch,
  clearEncodedOutputParams,
} from '#lib/url/command-search.ts'
import { waitForTerminalRuntime } from '#lib/terminal/runtime.ts'
import { TerminalSerializeAdapter } from '#lib/terminal/serialize.ts'

export const Route = createFileRoute('/command')({
  component: RouteComponent,
  validateSearch: CommandSearchSchema,
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps: { search } }) => {
    const normalized = normalizeCommandSearch(search)

    if (!normalized.encodedOutput)
      return {
        html: null,
        cmd: normalized.command,
        autorun: normalized.autorun,
      }

    const decodedHtml = await decompressAndDecode(normalized.encodedOutput)
    const cleanedHtml = stripEmptyTerminalRows(decodedHtml)

    return {
      html: trimHtmlLines(cleanedHtml),
      cmd: normalized.command,
      autorun: normalized.autorun,
    }
  },
})

function RouteComponent() {
  const loaderData = Route.useLoaderData()
  const { html, cmd, autorun } = loaderData()

  if (html) return <PreEncodedOutput html={html} />

  return <FreshCommandOutput command={cmd} autorun={!!autorun} />
}

async function decompressAndDecode(encoded: string): Promise<string> {
  // Convert base64url back to base64
  // console.info('encoded', encoded)
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  while (base64.length % 4) base64 += '='

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index)

  const decompressionStream = new DecompressionStream('gzip')
  const writer = decompressionStream.writable.getWriter()
  writer.write(bytes)
  writer.close()

  const decompressed = await new Response(decompressionStream.readable).text()
  return decompressed
}

/** Trim trailing whitespace from each line to prevent excessive horizontal scrolling */
function trimHtmlLines(html: string): string {
  return html
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
}

function stripEmptyTerminalRows(html: string): string {
  // Remove div rows that only contain a single span full of whitespace/nbsp.
  // These come from xterm serialisation padding every frame to the viewport height.
  const emptyRowPattern =
    /<div>\s*<span(?:\s+[^>]*)?>[\s\u00a0]*<\/span>\s*<\/div>/g

  const withoutEmptyRows = html.replace(emptyRowPattern, '')
  const trimmedRows = trimRowTrailingWhitespace(withoutEmptyRows)
  const withoutTrailingPrompt = removeTrailingPromptRow(trimmedRows)
  return insertCommandResultGap(withoutTrailingPrompt)
}

function trimRowTrailingWhitespace(html: string): string {
  const rowRegex = /<div>([\s\S]*?)<\/div>/g

  return html.replace(rowRegex, (fullMatch, rowContent) => {
    if (!rowContent.trimStart().startsWith('<span')) return fullMatch

    const spanRegex = /(<span(?:\s+[^>]*)?>)([\s\S]*?)<\/span>/g
    const spans: Array<{ openTag: string; text: string }> = []
    let match: RegExpExecArray | null

    while ((match = spanRegex.exec(rowContent)) !== null) {
      spans.push({ openTag: match[1], text: match[2] })
    }

    if (!spans.length) return fullMatch

    let index = spans.length - 1
    while (index >= 0) {
      const normalized = spans[index]!.text.replace(/\u00a0/g, ' ')
      if (normalized.trim().length === 0) {
        spans.pop()
        index--
        continue
      }

      spans[index]!.text = spans[index]!.text.replace(/[\s\u00a0]+$/, '')
      break
    }

    if (!spans.length) return ''

    const rebuilt = spans
      .map(span => `${span.openTag}${span.text}</span>`)
      .join('')

    return `<div>${rebuilt}</div>`
  })
}

function removeTrailingPromptRow(html: string): string {
  const rowRegex = /<div>([\s\S]*?)<\/div>/g
  let lastMatch: RegExpExecArray | null = null

  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(html)) !== null) {
    lastMatch = match
  }

  if (!lastMatch) return html

  const textContent = lastMatch[1]
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .trim()

  if (textContent !== '$') return html

  const before = html.slice(0, lastMatch.index)
  const after = html.slice(lastMatch.index + lastMatch[0].length)
  return before + after
}

function insertCommandResultGap(html: string): string {
  const rowRegex = /<div>([\s\S]*?)<\/div>/g
  const rows = Array.from(html.matchAll(rowRegex))

  if (rows.length < 2) return html

  const extractText = (content: string) =>
    content.replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ')

  let commandEndIndex = -1
  for (let index = 0; index < rows.length; index++) {
    const text = extractText(rows[index]![1]).trimEnd()
    if (!text) continue
    commandEndIndex = index
    if (!text.endsWith('\\')) break
  }

  if (commandEndIndex === -1 || commandEndIndex === rows.length - 1) return html

  const nextRowText = extractText(rows[commandEndIndex + 1]![1]).trim()
  if (!nextRowText) return html

  const insertionIndex =
    (rows[commandEndIndex]!.index ?? 0) + rows[commandEndIndex]![0].length
  const spacerRow = '<div><span> </span></div>'

  return html.slice(0, insertionIndex) + spacerRow + html.slice(insertionIndex)
}

function PreEncodedOutput(props: { html: string }) {
  const [showRerun, setShowRerun] = createSignal(false)

  // Extract just the content inside <pre>...</pre>
  const preMatch = props.html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
  const htmlContent = preMatch ? preMatch[1] : props.html

  onMount(() => {
    setShowRerun(true)
  })

  function handleRerun() {
    // Navigate to same command without the encoded output
    const url = new URL(window.location.href)
    clearEncodedOutputParams(url)
    setAutorunParam(url, true)
    window.location.href = url.toString()
  }

  return (
    <main
      class="min-h-screen h-screen overflow-auto bg-[#0d1117] p-4"
      data-element="command-output">
      <pre
        class="block w-full max-w-none font-mono text-sm text-[#f0f6fc] tabular-nums whitespace-pre-wrap break-words"
        innerHTML={htmlContent}
      />
      <Show when={showRerun()}>
        <div class="fixed bottom-4 right-4">
          <button
            type="button"
            aria-label="Re-run command"
            onClick={handleRerun}
            class="inline-flex items-center justify-center rounded-md border border-[#1c6a31] bg-[#07160c] p-3 text-[#3cd878] shadow-[0_0_1px_rgba(60,216,120,0.2)] transition-colors hover:bg-[#0a1f12] hover:text-[#54f08f] hover:border-[#33c056]">
            <RerunIcon />
          </button>
        </div>
      </Show>
    </main>
  )
}

const ExecResultSchema = z.object({
  stdout: z.optional(z.string()),
  stderr: z.optional(z.string()),
  error: z.optional(z.string()),
  success: z.optional(z.boolean()),
  exitCode: z.optional(z.number()),
})

function FreshCommandOutput(props: { command: string; autorun: boolean }) {
  if (!props.autorun) {
    function handleEnableAutorun() {
      const url = new URL(window.location.href)
      setAutorunParam(url, true)
      window.location.href = url.toString()
    }

    return (
      <main class="min-h-screen h-screen overflow-auto bg-[#0d1117] p-4">
        <pre class="font-mono text-sm text-white mb-4">
          <span class="bg-[#3fb950]">$</span> {props.command}
        </pre>
        <div class="fixed bottom-4 right-4">
          <button
            type="button"
            aria-label="Run command"
            onClick={handleEnableAutorun}
            class="inline-flex items-center justify-center rounded-md border border-[#1c6a31] bg-[#07160c] p-3 text-[#3cd878] shadow-[0_0_1px_rgba(60,216,120,0.2)] transition-colors hover:bg-[#0a1f12] hover:text-[#54f08f] hover:border-[#33c056]">
            <RerunIcon />
          </button>
        </div>
      </main>
    )
  }

  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [htmlContent, setHtmlContent] = createSignal<string | null>(null)

  let disposed = false
  let terminal: Terminal
  let serializer: TerminalSerializeAdapter | undefined
  onMount(async () => {
    try {
      await waitForTerminalRuntime()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Failed to initialize terminal runtime',
      )
      setLoading(false)
      return
    }

    terminal = new Terminal({
      cols: 120,
      rows: 24,
      convertEol: true,
      scrollback: 10_000,
      theme: {
        background: '#0d1117',
        foreground: '#f0f6fc',
      },
    })

    serializer = new TerminalSerializeAdapter(terminal)

    const hiddenContainer = document.createElement('div')
    Object.assign(hiddenContainer, {
      style: {
        left: '-9999px',
        position: 'absolute',
        visibility: 'hidden',
        width: '100%',
        height: '100%',
        maxWidth: 'fit-content',
      },
    })
    document.body.appendChild(hiddenContainer)
    terminal.open(hiddenContainer)

    try {
      const sessionId = 'html-command-shared'

      const response = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: props.command, sessionId }),
      })

      if (!response.ok)
        throw new Error((await response.text()) || 'Command failed')

      const json = await response.json()
      const result = ExecResultSchema.parse(json)

      terminal.writeln(`\x1b[32m$\x1b[0m ${props.command}`)
      terminal.writeln('')

      if (result.stdout) {
        terminal.write(result.stdout)
        if (!result.stdout.endsWith('\n')) terminal.writeln('')
      }
      if (result.stdout && result.stderr) terminal.writeln('')
      if (result.stderr) terminal.write(`\x1b[31m${result.stderr}\x1b[0m`)
      if (result.error)
        terminal.write(`\x1b[31m${result.error}\x1b[0m`, () => {
          console.error('error', result.error)
        })

      await new Promise(resolve => setTimeout(resolve, 50))

      if (disposed || !serializer) return

      const rawHtml = serializer.serializeAsHTML({
        includeGlobalBackground: true,
      })
      const preMatch = rawHtml.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)
      const html = preMatch ? preMatch[1] : rawHtml
      setHtmlContent(trimHtmlLines(html))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (document.body.contains(hiddenContainer))
        document.body.removeChild(hiddenContainer)
      setLoading(false)
    }
  })

  onCleanup(() => {
    disposed = true
    terminal?.dispose()
  })

  return (
    <main class="min-h-screen h-screen overflow-auto bg-[#0d1117] p-4">
      <Show when={!props.autorun}>
        <pre class="font-mono text-sm text-white mb-4">
          <span style="color:#3fb950">$</span> {props.command}
        </pre>
      </Show>
      <Show when={loading()}>
        <div class="text-white/50">Running command...</div>
      </Show>
      <Show when={error()}>
        <div class="text-red-500">{error()}</div>
      </Show>
      <Show when={htmlContent()}>
        <pre
          class="block w-full max-w-none font-mono text-sm text-[#f0f6fc] tabular-nums whitespace-pre-wrap break-words"
          innerHTML={htmlContent()!}
        />
      </Show>
    </main>
  )
}

function RerunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  )
}
