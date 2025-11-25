import { createSignal, onMount } from 'solid-js'

export function useEmbedDetector() {
  const [isEmbedded, setIsEmbedded] = createSignal(false)

  onMount(() => {
    if (typeof window === 'undefined') return

    const insideIFrame = window.self !== window.top
    const hasEmbedParam =
      new URL(window.location.href).searchParams.get('embed') === 'true'

    setIsEmbedded(insideIFrame || hasEmbedParam)
  })

  return isEmbedded
}
