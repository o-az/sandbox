import { Terminal } from '@xterm/xterm'
import { Readline } from 'xterm-readline'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { ImageAddon } from '@xterm/addon-image'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { LigaturesAddon } from '@xterm/addon-ligatures'

export type TerminalInitOptions = {
  onAltNavigation?: (event: KeyboardEvent) => boolean
}

export class TerminalManager {
  #terminal: Terminal
  #fitAddon: FitAddon
  #webglAddon: WebglAddon
  #unicode11Addon: Unicode11Addon
  #serializeAddon: SerializeAddon
  #searchAddon: SearchAddon
  #imageAddon: ImageAddon
  #clipboardAddon: ClipboardAddon
  #ligaturesAddon: LigaturesAddon
  #webLinksAddon: WebLinksAddon
  #xtermReadline: Readline
  #initialized = false

  constructor() {
    this.#terminal = new Terminal({
      fontSize: 17,
      lineHeight: 1.2,
      scrollback: 5000,
      convertEol: true,
      cursorBlink: true,
      allowProposedApi: true,
      scrollOnUserInput: false,
      cursorStyle: 'underline',
      rightClickSelectsWord: true,
      rescaleOverlappingGlyphs: true,
      ignoreBracketedPasteMode: true,
      cursorInactiveStyle: 'underline',
      drawBoldTextInBrightColors: true,
      fontFamily: 'Lilex, monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
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

    this.#fitAddon = new FitAddon()
    this.#webglAddon = new WebglAddon()
    this.#unicode11Addon = new Unicode11Addon()
    this.#serializeAddon = new SerializeAddon()
    this.#searchAddon = new SearchAddon({ highlightLimit: 50 })
    this.#imageAddon = new ImageAddon({ showPlaceholder: true })
    this.#clipboardAddon = new ClipboardAddon()
    this.#ligaturesAddon = new LigaturesAddon()
    this.#webLinksAddon = new WebLinksAddon((event, url) => {
      event.preventDefault()
      window.open(url, '_blank', 'noopener,noreferrer')
    })
    this.#xtermReadline = new Readline()

    this.#webglAddon.onContextLoss(() => this.#webglAddon.dispose())
    this.#terminal.onBell(() => console.info('bell'))
  }

  init(
    element: (HTMLDivElement & { xterm?: Terminal }) | null | undefined,
    { onAltNavigation }: TerminalInitOptions = {},
  ) {
    if (this.#initialized) return this.#terminal
    if (!element) throw new Error('Terminal element is required')

    this.#terminal.open(element)
    // @ts-expect-error
    window.xterm = this.#terminal

    this.#terminal.loadAddon(this.#webglAddon)
    this.#terminal.loadAddon(this.#fitAddon)
    this.#terminal.loadAddon(this.#searchAddon)
    this.#terminal.loadAddon(this.#clipboardAddon)
    this.#terminal.loadAddon(this.#unicode11Addon)
    this.#terminal.unicode.activeVersion = '11'
    this.#terminal.loadAddon(this.#serializeAddon)
    this.#terminal.loadAddon(this.#ligaturesAddon)
    this.#terminal.loadAddon(this.#webLinksAddon)
    this.#terminal.loadAddon(this.#imageAddon)
    this.#terminal.loadAddon(this.#xtermReadline)

    this.#terminal.attachCustomKeyEventHandler(event => {
      console.info('custom key event', event)
      // Ctrl + Left Arrow (beginning of line)
      if (
        event.ctrlKey &&
        event.key === 'ArrowLeft' &&
        event.type === 'keydown'
      ) {
        this.#terminal.write('\x01') // Ctrl+A (ASCII SOH)
        return false // Prevent default xterm.js handling
      }
      // Ctrl + Right Arrow (end of line)
      if (
        event.ctrlKey &&
        event.key === 'ArrowRight' &&
        event.type === 'keydown'
      ) {
        this.#terminal.write('\x05') // Ctrl+E (ASCII ENQ)
        return false // Prevent default xterm.js handling
      }
      return true // Allow other key events to be handled normally
    })

    this.#terminal.attachCustomKeyEventHandler(event => {
      if (typeof onAltNavigation === 'function' && onAltNavigation(event))
        return false

      if (
        event.type === 'keydown' &&
        event.key === 'c' &&
        event.ctrlKey &&
        event.metaKey
      ) {
        return false
      }
      return true
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
      void document.fonts.load('17px Lilex')
    } catch {
      // Ignore font load errors
    }

    this.#fitAddon.fit()
  }
}
