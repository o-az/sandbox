import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { LigaturesAddon } from '@xterm/addon-ligatures'

/**
 * @typedef {string} Command
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

const terminalElement = document.querySelector('div#terminal')
if (!terminalElement) throw new Error('Terminal element not found')

terminal.open(terminalElement)
terminal.loadAddon(webglAddon)
terminal.loadAddon(fitAddon)
terminal.loadAddon(clipboardAddon)
terminal.loadAddon(ligaturesAddon)
terminal.loadAddon(webLinksAddon)
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

/** @type {{ input: string, history: string[], historyIndex: number, executing: boolean }} */
const state = {
  input: '',
  history: [],
  historyIndex: 0,
  executing: false,
}

/** @type {WebSocket | undefined} */
let interactiveSocket
let interactiveMode = false
let interactiveInitQueued = ''
let currentStatus = 'offline'

echoBanner()
showPrompt(false)
terminal.focus()
setStatus(navigator.onLine ? 'online' : 'offline')
window.addEventListener('online', () => {
  if (!interactiveMode) setStatus('online')
})
window.addEventListener('offline', () => setStatus('offline'))

terminal.onKey(({ key, domEvent }) => {
  if (interactiveMode) {
    domEvent.preventDefault()
    sendInteractiveKey(key, domEvent)
    return
  }

  if (domEvent.ctrlKey && domEvent.key.toLowerCase() === 'c') {
    domEvent.preventDefault()
    if (state.executing) {
      terminal.write('^C\r\n')
      setStatus('online')
    } else if (state.input.length) {
      terminal.write('^C')
    }
    state.executing = false
    showPrompt(true)
    return
  }

  if (state.executing) {
    domEvent.preventDefault()
    return
  }

  switch (domEvent.key) {
    case 'Enter':
      domEvent.preventDefault()
      handleEnter()
      return
    case 'Backspace':
      domEvent.preventDefault()
      if (!state.input.length) return
      state.input = state.input.slice(0, -1)
      terminal.write('\b \b')
      return
    case 'ArrowUp':
      domEvent.preventDefault()
      if (!state.history.length || state.historyIndex === 0) return
      state.historyIndex -= 1
      setInputLine(state.history[state.historyIndex])
      return
    case 'ArrowDown':
      domEvent.preventDefault()
      if (state.historyIndex >= state.history.length - 1) {
        state.historyIndex = state.history.length
        setInputLine('')
      } else {
        state.historyIndex += 1
        setInputLine(state.history[state.historyIndex])
      }
      return
    case 'Tab':
      domEvent.preventDefault()
      return
    default:
      break
  }

  if (
    key.length === 1 &&
    !domEvent.metaKey &&
    !domEvent.altKey &&
    !domEvent.ctrlKey
  ) {
    appendInput(key)
  }
})

attachPasteListener()

function handleEnter() {
  const rawCommand = state.input
  const trimmed = rawCommand.trim()
  terminal.write('\r\n')

  if (!trimmed) {
    showPrompt(true)
    return
  }

  state.history.push(rawCommand)
  state.historyIndex = state.history.length
  state.input = ''

  if (isLocalCommand(trimmed)) {
    executeLocalCommand(trimmed)
    return
  }

  if (isInteractiveCommand(trimmed)) {
    startInteractiveSession(rawCommand)
    return
  }

  state.executing = true

  setStatus('online')

  runCommand(rawCommand)
    .then(() => {
      if (!interactiveMode) setStatus('online')
    })
    .catch(error => {
      const message =
        error instanceof Error ? error.message : 'Unexpected command failure'
      setStatus('error')
      displayError(message)
    })
    .finally(() => {
      state.executing = false
      showPrompt(true)
    })
}

/** @param {string} command */
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
function isInteractiveCommand(command) {
  const binary = command.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return INTERACTIVE_COMMANDS.has(binary)
}

/** @param {Command} command */
function executeLocalCommand(command) {
  const cmd = command.trim().toLowerCase()
  if (cmd === 'clear' || cmd === 'reset') {
    terminal.clear()
    state.input = ''
    state.executing = false
    setStatus('online')
    showPrompt(false)
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

/**
 * @param {string} buffer
 * @param {Function} callback
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

/** @param {{ type: string, data: string, error: string, exitCode: number, command: string }} event */
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
    console.info(code)
    if (code !== 0) {
      terminal.writeln(`\r\n[process exited with code ${code}]`)
    }
    return
  }

  if (type === 'start') {
    const name = typeof event.command === 'string' ? event.command : 'command'
    setStatus('online')
  }
}

/**
 * @param {Response} response
 * @returns {Promise<{ stdout: string, stderr: string, success: boolean, error: string, exitCode: number }>}
 */
async function parseJsonResponse(response) {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(text || 'Command failed to start')
  }
  try {
    return /** @type {{ stdout: string, stderr: string, success: boolean, error: string, exitCode: number }} */ (
      JSON.parse(text)
    )
  } catch (error) {
    throw new Error('Malformed JSON response from sandbox')
  }
}

/** @param {{ stdout: string, stderr: string, success: boolean, error: string, exitCode: number }} result */
function renderExecResult(result) {
  if (result.stdout) {
    terminal.write(result.stdout)
  }
  if (result.stderr) {
    terminal.write(`\u001b[31m${result.stderr}\u001b[0m`)
  }
  if (!result.success) {
    const message = result.error || 'Command failed'
    displayError(message)
    setStatus('error')
  } else {
    setStatus('online')
  }
  if (typeof result.exitCode === 'number') {
    if (result.exitCode !== 0) {
      terminal.writeln(`\r\n[process exited with code ${result.exitCode}]`)
    }
  }
}

/** @param {Command} command */
function startInteractiveSession(command) {
  if (interactiveMode) {
    terminal.writeln(
      '\u001b[33mInteractive session already active. Type `exit` to close it.\u001b[0m',
    )
    setStatus('interactive')
    return
  }
  interactiveMode = true
  state.executing = true
  interactiveInitQueued = command.endsWith('\n') ? command : `${command}\n`
  setStatus('interactive')
  terminal.writeln('\r\n\u001b[90mOpening interactive shell...\u001b[0m')
  openInteractiveSocket()
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
      const payload = /** @type {{ type: string, exitCode?: number }} */ (
        JSON.parse(data)
      )
      if (payload?.type === 'pong') return
      if (payload?.type === 'ready') return
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
  } else if (data instanceof Uint8Array) {
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

/** @param {string} key
 * @param {KeyboardEvent} domEvent
 */
function sendInteractiveKey(key, domEvent) {
  if (!interactiveSocket || interactiveSocket.readyState !== WebSocket.OPEN)
    return
  if (domEvent.ctrlKey && domEvent.key.toLowerCase() === 'c') {
    sendInteractiveInput('\u0003')
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
    default:
      break
  }
  if (key.length === 1) {
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

/** @param {{ type: string, cols: number, rows: number, shell?: string | undefined }} payload */
function sendInteractiveJson(payload) {
  if (!interactiveSocket || interactiveSocket.readyState !== WebSocket.OPEN)
    return
  interactiveSocket.send(JSON.stringify(payload))
}

/**
 * @param {'online' | 'interactive' | 'error' | 'offline'} mode
 */
function resetInteractiveState(mode) {
  if (interactiveSocket && interactiveSocket.readyState === WebSocket.OPEN) {
    interactiveSocket.close()
  }
  interactiveSocket = undefined
  interactiveMode = false
  interactiveInitQueued = ''
  state.executing = false
  setStatus(mode)
  showPrompt(true)
}

function websocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}${WS_ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`
}

/** @param {string} message */
function displayError(message) {
  terminal.writeln(`\u001b[31m${message}\u001b[0m`)
}

/**
 * @param {'online' | 'interactive' | 'error' | 'offline'} mode
 */
function setStatus(mode) {
  if (currentStatus === mode) return
  currentStatus = mode
  if (!statusText) return
  const style = STATUS_STYLE[mode] ?? STATUS_STYLE.online
  statusText.textContent = style.text
  statusText.style.color = style.color
  statusText.style.fontSize = '12px'
  statusText.style.position = 'absolute'
  statusText.style.bottom = '0'
  statusText.style.right = '0'
  statusText.style.margin = '0 18px 8px 0'
}

function showPrompt(withNewline = true) {
  state.input = ''
  state.historyIndex = state.history.length
  const prefix = withNewline ? '\r\n' : ''
  terminal.write(prefix + PROMPT)
}

/** @param {string} value */
function setInputLine(value) {
  state.input = value
  terminal.write('\u001b[2K\r' + PROMPT + state.input)
}

/** @param {string} text */
function appendInput(text) {
  if (!text) return
  state.input += text
  terminal.write(text)
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

function attachPasteListener() {
  const textarea = /** @type {HTMLTextAreaElement | null} */ (terminal.textarea)
  if (!textarea) return
  textarea.addEventListener('paste', event => {
    if (state.executing && !interactiveMode) return
    const text = event.clipboardData?.getData('text')
    if (!text) return
    event.preventDefault()
    if (interactiveMode) {
      sendInteractiveInput(text)
    } else {
      appendInput(text)
    }
  })
}
