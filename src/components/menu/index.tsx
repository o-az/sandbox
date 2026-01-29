import { Show, createSignal } from 'solid-js'

import {
  ExtraKeyboard,
  type ExtraKeyboardProps,
} from '#components/menu/extra-keyboard.tsx'
import { ShareButton } from '#components/menu/share-button.tsx'
import { useEmbedDetector } from '#components/embed-detector.tsx'

type MenuProps = {
  prefilledCommand?: string | null
  getTerminalHtml?: (() => string) | null
  onVirtualKey?: ExtraKeyboardProps['onVirtualKey']
}

export function Menu(props: MenuProps) {
  const [showExtraKeys, setShowExtraKeys] = createSignal(false)
  const isEmbedded = useEmbedDetector()

  function toggleExtraKeys() {
    setShowExtraKeys(previous => !previous)
  }

  return (
    <Show when={!isEmbedded()}>
      <nav
        data-element="menu"
        class="fixed right-0 top-1/2 z-1000 flex -translate-y-1/2 flex-col items-center gap-0.5 border border-r-0 border-white/10 bg-[#0c0f15]/95 p-1 backdrop-blur-sm transition-opacity">
        <MenuButton
          title="Share command"
          icon={<ShareIcon />}
          onClick={() => {
            /* ShareButton handles its own click */
          }}>
          <ShareButton
            class="bg-transparent! p-0!"
            prefilledCommand={props.prefilledCommand}
            getTerminalHtml={props.getTerminalHtml}
          />
        </MenuButton>

        <div class="my-0.5 h-px w-full bg-white/10" />

        <MenuButton
          title={showExtraKeys() ? 'Hide extra keys' : 'Show extra keys'}
          icon={<KeyboardIcon />}
          active={showExtraKeys()}
          onClick={toggleExtraKeys}
        />
      </nav>

      <ExtraKeyboard
        visible={showExtraKeys()}
        onVirtualKey={props.onVirtualKey}
      />
    </Show>
  )
}

type MenuButtonProps = {
  title: string
  icon: import('solid-js').JSX.Element
  onClick: () => void
  active?: boolean
  children?: import('solid-js').JSX.Element
}

function MenuButton(props: MenuButtonProps) {
  return (
    <Show
      when={!props.children}
      fallback={
        <div class="flex size-8 items-center justify-center">
          {props.children}
        </div>
      }>
      <button
        type="button"
        title={props.title}
        onClick={props.onClick}
        class="flex size-8 items-center justify-center text-white/60 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#58a6ff]"
        classList={{
          'bg-[#58a6ff]/20 text-[#58a6ff]': props.active,
        }}>
        {props.icon}
      </button>
    </Show>
  )
}

function ShareIcon() {
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
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

function KeyboardIcon() {
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
      <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
      <line x1="6" y1="8" x2="6" y2="8" />
      <line x1="10" y1="8" x2="10" y2="8" />
      <line x1="14" y1="8" x2="14" y2="8" />
      <line x1="18" y1="8" x2="18" y2="8" />
      <line x1="6" y1="12" x2="6" y2="12" />
      <line x1="10" y1="12" x2="10" y2="12" />
      <line x1="14" y1="12" x2="14" y2="12" />
      <line x1="18" y1="12" x2="18" y2="12" />
      <line x1="7" y1="16" x2="17" y2="16" />
    </svg>
  )
}
