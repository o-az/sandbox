import { writeClipboard } from '@solid-primitives/clipboard'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'

import {
  applyCommandParams,
  type CommandUrlParams,
} from '#lib/url/command-search.ts'
import { useEmbedDetector } from '#components/embed-detector.tsx'

type ShareButtonProps = {
  class?: string
  prefilledCommand?: string | null
  getTerminalHtml?: (() => string) | null
}

async function compressAndEncode(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)

  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(data)
  writer.close()

  const compressedArrayBuffer = await new Response(cs.readable).arrayBuffer()
  const compressedBytes = new Uint8Array(compressedArrayBuffer)

  // Convert to base64url (URL-safe base64)
  let binary = ''
  for (const byte of compressedBytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
    .trim()
}

export function ShareButton(props: ShareButtonProps) {
  const [copied, setCopied] = createSignal(false)
  const [hasCommand, setHasCommand] = createSignal(false)
  const embed = useEmbedDetector()

  function getLastCommandFromHistory() {
    try {
      const historyJson = localStorage.getItem('history')

      if (!historyJson) return ''
      const history: unknown = JSON.parse(historyJson)
      if (!Array.isArray(history) || history.length === 0) return ''
      const firstItem = history.at(0)

      if (typeof firstItem !== 'string') return ''
      return firstItem.trim()
    } catch {
      return ''
    }
  }

  function getCommand() {
    const lastCommand = getLastCommandFromHistory()
    if (lastCommand) return lastCommand
    return props.prefilledCommand?.trim() || ''
  }

  function updateHasCommand() {
    setHasCommand(!!getCommand())
  }

  updateHasCommand()

  onMount(() => {
    const intervalId = setInterval(updateHasCommand, 500)
    onCleanup(() => clearInterval(intervalId))
  })

  async function handleClick() {
    updateHasCommand()
    const command = getCommand()
    if (!command) return

    const url = new URL(window.location.origin + '/command')
    const commandParams: CommandUrlParams = { command }

    // If we have terminal HTML, compress and encode it
    if (props.getTerminalHtml?.()) {
      try {
        const html = props.getTerminalHtml()
        const encoded = await compressAndEncode(html)
        // Only include if under ~8KB to avoid URL length issues (browsers support ~8KB)
        if (encoded.length < 8_000) {
          commandParams.encodedOutput = encoded
          commandParams.includeHtmlSnapshot = true
        } else
          console.info(
            `Output too large to embed (${encoded.length} chars), will run fresh`,
          )
      } catch (error) {
        console.warn('Failed to encode terminal output:', error)
      }
    }

    applyCommandParams(url, commandParams)
    console.info('url', url.toString())

    try {
      await writeClipboard(url.toString().replace('/?', '?'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    } catch {
      // Clipboard write failed, do nothing
    }
  }

  return (
    <Show when={!embed()}>
      <button
        type="button"
        title={hasCommand() ? 'Share command' : 'No command to share'}
        disabled={!hasCommand()}
        onClick={handleClick}
        class={`flex items-center bg-[#0c0f15]/90 px-2.5 py-1.5 text-xs uppercase tracking-wide transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#58a6ff] ${props.class ?? ''}`}
        classList={{
          'text-white/70 hover:border-white/25 hover:text-white cursor-pointer':
            hasCommand(),
          'text-white/20 cursor-not-allowed': !hasCommand(),
        }}>
        {copied() ? <CheckIcon /> : <ShareIcon />}
      </button>
    </Show>
  )
}

function ShareIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
