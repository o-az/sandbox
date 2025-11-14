import { Terminal } from '@xterm/xterm'
import { uniq } from 'es-toolkit'
/**
 * @typedef {{ key: string, code: string, short: string }} Modifier
 *
 * @typedef {{ [key in
 *               'AltLeft'
 *              | 'AltRight'
 *              | 'MetaLeft'
 *              | 'MetaRight'
 *              | 'ShiftLeft'
 *              | 'ShiftRight'
 *              | 'ControlLeft'
 *              | 'ControlRight'
 *             ]: Modifier }} Modifiers
 *
 * @typedef {keyof Modifiers} ModifierKey
 * @typedef {Array<ModifierKey>} ModifierKeys
 */

export class KeyboardHandler {
  /** @type {Record<ModifierKey, Modifier>} */
  #MODIFIERS = {
    AltLeft: { key: 'Alt', code: 'AltLeft', short: 'alt' },
    AltRight: { key: 'Alt', code: 'AltRight', short: 'alt' },
    MetaLeft: { key: 'Meta', code: 'MetaLeft', short: 'meta' },
    MetaRight: { key: 'Meta', code: 'MetaRight', short: 'meta' },
    ShiftLeft: { key: 'Shift', code: 'ShiftLeft', short: 'shift' },
    ShiftRight: { key: 'Shift', code: 'ShiftRight', short: 'shift' },
    ControlLeft: { key: 'Control', code: 'ControlLeft', short: 'ctrl' },
    ControlRight: { key: 'Control', code: 'ControlRight', short: 'ctrl' },
  }

  /** @type {Set<string>} Active modifier keys (Control, Shift) */
  #activeModifiers = new Set()

  /**
   * @param {object} [parameters]
   * @param {Terminal} parameters.terminal
   */
  constructor(parameters) {
    this.terminal = parameters?.terminal
  }

  get modifiers() {
    return this.#MODIFIERS
  }

  /**
   * @param {string} key
   * @returns {Modifier['short']}
   */
  getModifierShort(key) {
    if (!(key in this.modifiers)) return key

    // @ts-expect-error - key is a valid modifier key
    return /** @type {Modifier['short']} */ (this.modifiers[key].short)
  }

  /**
   * @param {ModifierKey} key
   * @returns {Modifier}
   */
  modifier(key) {
    return this.#MODIFIERS[key]
  }

  /**
   * @returns {Array<string>}
   */
  modifierKeys() {
    const arr = Object.entries(this.#MODIFIERS)
    const keys = arr.map(([_, value]) => value.key)
    return uniq(keys)
  }

  modifierCodes() {
    const uniqueCodes = uniq(
      Object.values(this.#MODIFIERS).map(modifier => modifier.code),
    )
    return /** @type {Array<string>} */ (Array.from(uniqueCodes))
  }

  /**
   * Toggles a modifier key's pressed state (for Control and Shift)
   * @param {string} key
   * @returns {boolean} true if the modifier is now active, false if inactive
   */
  toggleModifier(key) {
    if (key === 'Control' || key === 'Shift') {
      if (this.#activeModifiers.has(key)) {
        this.#activeModifiers.delete(key)
        return false
      } else {
        this.#activeModifiers.add(key)
        return true
      }
    }
    return false
  }

  /**
   * Clears all active modifiers
   */
  clearModifiers() {
    this.#activeModifiers.clear()
  }

  /**
   * Gets the currently active modifiers
   * @returns {Set<string>}
   */
  getActiveModifiers() {
    return new Set(this.#activeModifiers)
  }

  /**
   * Checks if a modifier key is currently active
   * @param {string} key
   * @returns {boolean}
   */
  isModifierActive(key) {
    return this.#activeModifiers.has(key)
  }

  /**
   * Sends the key press to the terminal
   * @param {string} key
   */
  sendKeyPress(key) {
    if (!this.terminal) return

    // For modifier keys, we need to send keyboard events
    // Find the modifier entry for this key
    const modifierEntry = Object.entries(this.#MODIFIERS).find(
      ([_, value]) => value.key === key,
    )

    if (modifierEntry) {
      const [, modifier] = modifierEntry
      // For Control and Shift, toggle the pressed state instead of sending immediately
      if (key === 'Control' || key === 'Shift') {
        console.info('toggleModifier', key)
        // Toggle state is handled by toggleModifier, just update UI
        return
      }
      // For other modifiers (Alt, Meta), send keyboard event
      const textarea = this.terminal.textarea
      if (textarea) {
        const keyEvent = new KeyboardEvent('keydown', {
          key: modifier.key,
          code: modifier.code,
          bubbles: true,
          cancelable: true,
        })
        textarea.dispatchEvent(keyEvent)
      }
    } else {
      // For regular keys, apply active modifiers and then send
      const textarea = this.terminal.textarea
      const hasControl = this.#activeModifiers.has('Control')
      const hasShift = this.#activeModifiers.has('Shift')

      if (textarea && (hasControl || hasShift)) {
        if (hasControl && key.length === 1 && /^[a-zA-Z]$/.test(key)) {
          // Send exact keyboard event that readline expects for Ctrl+key
          // This must match what happens when you physically press Ctrl+C
          const upperKey = key.toUpperCase()
          const keyEvent = new KeyboardEvent('keydown', {
            key: upperKey,
            code: `Key${upperKey}`,
            keyCode: upperKey.charCodeAt(0),
            which: upperKey.charCodeAt(0),
            ctrlKey: true,
            shiftKey: false,
            altKey: false,
            metaKey: false,
            bubbles: true,
            cancelable: true,
          })
          // Dispatch to textarea so readline can process it
          textarea.dispatchEvent(keyEvent)
          this.clearModifiers()
        } else if (hasShift && key.length === 1) {
          // For Shift, send uppercase via paste
          const dataTransfer = new DataTransfer()
          dataTransfer.setData('text/plain', key.toUpperCase())
          textarea.dispatchEvent(
            new ClipboardEvent('paste', {
              clipboardData: dataTransfer,
              bubbles: true,
            }),
          )
          this.clearModifiers()
        } else {
          // Fallback: just write the key
          this.terminal.write(key)
          this.clearModifiers()
        }
      } else {
        // No active modifiers, just write the key
        this.terminal.write(key)
      }
    }
  }
}
