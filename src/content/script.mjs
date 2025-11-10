import { Terminal } from '@xterm/xterm'
import { Readline } from 'xterm-readline'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { LigaturesAddon } from '@xterm/addon-ligatures'

/**
 * @typedef {string} Command
 * @typedef {Set<Command>} CommandSet
 */

const PROMPT = '\u001b[32m$\u001b[0m '
const STREAMING_COMMANDS = new Set(['anvil'])
const INTERACTIVE_COMMANDS = new Set(['chisel'])
const API_ENDPOINT = '/api/exec'
const WS_ENDPOINT = '/api/ws'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const STATUS_STYLE = {
  online: { text: 'Online', color: '#4ade80' },
  interactive: { text: 'Interactive', color: '#38bdf8' },
  error: { text: 'Error', color: '#f87171' },
  offline: { text: 'Offline', color: '#fbbf24' },
}

const terminal = new Terminal({
  fontSize: 17,
  scrollback: 5000,
  convertEol: true,
  cursorBlink: true,
  cursorStyle: 'bar',
  allowProposedApi: true,
  rightClickSelectsWord: true,
  drawBoldTextInBrightColors: true,
  fontFamily:
    "'Lilex', 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
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

const fitAddon = new FitAddon()
const webglAddon = new WebglAddon()
const clipboardAddon = new ClipboardAddon({
  readText: () => navigator.clipboard.readText(),
  writeText: text => navigator.clipboard.writeText(text),
})
const ligaturesAddon = new LigaturesAddon()
const webLinksAddon = new WebLinksAddon((event, url) => {
  event.preventDefault()
  window.open(url, '_blank', 'noopener,noreferrer')
})
const readline = new Readline()

const terminalElement = document.querySelector('div#terminal')
if (!terminalElement) throw new Error('Terminal element not found')

terminal.open(terminalElement)
terminal.loadAddon(webglAddon)
terminal.loadAddon(fitAddon)
terminal.loadAddon(clipboardAddon)
terminal.loadAddon(ligaturesAddon)
terminal.loadAddon(webLinksAddon)
terminal.loadAddon(readline)
terminal.attachCustomKeyEventHandler(
  event =>
    !(
      event.type === 'keydown' &&
      event.key === 'c' &&
      event.ctrlKey &&
      event.metaKey
    ),
)
setTimeout(() => fitAddon.fit(), 25)

const statusText = document.querySelector('p#status-text')

const sessionId =
  localStorage.getItem('sessionId') ||
  `session-${Math.random().toString(36).slice(2, 9)}`
localStorage.setItem('sessionId', sessionId)

// Parse URL parameters for iframe embedding
const urlParams = new URLSearchParams(window.location.search)
const prefilledCommand = urlParams.get('cmd')
const embedMode = urlParams.get('embed') === 'true'

/**
 * @type {WebSocket | undefined}
 */
let interactiveSocket
let interactiveMode = false
let interactiveInitQueued = ''
/**
 * @type {((value: any) => void) | undefined}
 */
let interactiveResolve
/**
 * @type {((arg0: Error) => void) | undefined}
 */
let interactiveReject
let currentStatus = 'offline'
let commandInProgress = false
let awaitingInput = false
let hasPrefilledCommand = false

// Only show banner if no pre-filled command
if (!prefilledCommand) {
  echoBanner()
}
terminal.focus()
setStatus(navigator.onLine ? 'online' : 'offline')

// Apply embed mode styling if enabled or if there's a pre-filled command
if (embedMode || prefilledCommand) {
  const footer = document.querySelector('footer#footer')
  if (footer) footer.style.display = 'none'
}
window.addEventListener('online', () => {
  if (!interactiveMode) setStatus('online')
})
window.addEventListener('offline', () => setStatus('offline'))

readline.setCtrlCHandler(() => {
  if (interactiveMode || commandInProgress) return
  readline.println('^C')
  setStatus('online')
  startInputLoop()
})

terminal.onKey(event => {
  if (!interactiveMode) return
  event.domEvent.preventDefault()
  sendInteractiveKey(event.key, event.domEvent)
})

const interactiveTextarea = /** @type {HTMLTextAreaElement | null} */ (
  terminal.textarea
)
interactiveTextarea?.addEventListener('paste', event => {
  if (!interactiveMode) return
  const text = event.clipboardData?.getData('text')
  if (!text) return
  event.preventDefault()
  sendInteractiveInput(text)
})

startInputLoop()

function startInputLoop() {
  if (interactiveMode || awaitingInput) return
  awaitingInput = true

  readline
    .read(PROMPT)
    .then(async rawCommand => {
      awaitingInput = false
      await processCommand(rawCommand)
      startInputLoop()
    })
    .catch(error => {
      awaitingInput = false
      if (interactiveMode) return
      console.error('readline error', error)
      setStatus('error')
      startInputLoop()
    })

  // Pre-fill command if available and not yet used
  if (!hasPrefilledCommand && prefilledCommand) {
    hasPrefilledCommand = true
    // Use paste to insert the pre-filled command into readline
    setTimeout(() => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/plain', prefilledCommand)
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
      })
      terminal.textarea?.dispatchEvent(pasteEvent)
    }, 50)
  }
}

/** @param {string} rawCommand */
async function processCommand(rawCommand) {
  const trimmed = rawCommand.trim()
  if (!trimmed) {
    setStatus('online')
    return
  }

  if (isLocalCommand(trimmed)) {
    executeLocalCommand(trimmed)
    return
  }

  if (INTERACTIVE_COMMANDS.has(trimmed)) {
    await startInteractiveSession(rawCommand)
    return
  }

  commandInProgress = true
  setStatus('online')

  try {
    await runCommand(rawCommand)
    if (!interactiveMode) setStatus('online')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setStatus('error')
    displayError(message)
  } finally {
    commandInProgress = false
  }
}

/** @param {Command} command */
function runCommand(command) {
  const binary = command.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (STREAMING_COMMANDS.has(binary)) {
    return runStreamingCommand(command)
  }
  return runSimpleCommand(command)
}

/** @param {Command} command */
function isLocalCommand(command) {
  const cmd = command.trim().toLowerCase()
  return cmd === 'clear' || cmd === 'reset'
}

/** @param {Command} command */
function executeLocalCommand(command) {
  const cmd = command.trim().toLowerCase()
  if (cmd === 'clear' || cmd === 'reset') {
    terminal.clear()
    setStatus('online')
  }
}

/** @param {Command} command */
async function runSimpleCommand(command) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, sessionId }),
  })

  const payload = await parseJsonResponse(response)
  renderExecResult(payload)
}

/** @param {Command} command */
async function runStreamingCommand(command) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ command, sessionId }),
  })

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream') || !response.body) {
    const payload = await parseJsonResponse(response)
    renderExecResult(payload)
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    buffer = consumeSseBuffer(buffer, handleStreamEvent)
  }

  const finalChunk = decoder.decode()
  consumeSseBuffer(finalChunk, handleStreamEvent)
}

/** @param {string} buffer
 * @param {((event: any) => void)} callback
 */
function consumeSseBuffer(buffer, callback) {
  let working = buffer
  while (true) {
    const marker = working.indexOf('\n\n')
    if (marker === -1) break
    const chunk = working.slice(0, marker)
    working = working.slice(marker + 2)
    const data = chunk
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    try {
      callback(JSON.parse(data))
    } catch (error) {
      console.warn('Failed to parse SSE event', error)
    }
  }
  return working
}

/** @param {any} event */
function handleStreamEvent(event) {
  const type = typeof event.type === 'string' ? event.type : undefined
  if (!type) return

  if (type === 'stdout' && typeof event.data === 'string') {
    terminal.write(event.data)
    return
  }

  if (type === 'stderr' && typeof event.data === 'string') {
    terminal.write(`\u001b[31m${event.data}\u001b[0m`)
    return
  }

  if (type === 'error') {
    const message =
      typeof event.error === 'string' ? event.error : 'Stream error'
    displayError(message)
    setStatus('error')
    return
  }

  if (type === 'complete') {
    const code = typeof event.exitCode === 'number' ? event.exitCode : 'unknown'
    if (code !== 0) {
      terminal.writeln(`\r\n[process exited with code ${code}]`)
    }
    return
  }

  if (type === 'start') {
    setStatus('online')
  }
}

/** @param {Response} response */
async function parseJsonResponse(response) {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(text || 'Command failed to start')
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error('Malformed JSON response from sandbox')
  }
}

/** @param {any} result */
function renderExecResult(result) {
  if (result.stdout) {
    terminal.write(result.stdout)
    if (!result.stdout.endsWith('\n')) terminal.write('\r\n')
  }
  if (result.stderr) {
    terminal.write(`\u001b[31m${result.stderr}\u001b[0m`)
    if (!result.stderr.endsWith('\n')) terminal.write('\r\n')
  }
  if (!result.success) {
    const message = result.error || 'Command failed'
    displayError(message)
    setStatus('error')
  } else {
    setStatus('online')
  }
  if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
    terminal.writeln(`\r\n[process exited with code ${result.exitCode}]`)
  }
}

/** @param {Command} command */
function startInteractiveSession(command) {
  if (interactiveMode) {
    terminal.writeln(
      '\u001b[33mInteractive session already active. Type `exit` to close it.\u001b[0m',
    )
    setStatus('interactive')
    return Promise.resolve()
  }

  interactiveMode = true
  commandInProgress = true
  interactiveInitQueued = command.endsWith('\n') ? command : `${command}\n`
  setStatus('interactive')
  terminal.writeln('\r\n\u001b[90mOpening interactive shell...\u001b[0m')

  return new Promise((resolve, reject) => {
    interactiveResolve = resolve
    interactiveReject = reject
    openInteractiveSocket()
  })
}

function openInteractiveSocket() {
  const url = websocketUrl()
  const socket = new WebSocket(url)
  socket.binaryType = 'arraybuffer'
  interactiveSocket = socket
  socket.addEventListener('open', () => {
    sendInteractiveJson({
      type: 'init',
      cols: terminal.cols ?? 120,
      rows: terminal.rows ?? 32,
    })
    if (interactiveInitQueued) {
      setTimeout(() => {
        sendInteractiveInput(interactiveInitQueued)
        interactiveInitQueued = ''
      }, 100)
    }
  })
  socket.addEventListener('message', handleInteractiveMessage)
  socket.addEventListener('close', handleInteractiveClose)
  socket.addEventListener('error', handleInteractiveError)
}

/** @param {MessageEvent} event */
function handleInteractiveMessage(event) {
  const { data } = event
  if (typeof data === 'string') {
    try {
      const payload = /** @type {any} */ (JSON.parse(data))
      if (payload?.type === 'pong' || payload?.type === 'ready') return
      if (payload?.type === 'process-exit') {
        const exitCode =
          typeof payload.exitCode === 'number' ? payload.exitCode : 'unknown'
        terminal.writeln(
          `\r\n[interactive session exited with code ${exitCode}]`,
        )
        resetInteractiveState('online')
        return
      }
    } catch {
      terminal.write(data)
    }
    return
  }

  if (data instanceof ArrayBuffer) {
    const text = textDecoder.decode(new Uint8Array(data))
    if (text) terminal.write(text)
    return
  }

  if (data instanceof Uint8Array) {
    const text = textDecoder.decode(data)
    if (text) terminal.write(text)
  }
}

function handleInteractiveClose() {
  resetInteractiveState('online')
}

/** @param {Event} event */
function handleInteractiveError(event) {
  console.error('Interactive socket error', event)
  resetInteractiveState('error')
}

/**
 * @param {string} key
 * @param {KeyboardEvent} domEvent
 */
function sendInteractiveKey(key, domEvent) {
  if (!interactiveSocket || interactiveSocket.readyState !== WebSocket.OPEN)
    return

  if (domEvent.ctrlKey && domEvent.key.toLowerCase() === 'c') {
    sendInteractiveInput('\u0003')
    return
  }

  if (domEvent.altKey && key) {
    sendInteractiveInput(key)
    return
  }

  switch (domEvent.key) {
    case 'Enter':
      sendInteractiveInput('\r')
      return
    case 'Backspace':
      sendInteractiveInput('\u0008')
      return
    case 'Tab':
      sendInteractiveInput('\t')
      return
    case 'ArrowUp':
      sendInteractiveInput('\u001b[A')
      return
    case 'ArrowDown':
      sendInteractiveInput('\u001b[B')
      return
    case 'ArrowLeft':
      sendInteractiveInput('\u001b[D')
      return
    case 'ArrowRight':
      sendInteractiveInput('\u001b[C')
      return
    default:
      break
  }

  if (key.length === 1 && !domEvent.metaKey) {
    sendInteractiveInput(key)
  }
}

/** @param {string} text */
function sendInteractiveInput(text) {
  if (!text) return
  if (!interactiveSocket || interactiveSocket.readyState !== WebSocket.OPEN)
    return
  interactiveSocket.send(textEncoder.encode(text))
}

/** @param {any} payload */
function sendInteractiveJson(payload) {
  if (!interactiveSocket || interactiveSocket.readyState !== WebSocket.OPEN)
    return
  interactiveSocket.send(JSON.stringify(payload))
}

/** @param {keyof typeof STATUS_STYLE} mode */
function resetInteractiveState(mode) {
  if (interactiveSocket && interactiveSocket.readyState === WebSocket.OPEN) {
    interactiveSocket.close()
  }
  interactiveSocket = undefined
  interactiveMode = false
  interactiveInitQueued = ''
  commandInProgress = false
  setStatus(mode)
  if (mode === 'error') {
    interactiveReject?.(new Error('Interactive session ended with error'))
  } else {
    interactiveResolve?.(undefined)
  }
  interactiveResolve = undefined
  interactiveReject = undefined
  startInputLoop()
}

function websocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}${WS_ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`
}

/** @param {string} message */
function displayError(message) {
  terminal.writeln(`\u001b[31m${message}\u001b[0m`)
}

/** @param {keyof typeof STATUS_STYLE} mode */
function setStatus(mode) {
  if (currentStatus === mode) return
  currentStatus = mode
  if (!statusText) return

  const style =
    /** @type {(typeof STATUS_STYLE)[keyof typeof STATUS_STYLE]} */ (
      STATUS_STYLE[mode] ?? STATUS_STYLE.online
    )
  statusText.textContent = style.text
  statusText.style.color = style.color
  statusText.style.fontSize = '12px'
  statusText.style.position = 'absolute'
  statusText.style.bottom = '0'
  statusText.style.right = '0'
  statusText.style.margin = '0 18px 8px 0'
}

function echoBanner() {
  terminal.writeln('Welcome to the Foundry sandbox shell.')
}

window.addEventListener('resize', () => {
  if (!document.hidden) {
    fitAddon.fit()
    if (interactiveMode) {
      sendInteractiveJson({
        type: 'resize',
        cols: terminal.cols,
        rows: terminal.rows,
      })
    }
  }
})
