import {
  type HighlighterCore,
  createHighlighterCore,
  type ThemeRegistration,
} from 'shiki/core'
import { createFileRoute } from '@tanstack/solid-router'
import { writeClipboard } from '@solid-primitives/clipboard'
import { createSignal, Match, onMount, Switch } from 'solid-js'
import { transformerNotationFocus } from '@shikijs/transformers'
import { createOnigurumaEngine, loadWasm } from 'shiki/engine/oniguruma'

import { theme } from './-data/theme.ts'
import { htmlCodeSnippet } from './-data/snippets.ts'

const ONIG_WASM_CDN = 'https://esm.sh/shiki/onig.wasm'

let cachedHighlighter: HighlighterCore | null = null

async function getHighlighter(): Promise<HighlighterCore> {
  if (cachedHighlighter) return cachedHighlighter

  await loadWasm(fetch(ONIG_WASM_CDN))

  cachedHighlighter = await createHighlighterCore({
    themes: [import('@shikijs/themes/houston')],
    langs: [import('@shikijs/langs/tsx'), import('@shikijs/langs/html')],
    engine: createOnigurumaEngine(() => fetch(ONIG_WASM_CDN)),
  })

  return cachedHighlighter
}

async function highlightCode(): Promise<string> {
  const highlighter = await getHighlighter()

  return highlighter.codeToHtml(htmlCodeSnippet.trimStart(), {
    lang: 'html',
    transformers: [transformerNotationFocus()],
    theme: theme as ThemeRegistration,
  })
}

export const Route = createFileRoute('/docs')({
  component: RouteComponent,
})

function RouteComponent() {
  const [codeElement, setCodeElement] = createSignal<
    (HTMLElement & { setHTMLUnsafe?: (value: string) => void }) | undefined
  >()

  const copySnippet = async () => {
    const text = codeElement()?.textContent?.trim() ?? htmlCodeSnippet.trim()
    await writeClipboard(text)
  }

  onMount(async () => {
    try {
      const html = await highlightCode()
      codeElement()?.setHTMLUnsafe?.(html)
    } catch (error) {
      console.error('Failed to highlight code:', error)
      // Fallback to plain text
      const element = codeElement()
      if (element) {
        element.textContent = htmlCodeSnippet.trim()
        element.style.whiteSpace = 'pre'
        element.style.fontFamily = 'monospace'
      }
    }
  })

  return (
    <main class="flex min-h-dvh flex-col items-center overflow-y-auto border-y-[1.5px] border-y-green-400 pb-6">
      <div class="mt-20 flex w-full max-w-[720px] flex-col items-center gap-y-4">
        <h1 class="md:text-4xl text-2xl font-black text-center mt-12">
          Sandbox Embed Guide
        </h1>
        <h2>
          <a
            href="https://sandbox.val.run"
            target="_blank"
            rel="noopener noreferrer"
            class="text-blue-400 font-semibold uppercase font-mono">
            live demo
          </a>{' '}
          🌐
        </h2>
        <div class="relative bg-[#171F2B] w-full sm:max-w-[620px] max-w-full rounded-sm">
          <CopyButton onCopy={copySnippet} />
          <article
            ref={setCodeElement}
            data-element="iframe-code-block"
            class="text-sm w-full rounded-sm"
          />
        </div>
      </div>
    </main>
  )
}

function CopyButton(props: { onCopy: () => Promise<void> }) {
  const [isCopied, setIsCopied] = createSignal(false)

  const handleCopy = async () => {
    await props.onCopy()
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      type="button"
      class="absolute top-2 right-2 p-1.5 rounded-md hover:bg-white/10 transition-colors duration-200">
      <Switch>
        <Match when={!isCopied()}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="size-4 text-zinc-400 hover:text-zinc-200"
            viewBox="0 0 24 24">
            <title>Copy to Clipboard</title>
            <g
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </g>
          </svg>
        </Match>
        <Match when={isCopied()}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="size-4 text-green-400"
            viewBox="0 0 24 24">
            <title>Copied!</title>
            <path
              fill="currentColor"
              d="M9 16.17L4.83 12l-1.42 1.41L9 19L21 7l-1.41-1.41z"
            />
          </svg>
        </Match>
      </Switch>
    </button>
  )
}
