import {
  For,
  Show,
  onMount,
  onCleanup,
  createMemo,
  createEffect,
  createSignal,
} from 'solid-js'
import type { Terminal } from '@xterm/xterm'
import type { JSX } from 'solid-js/h/jsx-runtime'
import { isMobile } from '@solid-primitives/platform'
import { useKeyDownEvent } from '@solid-primitives/keyboard'
import { createActiveElement } from '@solid-primitives/active-element'
import { createEventDispatcher } from '@solid-primitives/event-dispatcher'

type ModifierKey = (typeof MODIFIER_KEYS)[number]

const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta'] as const
const MODIFIER_META: Record<ModifierKey, { code: string; short: string }> = {
  Control: { code: 'ControlLeft', short: 'ctrl' },
  Shift: { code: 'ShiftLeft', short: 'shift' },
  Alt: { code: 'AltLeft', short: 'alt' },
  Meta: { code: 'MetaLeft', short: 'meta' },
}
const LETTER_REGEX = /^[a-zA-Z]$/
const KEYBOARD_OFFSET =
  'calc(env(safe-area-inset-bottom, 0px) + max(env(keyboard-inset-height, 0px), var(--keyboard-height, 0px)) + 4px)'

function isModifierKey(value: string): value is ModifierKey {
  return (MODIFIER_KEYS as readonly string[]).includes(value)
}

function isLatchModifier(
  value: string,
): value is Extract<ModifierKey, 'Control' | 'Shift'> {
  return value === 'Control' || value === 'Shift'
}

type KeyboardButtonProps = {
  value: ModifierKey
  label: string
  pressed: boolean
  onPress: (value: ModifierKey) => void
}

type TerminalWindow = Window & { xterm?: Terminal }

type ExtraKeyboardProps = {
  onVirtualKey?: (
    event: CustomEvent<{ key: string; modifiers: string[] }>,
  ) => void
}

export function ExtraKeyboard(props: ExtraKeyboardProps) {
  const [isHidden, setIsHidden] = createSignal(true)
  const [hasInteracted, setHasInteracted] = createSignal(false)

  const keydownEvent = useKeyDownEvent()
  const activeElement = createActiveElement()
  const dispatch = createEventDispatcher(props)
  const {
    value: latchedModifiers,
    toggle: toggleModifier,
    clear: clearLatchedModifiers,
    isActive: isModifierActive,
    snapshot: snapshotModifiers,
  } = createLatchedModifiers()
  const { ready, terminal, textarea } = createTerminalBridge()

  const toggleLabel = createMemo(() => {
    if (!hasInteracted()) return 'Extra Keys'
    return isHidden() ? 'Show Extra Keys' : 'Hide Extra Keys'
  })

  let synthesizing = false

  createEffect(() => {
    const event = keydownEvent()
    if (!event || synthesizing) return
    const textareaEl = textarea()
    if (!textareaEl) return
    if (latchedModifiers().size === 0) return
    if (event.ctrlKey) return
    const target = event.target
    if (!(target instanceof HTMLTextAreaElement)) return
    if (target !== textareaEl) return
    event.preventDefault()
    event.stopPropagation()
    sendKeyPress(event.key)
  })

  onCleanup(() => {
    clearLatchedModifiers()
  })

  const handleToggleClick = () => {
    setHasInteracted(true)
    setIsHidden(hidden => !hidden)
  }

  const keyboardLabelFor = (value: ModifierKey) =>
    MODIFIER_META[value]?.short ?? value.toLowerCase()

  const focusTerminalTextarea = () => {
    const active = activeElement()
    if (active instanceof HTMLTextAreaElement) {
      active.focus()
      return
    }
    textarea()?.focus()
  }

  function handleButtonPress(value: ModifierKey) {
    if (isLatchModifier(value)) {
      toggleModifier(value)
      focusTerminalTextarea()
      return
    }
    const modifiersSnapshot = snapshotModifiers()
    sendKeyPress(value)
    dispatch('virtualKey', { key: value, modifiers: modifiersSnapshot })
    focusTerminalTextarea()
  }

  function dispatchSyntheticEvent(callback: () => void) {
    if (synthesizing) {
      callback()
      return
    }
    synthesizing = true
    try {
      callback()
    } finally {
      synthesizing = false
    }
  }

  function sendModifierKey(value: ModifierKey) {
    const meta = MODIFIER_META[value]
    const textareaEl = textarea()
    if (!textareaEl || !meta) return
    dispatchSyntheticEvent(() =>
      textareaEl.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: value,
          code: meta.code,
          bubbles: true,
          cancelable: true,
        }),
      ),
    )
  }

  function trySendControlShortcut(key: string) {
    const textareaEl = textarea()
    if (!textareaEl) return false
    if (key.length !== 1 || !LETTER_REGEX.test(key)) return false
    const upperKey = key.toUpperCase()
    const keyCode = upperKey.charCodeAt(0)
    dispatchSyntheticEvent(() =>
      textareaEl.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: upperKey,
          code: `Key${upperKey}`,
          keyCode,
          which: keyCode,
          ctrlKey: true,
          shiftKey: false,
          altKey: false,
          metaKey: false,
          bubbles: true,
          cancelable: true,
        }),
      ),
    )
    return true
  }

  function trySendShiftInsert(key: string) {
    const textareaEl = textarea()
    if (!textareaEl) return false
    if (key.length !== 1) return false
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', key.toUpperCase())
    dispatchSyntheticEvent(() =>
      textareaEl.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
        }),
      ),
    )
    return true
  }

  function writeToTerminal(value: string) {
    terminal()?.write(value)
  }

  function sendKeyPress(value: string) {
    if (!terminal()) return
    if (isModifierKey(value)) {
      if (isLatchModifier(value)) return
      sendModifierKey(value)
      return
    }

    const modifiers = latchedModifiers()
    const hasControl = modifiers.has('Control')
    const hasShift = modifiers.has('Shift')

    if (hasControl || hasShift) {
      if (hasControl && trySendControlShortcut(value)) {
        clearLatchedModifiers()
        return
      }
      if (hasShift && trySendShiftInsert(value)) {
        clearLatchedModifiers()
        return
      }
      writeToTerminal(value)
      clearLatchedModifiers()
      return
    }

    writeToTerminal(value)
  }

  return (
    <Show when={ready()}>
      <div
        data-hidden={isHidden() ? 'true' : 'false'}
        data-element="extra-keyboard"
        style={{ bottom: KEYBOARD_OFFSET }}
        class="fixed inset-x-0 z-1000 flex justify-center gap-3.5 bg-[#0c0f15] p-2.5 transition-[opacity,transform] duration-300 ease-out"
        classList={{
          'pointer-events-none translate-y-full opacity-0': isHidden(),
        }}>
        <For each={MODIFIER_KEYS}>
          {value => (
            <KeyboardButton
              value={value}
              label={keyboardLabelFor(value)}
              pressed={isModifierActive(value)}
              onPress={handleButtonPress}
            />
          )}
        </For>
      </div>
      <button
        type="button"
        id="extra-keys-toggler"
        class="fixed right-0 z-1001 m-1 rounded border border-white/15 bg-[#0c0f15]/90 px-2 py-1 text-xs uppercase tracking-wide text-white transition hover:text-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#58a6ff]"
        style={{ bottom: KEYBOARD_OFFSET }}
        data-element="extra-keys-toggler"
        onClick={handleToggleClick}>
        {toggleLabel()}
      </button>
    </Show>
  )
}

function createLatchedModifiers() {
  const [value, setValue] = createSignal<Set<ModifierKey>>(new Set())

  const toggle = (modifier: ModifierKey) => {
    if (!isLatchModifier(modifier)) return
    setValue(prev => {
      const next = new Set(prev)
      if (next.has(modifier)) next.delete(modifier)
      else next.add(modifier)
      return next
    })
  }

  const clear = () => setValue(() => new Set<ModifierKey>())
  const isActive = (modifier: ModifierKey) => value().has(modifier)
  const snapshot = () => Array.from(value()) as string[]

  return { value, toggle, clear, isActive, snapshot }
}

function createTerminalBridge() {
  const [ready, setReady] = createSignal(false)
  const [terminal, setTerminal] = createSignal<Terminal>()
  const [textarea, setTextarea] = createSignal<HTMLTextAreaElement>()
  let pollHandle: number | undefined

  const attach = () => {
    const instance = (window as TerminalWindow).xterm
    if (!instance?.textarea) return false
    setTerminal(instance)
    setTextarea(instance.textarea)
    setReady(true)
    return true
  }

  onMount(() => {
    if (typeof window === 'undefined') return
    if (isMobile) return
    if (attach()) return
    pollHandle = window.setInterval(() => {
      if (attach() && typeof pollHandle === 'number') {
        window.clearInterval(pollHandle)
        pollHandle = undefined
      }
    }, 100)
  })

  onCleanup(() => {
    if (typeof pollHandle === 'number') {
      window.clearInterval(pollHandle)
      pollHandle = undefined
    }
  })

  return { ready, terminal, textarea }
}

function KeyboardButton(props: KeyboardButtonProps) {
  const handleClick: JSX.EventHandlerUnion<
    HTMLButtonElement,
    MouseEvent
  > = event => {
    event.preventDefault()
    props.onPress(props.value)
    event.currentTarget?.blur()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-key={props.value}
      data-element="extra-keyboard-key"
      data-pressed={props.pressed ? 'true' : undefined}
      class="flex h-6 items-center justify-center rounded-[2px] bg-[#3a3a3c] px-2 text-xs font-mono text-white transition duration-150 hover:bg-[#48484a] active:scale-95 active:bg-[#2c2c2e]"
      classList={{
        'bg-[#58a6ff] font-semibold text-[#0d1117]': props.pressed,
      }}>
      {props.label}
    </button>
  )
}
