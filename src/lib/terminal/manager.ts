import { Readline } from 'xterm-readline'
import { FitAddon, Terminal } from 'ghostty-web'

import { TerminalSerializeAdapter } from '#lib/terminal/serialize.ts'

export type TerminalInitOptions = {
  onAltNavigation?: (event: KeyboardEvent) => boolean
}

export class TerminalManager {
  #terminal: Terminal
  #fitAddon: FitAddon
  #serializeAddon: TerminalSerializeAdapter
  #xtermReadline: Readline
  #initialized = false
  #resizeObserver: ResizeObserver | null = null

  constructor() {
    this.#terminal = new Terminal({
      fontSize: 17,
      scrollback: 5_000,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'underline',
      fontFamily: 'Lilex, monospace',
      theme: {
        background: '#0d1117',
        foreground: '#f0f6fc',
        cursor: '#58a6ff',
        selectionBackground: '#58a6ff33',
        // selectionInactiveBackground: '#58a6ff22',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
    })

    const terminalOptions = this.#terminal.options as {
      tabStopWidth?: number
    }
    if (typeof terminalOptions.tabStopWidth !== 'number') {
      terminalOptions.tabStopWidth = 8
    }

    this.#fitAddon = new FitAddon()
    this.#serializeAddon = new TerminalSerializeAdapter(this.#terminal)
    this.#xtermReadline = new Readline()

    this.#terminal.onBell(() => console.info('bell'))
  }

  init(
    element: (HTMLDivElement & { xterm?: Terminal }) | null | undefined,
    { onAltNavigation }: TerminalInitOptions = {},
  ) {
    if (this.#initialized) return this.#terminal
    if (!element) throw new Error('Terminal element is required')

    this.#terminal.open(element)
    // Expose terminal for debugging in development
    ;(window as Window & { xterm?: Terminal }).xterm = this.#terminal

    // ResizeObserver for container size changes (more reliable than window resize)
    this.#resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to debounce rapid resize events
      requestAnimationFrame(() => this.#fitAddon.fit())
    })
    this.#resizeObserver.observe(element)

    this.#terminal.loadAddon(this.#fitAddon)
    this.#terminal.loadAddon(this.#xtermReadline)

    const usesGhosttySemantics =
      typeof (this.#terminal as unknown as { ghostty?: unknown }).ghostty !==
      'undefined'

    this.#terminal.attachCustomKeyEventHandler(event => {
      let handled = false

      // Ctrl + Left Arrow (beginning of line)
      if (
        event.ctrlKey &&
        event.key === 'ArrowLeft' &&
        event.type === 'keydown'
      ) {
        this.#terminal.write('\x01') // Ctrl+A (ASCII SOH)
        handled = true
      } else if (
        event.ctrlKey &&
        event.key === 'ArrowRight' &&
        event.type === 'keydown'
      ) {
        // Ctrl + Right Arrow (end of line)
        this.#terminal.write('\x05') // Ctrl+E (ASCII ENQ)
        handled = true
      } else if (
        typeof onAltNavigation === 'function' &&
        onAltNavigation(event)
      ) {
        handled = true
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

    void this.#scheduleInitialFit()
    this.#initialized = true
    return this.#terminal
  }

  get terminal() {
    if (!this.#initialized) throw new Error('Terminal not initialized')
    return this.#terminal
  }

  get readline() {
    if (!this.#initialized) throw new Error('Terminal not initialized')
    return this.#xtermReadline
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
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#fitAddon.dispose()
    this.#terminal.dispose()
    this.#initialized = false
  }

  async #scheduleInitialFit() {
    if (typeof document === 'undefined' || !('fonts' in document)) {
      setTimeout(() => this.#fitAddon.fit(), 25)
      return
    }

    try {
      await document.fonts.ready
      await document.fonts.load('17px Lilex')
    } catch {
      // Ignore font load errors
    }

    this.#fitAddon.fit()
  }
}
