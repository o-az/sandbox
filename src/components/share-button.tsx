import { createSignal } from 'solid-js'

type ShareButtonProps = {
  prefilledCommand?: string | null
  class?: string
}

export function ShareButton(props: ShareButtonProps) {
  const [copied, setCopied] = createSignal(false)

  function getLastCommandFromHistory(): string {
    try {
      const historyJson = localStorage.getItem('history')
      if (!historyJson) return ''
      const history = JSON.parse(historyJson) as Array<string>
      if (!Array.isArray(history) || history.length === 0) return ''
      return history.at(0)?.trim() || ''
    } catch {
      return ''
    }
  }

  function getCommand(): string {
    const lastCommand = getLastCommandFromHistory()
    if (lastCommand) return lastCommand
    return props.prefilledCommand?.trim() || ''
  }

  async function handleClick() {
    const command = getCommand()
    if (!command) return

    const url = new URL(window.location.origin)
    url.searchParams.set('cmd', command)
    url.searchParams.set('embed', 'true')

    try {
      await navigator.clipboard.writeText(url.toString().replaceAll('/?', '?'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  return (
    <button
      type="button"
      title="Share command"
      onClick={handleClick}
      class={`flex items-center bg-[#0c0f15]/90 px-2.5 py-1.5 text-xs uppercase tracking-wide text-white/70 transition hover:border-white/25 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#58a6ff] ${props.class ?? ''}`}>
      {copied() ? <CheckIcon /> : <ShareIcon />}
    </button>
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
