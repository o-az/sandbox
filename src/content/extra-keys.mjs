import { getTerminal } from './script.mjs'
import { KeyboardHandler } from './keyboard.mjs'

const keyboardModifiers = new KeyboardHandler({ terminal: getTerminal() })

const domParser = new DOMParser()

/**
 * @param {HTMLElement} element
 */
export function extraKeyboardKeys(element) {
  const embedMode = window.location.search.includes('embed=true')
  if (embedMode) return

  const footerElement = element.closest('footer#footer')
  if (!footerElement) throw new Error('Footer element not found')
  const lastChild = footerElement.lastChild
  if (!lastChild) throw new Error('Last child not found')

  const toggler = extraKeysToggler()

  const keyboardContainerHTML = /* js */ `
  <div
    data-hidden="true"
    class="keyboard-container"
    data-element="extra-keyboard"
  >
    ${keyboardModifiers
      .modifierKeys()
      .map(
        key =>
          /* js */ `<button
            class="key"
            type="button"
            data-key="${key}"
            data-element="extra-keyboard-key"
          >
          ${keyboardModifiers.getModifierShort(key)}
          </button>
        `,
      )
      .join('')}
  </div>
`
  const contentParsed = domParser.parseFromString(
    keyboardContainerHTML,
    'text/html',
  ).body.firstChild
  if (!contentParsed) throw new Error('Content parsed not found')

  footerElement.insertBefore(contentParsed, lastChild)
  footerElement.insertBefore(toggler, lastChild)

  const keyboardContainer = element.querySelector('div.keyboard-container')
  keyboardContainer?.addEventListener('click', function (event) {
    this.blur()

    if (!event.target || !(event.target instanceof Element)) return
    const button = event.target.closest(
      'button[data-element="extra-keyboard-key"]',
    )
    if (!button) return
    const key = button.dataset.key
    if (!key) return

    if (key === 'Control' || key === 'Shift') {
      // Handle Control and Shift as toggleable modifiers
      const isActive = keyboardModifiers.toggleModifier(key)
      // Update button pressed state
      if (isActive) {
        button.setAttribute('data-pressed', 'true')
        button.classList.add('key-pressed')
        button.blur()
        terminal.focus()
      } else {
        button.removeAttribute('data-pressed')
        button.classList.remove('key-pressed')
        button.blur()
        terminal.focus()
      }
    } else {
      // For other keys, send the key press (which will apply active modifiers)
      keyboardModifiers.sendKeyPress(key)
      // Clear pressed state from Control and Shift buttons after sending
      const pressedButtons = keyboardContainer.querySelectorAll(
        'button[data-pressed="true"]',
      )
      pressedButtons.forEach(btn => {
        btn.removeAttribute('data-pressed')
        btn.classList.remove('key-pressed')
      })
    }
  })

  // Intercept physical keyboard input when modifiers are active
  const terminal = getTerminal()
  const textarea = terminal?.textarea
  if (textarea) {
    textarea.addEventListener('keydown', event => {
      const activeModifiers = keyboardModifiers.getActiveModifiers()
      if (activeModifiers.size > 0 && !event.ctrlKey && !event.shiftKey) {
        // User typed a key while our virtual modifiers are active
        event.preventDefault()
        event.stopPropagation()
        // Send the key through our handler which will apply modifiers
        keyboardModifiers.sendKeyPress(event.key)
        // Clear modifiers after sending
        const pressedButtons = keyboardContainer?.querySelectorAll(
          'button[data-pressed="true"]',
        )
        pressedButtons?.forEach(btn => {
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
    class: 'key-toggler',
    id: 'extra-keys-toggler',
    textContent: 'Extra Keys',
    title: 'Toggle Extra Keys',
  })
  toggler.setAttribute('data-element', 'extra-keys-toggler')

  toggler.addEventListener('click', event => {
    event.preventDefault()
    const keyboardContainer = document.querySelector('div.keyboard-container')
    if (!keyboardContainer) throw new Error('Keyboard container not found')

    const hidden = keyboardContainer.dataset.hidden === 'true'

    Object.assign(keyboardContainer.dataset, { hidden: !hidden })
    Object.assign(toggler, {
      textContent: hidden ? 'Hide Extra Keys' : 'Show Extra Keys',
    })
  })

  return toggler
}
