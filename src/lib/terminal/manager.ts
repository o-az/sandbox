import { FitAddon, Terminal } from 'ghostty-web'

import { TerminalSerializeAdapter } from '#lib/terminal/serialize.ts'

export type TerminalInitOptions = {
  onAltNavigation?: (event: KeyboardEvent) => boolean
  onClearLine?: () => boolean
  onJumpToLineEdge?: (edge: 'start' | 'end') => boolean
  onPaste?: (text: string) => void
}

const DEFAULT_FONT = 'Lilex'

const THEME = {
  background: '#0d1117',
  foreground: '#f0f6fc',
  cursor: '#58a6ff',
  selectionBackground: '#58a6ff33',
  black: '#0d1117',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#f0f6fc',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
}

export class TerminalManager {
  #terminal: Terminal
  #fitAddon: FitAddon
  #serializeAddon: TerminalSerializeAdapter
  #initialized = false

  constructor() {
    this.#terminal = new Terminal({
      fontSize: 17,
      scrollback: 50_000,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'underline',
      fontFamily: `"${DEFAULT_FONT}", monospace`,
      theme: THEME,
    })

    const terminalOptions = this.#terminal.options as {
      tabStopWidth?: number
    }

    if (typeof terminalOptions.tabStopWidth !== 'number') {
      terminalOptions.tabStopWidth = 8
    }

    this.#fitAddon = new FitAddon()
    this.#serializeAddon = new TerminalSerializeAdapter(this.#terminal)

    this.#terminal.onBell(() => console.info('bell'))
  }

  init(
    element: (HTMLDivElement & { xterm?: Terminal }) | null | undefined,
    {
      onAltNavigation,
      onClearLine,
      onJumpToLineEdge,
      onPaste,
    }: TerminalInitOptions = {},
  ) {
    if (this.#initialized) return this.#terminal
    if (!element) throw new Error('Terminal element is required')

    // Load addons BEFORE opening (per ghostty-web demo best practice)
    this.#terminal.loadAddon(this.#fitAddon)

    // Open terminal (WASM already initialized via waitForTerminalRuntime)
    this.#terminal.open(element)

    // Intercept paste events and forward to the PTY with bracketed paste
    if (this.#terminal.textarea && onPaste) {
      this.#terminal.textarea.addEventListener(
        'paste',
        event => {
          const text = event.clipboardData?.getData('text/plain')
          if (text) {
            event.preventDefault()
            event.stopPropagation()
            event.stopImmediatePropagation()
            // Strip any existing bracketed paste markers
            // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequences
            const cleanText = text.replace(/\x1b\[20[01]~/g, '')
            // Store pasted command in history for sharing
            saveCommandToHistory(cleanText)
            // Wrap in bracketed paste sequences for proper multi-line handling
            // \x1b[200~ = start bracketed paste, \x1b[201~ = end bracketed paste
            onPaste(`\x1b[200~${cleanText}\x1b[201~`)
          }
        },
        { capture: true },
      )
    }

    // Expose terminal for debugging in development
    window.xterm = this.#terminal

    // Use FitAddon's built-in observeResize() (per ghostty-web demo)
    this.#fitAddon.fit()
    this.#fitAddon.observeResize()

    // Mobile keyboard fix: iOS/Android require the textarea to have minimum dimensions
    // and not be completely invisible for the virtual keyboard to trigger.
    // ghostty-web sets width:0, height:0, opacity:0 which blocks mobile keyboards.
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    if (isMobile && this.#terminal.textarea) {
      const textarea = this.#terminal.textarea
      textarea.style.width = '1px'
      textarea.style.height = '1px'
      textarea.style.opacity = '0.01'
      textarea.style.fontSize = '16px'
      textarea.setAttribute('inputmode', 'text')
      textarea.setAttribute('enterkeyhint', 'send')

      element.addEventListener('touchend', event => {
        if (event.target instanceof Node && element.contains(event.target)) {
          requestAnimationFrame(() => {
            this.#terminal.focus()
            textarea.focus()
          })
        }
      })
    }

    const usesGhosttySemantics =
      typeof (this.#terminal as unknown as { ghostty?: unknown }).ghostty !==
      'undefined'

    this.#terminal.attachCustomKeyEventHandler(event => {
      // Handle Cmd/Ctrl + R for refresh explicitly
      if (
        event.type === 'keydown' &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'r'
      ) {
        window.location.reload()
        return !!usesGhosttySemantics
      }

      // Allow other browser shortcuts to pass through
      const key = event.key.toLowerCase()
      const isBrowserShortcut =
        (event.metaKey || event.ctrlKey) &&
        (key === 't' || // New tab
          key === 'w' || // Close tab
          key === 'n' || // New window
          key === 'l' || // Focus address bar
          key === 'f' || // Find
          key === '+' || // Zoom in
          key === '-' || // Zoom out
          key === '0') // Reset zoom

      if (isBrowserShortcut) {
        // Let browser handle it - return false for ghostty, true for xterm
        return !usesGhosttySemantics
      }

      let handled = false

      // Alt key combinations - delegate to onAltNavigation first
      if (
        event.altKey &&
        event.type === 'keydown' &&
        typeof onAltNavigation === 'function' &&
        onAltNavigation(event)
      ) {
        handled = true
      } else if (
        // Ctrl/Cmd + Backspace (delete entire line)
        (event.ctrlKey || event.metaKey) &&
        event.key === 'Backspace' &&
        event.type === 'keydown'
      ) {
        if (typeof onClearLine === 'function' && onClearLine()) {
          handled = true
        } else {
          // Fallback: Go to end of line (Ctrl+E), then kill to beginning (Ctrl+U)
          this.#terminal.write('\x05\x15')
          handled = true
        }
      } else if (
        // Ctrl/Cmd + Left Arrow (beginning of line)
        (event.ctrlKey || event.metaKey) &&
        event.key === 'ArrowLeft' &&
        event.type === 'keydown'
      ) {
        if (
          typeof onJumpToLineEdge === 'function' &&
          onJumpToLineEdge('start')
        ) {
          handled = true
        } else {
          this.#terminal.write('\x01') // Ctrl+A (ASCII SOH)
          handled = true
        }
      } else if (
        // Ctrl/Cmd + Right Arrow (end of line)
        (event.ctrlKey || event.metaKey) &&
        event.key === 'ArrowRight' &&
        event.type === 'keydown'
      ) {
        if (typeof onJumpToLineEdge === 'function' && onJumpToLineEdge('end')) {
          handled = true
        } else {
          this.#terminal.write('\x05') // Ctrl+E (ASCII ENQ)
          handled = true
        }
      } else if (
        event.type === 'keydown' &&
        event.key === 'c' &&
        event.ctrlKey &&
        event.metaKey
      ) {
        // Ctrl+Meta+C handling
        handled = true
      }

      return usesGhosttySemantics ? handled : !handled
    })

    this.#initialized = true
    return this.#terminal
  }

  get terminal() {
    if (!this.#initialized) throw new Error('Terminal not initialized')
    return this.#terminal
  }

  get fitAddon() {
    if (!this.#initialized) throw new Error('Terminal not initialized')
    return this.#fitAddon
  }

  get serializeAddon() {
    if (!this.#initialized) throw new Error('Terminal not initialized')
    return this.#serializeAddon
  }

  dispose() {
    if (!this.#initialized) return
    this.#fitAddon.dispose()
    this.#terminal.dispose()
    this.#initialized = false
  }
}

function saveCommandToHistory(command: string) {
  if (typeof localStorage === 'undefined') return
  const trimmed = command.trim()
  if (!trimmed) return

  try {
    const existing = localStorage.getItem('history')
    const parsed: unknown = existing ? JSON.parse(existing) : []
    const history = Array.isArray(parsed) ? (parsed as string[]) : []
    // Add to front, remove duplicates, limit to 50
    const updated = [trimmed, ...history.filter(c => c !== trimmed)].slice(
      0,
      50,
    )
    localStorage.setItem('history', JSON.stringify(updated))
  } catch {
    // Ignore localStorage errors
  }
}
