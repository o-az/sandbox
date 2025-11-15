import {
  tabId,
  autoRun,
  sessionId,
  embedMode,
  prefilledCommand,
  INTERACTIVE_COMMANDS,
  clearStoredSessionState,
} from './state/session.mjs'
import { startSandboxWarmup } from './state/warmup.mjs'
import { StatusIndicator } from './terminal/status.mjs'
import { TerminalManager } from './terminal/instance.mjs'
import { createCommandRunner } from './commands/runner.mjs'
import { createVirtualKeyboardBridge } from './input/virtual.mjs'
import { createInteractiveSession } from './interactive/session.mjs'

const PROMPT = ' \u001b[32m$\u001b[0m '
const LOCAL_COMMANDS = new Set(['clear', 'reset'])

let awaitingInput = false
let commandInProgress = false
let hasPrefilledCommand = false
let recoveringSession = false
let sessionBroken = false

/** @type {(event: KeyboardEvent) => boolean} */
let altNavigationDelegate = () => false

const terminalManager = new TerminalManager()
const terminalElement = document.querySelector('div#terminal')
if (!terminalElement) throw new Error('Terminal element not found')

terminalManager.init(terminalElement, {
  onAltNavigation: event => altNavigationDelegate(event),
})

const terminal = terminalManager.terminal
const fitAddon = terminalManager.fitAddon
const xtermReadline = terminalManager.readline
const serializeAddon = terminalManager.serializeAddon

const statusText = document.querySelector('p#status-text')
const statusIndicator = new StatusIndicator(statusText)

terminal.writeln('\r')
terminal.focus()
statusIndicator.setStatus(navigator.onLine ? 'online' : 'offline')

const footer = document.querySelector('footer#footer')
if (footer && !embedMode) footer.classList.add('footer')
else footer?.classList.remove('footer')

const stopWarmup = startSandboxWarmup({ sessionId, tabId })

const { runCommand } = createCommandRunner({
  sessionId,
  terminal,
  serializeAddon,
  setStatus: mode => statusIndicator.setStatus(mode),
  displayError,
})

const {
  startInteractiveSession,
  sendInteractiveInput,
  notifyResize,
  isInteractiveMode,
} = createInteractiveSession({
  terminal,
  serializeAddon,
  setStatus: mode => statusIndicator.setStatus(mode),
  onSessionExit: () => {
    commandInProgress = false
    startInputLoop()
  },
})

const { sendVirtualKeyboardInput, handleAltNavigation } =
  createVirtualKeyboardBridge({
    xtermReadline,
    sendInteractiveInput,
    isInteractiveMode,
  })
altNavigationDelegate = handleAltNavigation

xtermReadline.setCtrlCHandler(() => {
  if (isInteractiveMode() || commandInProgress) return
  xtermReadline.println('^C')
  statusIndicator.setStatus('online')
  startInputLoop()
})

window.addEventListener('online', () => {
  if (!isInteractiveMode()) statusIndicator.setStatus('online')
})
window.addEventListener('offline', () => statusIndicator.setStatus('offline'))

window.addEventListener('message', event => {
  if (event.data?.type === 'execute') {
    terminal.options.disableStdin = false
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
    })
    terminal.textarea?.dispatchEvent(enterEvent)
    setTimeout(() => {
      if (embedMode) terminal.options.disableStdin = true
    }, 200)
  }
})

/** @type {number | undefined} */
let resizeRaf
window.addEventListener('resize', () => {
  if (document.hidden) return
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
  resizeRaf = window.requestAnimationFrame(() => {
    resizeRaf = undefined
    fitAddon.fit()
    notifyResize({
      cols: terminal.cols,
      rows: terminal.rows,
    })
  })
})

// Tear down the sandbox when the page is closed to avoid idle containers.
let teardownScheduled = false

// Track if user is navigating away vs refreshing
let isRefreshing = false
window.addEventListener('beforeunload', () => {
  // Set a marker that survives page refresh
  sessionStorage.setItem('wasRefreshing', 'true')
  isRefreshing = true
})

// Check if this was a refresh - the marker will be present
if (sessionStorage.getItem('wasRefreshing') === 'true') {
  sessionStorage.removeItem('wasRefreshing')
  console.debug('Session resumed after refresh:', { sessionId, tabId })
}

function teardownSandbox() {
  if (teardownScheduled) return
  teardownScheduled = true
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
  stopWarmup?.()
  terminalManager.dispose()

  // Only reset the sandbox if we're truly closing the tab, not refreshing
  // isRefreshing is set in beforeunload, so if pagehide fires immediately after,
  // we're likely refreshing
  if (isRefreshing) {
    console.debug('Page refreshing, keeping sandbox alive:', sessionId)
    return
  }

  console.debug('Tab closing, destroying sandbox:', sessionId)
  const body = JSON.stringify({ sessionId, tabId })
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    navigator.sendBeacon('/api/reset', blob)
    return
  }
  fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Ignore network errors; page is unloading.
  })
}

// pagehide is more reliable than beforeunload for cleanup
window.addEventListener('pagehide', teardownSandbox, { once: true })

startInputLoop()

/**
 * Kicks off the readline prompt loop unless an interactive session is active.
 * @returns {void}
 */
function startInputLoop() {
  if (isInteractiveMode() || awaitingInput) return
  awaitingInput = true

  xtermReadline
    .read(PROMPT)
    .then(async rawCommand => {
      awaitingInput = false
      await processCommand(rawCommand)
      startInputLoop()
    })
    .catch(error => {
      awaitingInput = false
      if (isInteractiveMode()) return
      console.error('xtermReadline error', error)
      statusIndicator.setStatus('error')
      startInputLoop()
    })

  if (!hasPrefilledCommand && prefilledCommand) {
    hasPrefilledCommand = true
    setTimeout(() => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/plain', prefilledCommand ?? '')
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
      })
      terminal.textarea?.dispatchEvent(pasteEvent)

      if (embedMode && !autoRun) terminal.options.disableStdin = true

      if (autoRun) {
        setTimeout(() => {
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
          })
          terminal.textarea?.dispatchEvent(enterEvent)
        }, 100)
      }
    }, 50)
  }
}

/**
 * @param {string} rawCommand
 * @returns {Promise<void>}
 */
async function processCommand(rawCommand) {
  const trimmed = rawCommand.trim()
  if (!trimmed) {
    statusIndicator.setStatus('online')
    return
  }

  const normalized = trimmed.toLowerCase()
  if (sessionBroken && normalized !== 'reset') {
    statusIndicator.setStatus('error')
    displayError(
      'Sandbox shell is unavailable. Type `reset` or refresh the page to start a new session.',
    )
    return
  }

  if (isLocalCommand(trimmed)) {
    executeLocalCommand(trimmed)
    return
  }

  if (INTERACTIVE_COMMANDS.has(trimmed)) {
    commandInProgress = true
    await startInteractiveSession(rawCommand)
    return
  }

  commandInProgress = true
  statusIndicator.setStatus('online')

  try {
    await runCommand(rawCommand)
    if (!isInteractiveMode()) statusIndicator.setStatus('online')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isFatalSandboxError(message)) {
      handleFatalSandboxError(message)
      return
    }
    statusIndicator.setStatus('error')
    displayError(message)
  } finally {
    commandInProgress = false
  }
}

/**
 * @param {string} command
 * @returns {boolean}
 */
function isLocalCommand(command) {
  return LOCAL_COMMANDS.has(command.trim().toLowerCase())
}

/**
 * @param {string} command
 * @returns {void}
 */
function executeLocalCommand(command) {
  const normalized = command.trim().toLowerCase()
  if (normalized === 'clear') {
    terminal.clear()
    statusIndicator.setStatus('online')
    return
  }

  if (normalized === 'reset') resetSandboxSession()
}

/**
 * @param {string} message
 */
function displayError(message) {
  terminal.writeln(`\u001b[31m${message}\u001b[0m`, () => {
    console.info(serializeAddon.serialize())
  })
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isFatalSandboxError(message) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('shell has died') ||
    normalized.includes('session is dead') ||
    normalized.includes('shell terminated unexpectedly') ||
    normalized.includes('not ready or shell has died')
  )
}

/**
 * @param {string} message
 * @returns {void}
 */
function handleFatalSandboxError(message) {
  sessionBroken = true
  statusIndicator.setStatus('error')
  displayError(
    `${message}\nType \`reset\` or refresh the page to create a new sandbox session.`,
  )
}

/**
 * @returns {Promise<void>}
 */
async function resetSandboxSession() {
  if (recoveringSession) return
  recoveringSession = true
  statusIndicator.setStatus('error')
  terminal.writeln('\nResetting sandbox session...')

  try {
    await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, tabId }),
    })
  } catch (error) {
    console.error('Failed to reset sandbox session', error)
  }

  clearStoredSessionState()
  setTimeout(() => window.location.reload(), 500)
}

export { terminal, sendVirtualKeyboardInput }
