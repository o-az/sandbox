import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { LigaturesAddon } from '@xterm/addon-ligatures'

const terminal = new Terminal({
  fontSize: 18,
  scrollback: 1000,
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

const webglAddon = new WebglAddon()
webglAddon.onContextLoss(event => {
  console.error('WebGL context lost', event)
  webglAddon.dispose()
})

const fitAddon = new FitAddon()

const terminalElement = document.querySelector('div#terminal')
if (!terminalElement) throw new Error('Terminal element not found')

terminal.loadAddon(webglAddon)
terminal.open(terminalElement)
terminal.loadAddon(fitAddon)

const clipboardAddon = new ClipboardAddon({
  readText: () => navigator.clipboard.readText(),
  writeText: text => navigator.clipboard.writeText(text),
})
terminal.loadAddon(clipboardAddon)
terminal.attachCustomKeyEventHandler(
  event =>
    !(
      event.type === 'keydown' &&
      event.key === 'c' &&
      event.ctrlKey &&
      event.metaKey
    ),
)

const ligaturesAddon = new LigaturesAddon()
terminal.loadAddon(ligaturesAddon)

const webLinksAddon = new WebLinksAddon()
terminal.loadAddon(webLinksAddon)

const fitTerminal = () => fitAddon.fit() ?? void 0
setTimeout(fitTerminal, 100)
window.addEventListener('resize', _ => setTimeout(fitTerminal, 50))

/** @type {Array<string>} */
const commandHistory = []
let [currentLine, cursorPosition] = ['', 0]
let [historyIndex, isExecuting] = [-1, false]

const PROMPT = '\x1b[32m$\x1b[0m '

/**
 * @param {{ leadingNewline?: boolean }} [options]
 */
function prompt(options = {}) {
  const { leadingNewline = true } = options
  currentLine = ''
  cursorPosition = 0
  if (leadingNewline) terminal.write('\r\n')
  renderCurrentInput()
}

function clearTerminal() {
  terminal.write('\x1b[H\x1b[2J')
  prompt({ leadingNewline: false })
}

const sessionId =
  localStorage.getItem('sessionId') ||
  `session-${Math.random().toString(36).substring(2, 9)}`
localStorage.setItem('sessionId', sessionId)

const statusText = document.querySelector('p#status-text')
if (!statusText) throw new Error('Status text element not found')

const loading = document.querySelector('p#loading')
if (!loading) throw new Error('Loading element not found')

const terminalWrapper = document.querySelector('main#terminal-wrapper')
if (!terminalWrapper) throw new Error('Terminal wrapper element not found')

function showLoading() {
  if (!loading) return
  loading.classList.add('active')
}

function hideLoading() {
  if (!loading) return
  loading.classList.remove('active')
  if (terminalWrapper) terminalWrapper.style.display = 'block'
}

/** @param {string} text */
function updateStatus(text, isConnected = true) {
  if (!statusText) return
  statusText.textContent = text
  Object.assign(statusText.style, {
    color: isConnected ? '#4ade80' : '#ef4444',
    fontSize: '12px',
    position: 'absolute',
    height: '16px',
    bottom: 0,
    right: 0,
    margin: '0 18px 8px 0',
  })
}

/** @param {string} text */
function writeToTerminal(text) {
  if (!terminal) return
  terminal.write(text)
}

/** @param {string} text */
function writeLine(text) {
  terminal.writeln(text)
}

function renderCurrentInput() {
  if (cursorPosition < 0) cursorPosition = 0
  if (cursorPosition > currentLine.length) cursorPosition = currentLine.length
  const moveLeft = currentLine.length - cursorPosition
  let output = `\r\x1b[K${PROMPT}${currentLine}`
  if (moveLeft > 0) output += `\x1b[${moveLeft}D`
  terminal.write(output)
}

function findPreviousWordBoundary() {
  if (cursorPosition === 0) return 0
  let index = cursorPosition
  while (index > 0 && currentLine[index - 1] === ' ') index--
  while (index > 0 && currentLine[index - 1] !== ' ') index--
  return index
}

function findNextWordBoundary() {
  if (cursorPosition === currentLine.length) return currentLine.length
  let index = cursorPosition
  while (index < currentLine.length && currentLine[index] === ' ') index++
  while (index < currentLine.length && currentLine[index] !== ' ') index++
  return index
}

/**
 * @param {string} text
 */
function insertText(text) {
  if (!text) return
  currentLine =
    currentLine.slice(0, cursorPosition) +
    text +
    currentLine.slice(cursorPosition)
  cursorPosition += text.length
  historyIndex = commandHistory.length
  renderCurrentInput()
}

function handleEnter() {
  writeLine('')
  historyIndex = commandHistory.length
  if (currentLine.trim()) {
    commandHistory.push(currentLine)
    historyIndex = commandHistory.length
    executeCommand(currentLine)
  } else prompt()
}

/**
 * @param {string} text
 */
function applyTextInput(text) {
  if (!text) return
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const segments = normalized.split('\n')
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment) insertText(segment)
    if (index < segments.length - 1) {
      handleEnter()
      if (isExecuting) return
    }
  }
}

terminal.attachCustomKeyEventHandler(event => {
  if (isExecuting) return true
  if (!event.metaKey || event.altKey || event.ctrlKey) return true
  const { key, code } = event
  const targetsLeft =
    key === 'ArrowLeft' || key === 'Home' || code === 'ArrowLeft'
  const targetsRight =
    key === 'ArrowRight' || key === 'End' || code === 'ArrowRight'
  if (!targetsLeft && !targetsRight) return true
  event.preventDefault()
  const targetPosition = targetsLeft ? 0 : currentLine.length
  if (cursorPosition !== targetPosition) {
    cursorPosition = targetPosition
    historyIndex = commandHistory.length
    renderCurrentInput()
  }
  return false
})

/** @param {string} command */
async function executeCommand(command) {
  if (!command.trim()) return prompt()
  isExecuting = true

  if (command.trim() === 'clear') {
    clearTerminal()
    isExecuting = false
    return
  }
  try {
    const response = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, sessionId }),
    })
    const data = await response.json()
    if (data.success) {
      if (data.stdout) writeToTerminal('\r\n' + data.stdout + '\r\n')
      if (data.stderr) writeToTerminal('\r\n\x1b[31m' + data.stderr + '\x1b[0m')
    } else writeLine('\r\n\x1b[31mError executing command\x1b[0m')
  } catch (error) {
    console.error(error)
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    writeLine(`\r\n\x1b[31mNetwork error: ${errorMessage}\x1b[0m`)
    updateStatus('Disconnected', false)
  }
  isExecuting = false
  prompt()
}

terminal.onData(data => {
  if (isExecuting) return
  // biome-ignore lint/suspicious/noControlCharactersInRegex: _
  const metaNavigationMatch = data.match(/^\x1b\[[0-9]+;9([CDFH])$/)
  if (metaNavigationMatch) {
    const navigationKey = metaNavigationMatch[1]
    const targetPosition =
      navigationKey === 'D' || navigationKey === 'H' ? 0 : currentLine.length
    if (cursorPosition !== targetPosition) {
      cursorPosition = targetPosition
      historyIndex = commandHistory.length
      renderCurrentInput()
    }
    return
  }

  if (data.length > 1 && !data.includes('\x1b') && /[\r\n]/.test(data)) {
    applyTextInput(data)
    return
  }

  const code = data.charCodeAt(0)
  if (code === 13) {
    handleEnter()
    return
  }
  if (code === 3) {
    writeLine('^C')
    currentLine = ''
    cursorPosition = 0
    prompt()
    return
  }
  if (code === 12) {
    clearTerminal()
    return
  }
  if (data === '\x1b[A') {
    if (historyIndex > 0) {
      historyIndex--
      currentLine = commandHistory[historyIndex]
      cursorPosition = currentLine.length
      renderCurrentInput()
    }
    return
  }
  if (data === '\x1b[B') {
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++
      currentLine = commandHistory[historyIndex]
      cursorPosition = currentLine.length
      renderCurrentInput()
    } else if (historyIndex === commandHistory.length - 1) {
      historyIndex = commandHistory.length
      currentLine = ''
      cursorPosition = 0
      renderCurrentInput()
    }
    return
  }
  if (/^[\x20-\x7e]+$/.test(data)) {
    insertText(data)
  }
})

terminal.onKey(({ domEvent }) => {
  if (isExecuting) return
  const { key: domKey, altKey, metaKey } = domEvent

  if (domKey === 'Backspace') {
    domEvent.preventDefault()
    if (cursorPosition > 0) {
      currentLine =
        currentLine.slice(0, cursorPosition - 1) +
        currentLine.slice(cursorPosition)
      cursorPosition--
      historyIndex = commandHistory.length
      renderCurrentInput()
    }
    return
  }

  if (domKey === 'Delete') {
    domEvent.preventDefault()
    if (cursorPosition < currentLine.length) {
      currentLine =
        currentLine.slice(0, cursorPosition) +
        currentLine.slice(cursorPosition + 1)
      historyIndex = commandHistory.length
      renderCurrentInput()
    }
    return
  }

  if (domKey === 'ArrowLeft') {
    domEvent.preventDefault()
    const originalPosition = cursorPosition
    if (metaKey) cursorPosition = 0
    else if (altKey) cursorPosition = findPreviousWordBoundary()
    else if (cursorPosition > 0) cursorPosition--
    if (cursorPosition !== originalPosition) renderCurrentInput()
    return
  }

  if (domKey === 'ArrowRight') {
    domEvent.preventDefault()
    const originalPosition = cursorPosition
    if (metaKey) cursorPosition = currentLine.length
    else if (altKey) cursorPosition = findNextWordBoundary()
    else if (cursorPosition < currentLine.length) cursorPosition++
    if (cursorPosition !== originalPosition) renderCurrentInput()
    return
  }

  if (domKey === 'Home') {
    domEvent.preventDefault()
    if (cursorPosition !== 0) {
      cursorPosition = 0
      renderCurrentInput()
    }
    return
  }

  if (domKey === 'End') {
    domEvent.preventDefault()
    if (cursorPosition !== currentLine.length) {
      cursorPosition = currentLine.length
      renderCurrentInput()
    }
  }
})

async function initTerminal() {
  showLoading()
  updateStatus('Initializing...', false)
  try {
    const response = await fetch('/api/ping')
    /** @type {string} */
    const data = await response.text()
    if (data !== 'ok') throw new Error('Connection failed')
    hideLoading()
    updateStatus('Connected', true)
    prompt()
  } catch (error) {
    hideLoading()
    updateStatus('Connection Failed', false)
    writeLine('Failed to connect to sandbox. Please refresh the page.')
    writeLine('')
    writeLine('')
  }
}

initTerminal().catch(error => {
  console.error(error)
  hideLoading()
  updateStatus('Connection Failed', false)
  writeLine('Failed to connect to sandbox. Please refresh the page.')
  writeLine(
    'Please report an issue at https://github.com/o-az/foundry-sandbox/issues',
  )
  writeLine('')
})
