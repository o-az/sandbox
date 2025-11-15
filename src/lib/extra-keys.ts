import type { Terminal } from '@xterm/xterm'

import { KeyboardHandler } from '#lib/keyboard-handler.ts'

export function extraKeyboardKeys(
  element: HTMLElement | null,
  {
    terminal,
    virtualInput,
    enable = true,
  }: {
    terminal: Terminal
    virtualInput: (payload: {
      key: string
      ctrl?: boolean
      shift?: boolean
    }) => void
    enable?: boolean
  },
) {
  if (!element || !enable) return
  const embedMode = window.location.search.includes('embed')
  if (embedMode) return

  const keyboardModifiers = new KeyboardHandler({ terminal, virtualInput })
  const footerElement = element.closest('footer#footer')
  if (!footerElement) throw new Error('Footer element not found')

  const toggler = extraKeysToggler()
  const keyboardContainerHTML = `
    <div data-hidden="true" class="keyboard-container" data-element="extra-keyboard">
      ${keyboardModifiers
        .modifierKeys()
        .map(
          key => `
            <button class="key" type="button" data-key="${key}" data-element="extra-keyboard-key">
              ${keyboardModifiers.getModifierShort(key)}
            </button>
          `,
        )
        .join('')}
    </div>
  `

  const contentParsed = new DOMParser().parseFromString(
    keyboardContainerHTML,
    'text/html',
  ).body.firstChild
  if (!contentParsed) throw new Error('Content parsed not found')

  const lastChild = footerElement.lastChild
  footerElement.insertBefore(contentParsed, lastChild)
  footerElement.insertBefore(toggler, lastChild)

  const keyboardContainer = footerElement.querySelector<HTMLDivElement>(
    'div.keyboard-container',
  )
  keyboardContainer?.addEventListener('click', function handleClick(event) {
    this.blur()
    if (!event.target || !(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>(
      'button[data-element="extra-keyboard-key"]',
    )
    if (!button) return
    const key = button.dataset.key
    if (!key) return

    if (key === 'Control' || key === 'Shift') {
      const isActive = keyboardModifiers.toggleModifier(key)
      if (isActive) {
        button.setAttribute('data-pressed', 'true')
        button.classList.add('key-pressed')
      } else {
        button.removeAttribute('data-pressed')
        button.classList.remove('key-pressed')
      }
      button.blur()
      terminal.focus()
      return
    }

    keyboardModifiers.sendKeyPress(key)
    const pressedButtons =
      keyboardContainer?.querySelectorAll('[data-pressed="true"]') ?? []
    pressedButtons.forEach(btn => {
      btn.removeAttribute('data-pressed')
      btn.classList.remove('key-pressed')
    })
  })

  const textarea = terminal?.textarea
  if (textarea) {
    textarea.addEventListener('keydown', event => {
      if (keyboardModifiers.isSynthesizing()) return
      const activeModifiers = keyboardModifiers.getActiveModifiers()
      if (activeModifiers.size > 0 && !event.ctrlKey) {
        event.preventDefault()
        event.stopPropagation()
        keyboardModifiers.sendKeyPress(event.key)
        const pressedButtons =
          keyboardContainer?.querySelectorAll('[data-pressed="true"]') ?? []
        pressedButtons.forEach(btn => {
          btn.removeAttribute('data-pressed')
          btn.classList.remove('key-pressed')
        })
      }
    })
  }
}

function extraKeysToggler() {
  const toggler = document.createElement('button')
  Object.assign(toggler, {
    type: 'button',
    className: 'key-toggler',
    id: 'extra-keys-toggler',
    textContent: 'Extra Keys',
    title: 'Toggle Extra Keys',
  })
  toggler.dataset.element = 'extra-keys-toggler'

  toggler.addEventListener('click', event => {
    event.preventDefault()
    const keyboardContainer = document.querySelector<HTMLDivElement>(
      'div.keyboard-container',
    )
    if (!keyboardContainer) throw new Error('Keyboard container not found')
    const hidden = keyboardContainer.dataset.hidden === 'true'
    keyboardContainer.dataset.hidden = hidden ? 'false' : 'true'
    toggler.textContent = hidden ? 'Hide Extra Keys' : 'Show Extra Keys'
  })

  return toggler
}
