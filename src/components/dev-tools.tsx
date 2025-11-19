import { createSignal, Show } from 'solid-js'
import { createShortcut } from '@solid-primitives/keyboard'
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools'

export function DevTools() {
  const [showDevTools, setShowDevTools] = createSignal(import.meta.env.DEV)

  createShortcut(['Control', '1'], _ => {
    setShowDevTools(!showDevTools())
  })

  if (!import.meta.env.DEV) return <></>

  return (
    <Show when={showDevTools()}>
      <TanStackRouterDevtools
        position="bottom-left"
        data-devtool-name="tanstack-router-devtools"
      />
    </Show>
  )
}
