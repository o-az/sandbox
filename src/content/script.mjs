import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

const term = new Terminal({
  fontSize: 18,
  scrollback: 1000,
  convertEol: true,
  cursorBlink: true,
  cursorStyle: 'bar',
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
term.loadAddon(fitAddon)

const terminalElement = document.querySelector('div#terminal')
if (!terminalElement) throw new Error('Terminal element not found')

term.open(terminalElement)

const fitTerminal = () => fitAddon.fit() ?? void 0

setTimeout(fitTerminal, 100)

window.addEventListener('resize', _ => setTimeout(fitTerminal, 50))

/** @type {Array<string>} */
const commandHistory = []
let [currentLine, cursorPosition] = ['', 0]
let [historyIndex, isExecuting] = [-1, false]

const prompt = () => [
  term.write('\r\n\x1b[32m$\x1b[0m '),
  (currentLine = ''),
  (cursorPosition = 0),
]

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
  if (!term) return
  term.write(text)
}

/** @param {string} text */
function writeLine(text) {
  term.writeln(text)
}

/** @param {string} command */
async function executeCommand(command) {
  if (!command.trim()) return prompt()
  isExecuting = true

  if (command.trim() === 'clear') return [term.clear(), prompt()]
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

term.onData(data => {
  if (isExecuting) return
  const code = data.charCodeAt(0)
  if (code === 13) {
    writeLine('')
    if (currentLine.trim()) {
      commandHistory.push(currentLine)
      historyIndex = commandHistory.length
      executeCommand(currentLine)
    } else {
      prompt()
    }
    return
  }
  if (code === 127) {
    if (cursorPosition > 0) {
      currentLine =
        currentLine.slice(0, cursorPosition - 1) +
        currentLine.slice(cursorPosition)
      cursorPosition--
      term.write('\b \b')
    }
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
    term.clear()
    prompt()
    return
  }
  if (data === '\x1b[A') {
    if (historyIndex > 0) {
      historyIndex--
      term.write('\r\x1b[K\x1b[32m$\x1b[0m ')
      currentLine = commandHistory[historyIndex]
      cursorPosition = currentLine.length
      writeToTerminal(currentLine)
    }
    return
  }
  if (data === '\x1b[B') {
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++
      term.write('\r\x1b[K\x1b[32m$\x1b[0m ')
      currentLine = commandHistory[historyIndex]
      cursorPosition = currentLine.length
      writeToTerminal(currentLine)
    } else if (historyIndex === commandHistory.length - 1) {
      historyIndex = commandHistory.length
      term.write('\r\x1b[K\x1b[32m$\x1b[0m ')
      currentLine = ''
      cursorPosition = 0
    }
    return
  }
  if (code >= 32 && code < 127) {
    currentLine =
      currentLine.slice(0, cursorPosition) +
      data +
      currentLine.slice(cursorPosition)
    cursorPosition++
    writeToTerminal(data)
  }
})

term.onKey(event => {
  if (event.key === 'Backspace') {
    if (cursorPosition > 0) {
      currentLine =
        currentLine.slice(0, cursorPosition - 1) +
        currentLine.slice(cursorPosition)
      cursorPosition--
      term.write('\b \b')
    }
  }
})

term.onKey(event => {
  if (event.key === 'Delete') {
    if (cursorPosition < currentLine.length) {
      currentLine =
        currentLine.slice(0, cursorPosition) +
        currentLine.slice(cursorPosition + 1)
    }
  }
})

async function initTerminal() {
  showLoading()
  updateStatus('Initializing...', false)
  try {
    const response = await fetch('/api/ping')
    /** @type {{ pong: boolean }} */
    const data = await response.json()
    if (!data.pong) throw new Error('Connection failed')
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
