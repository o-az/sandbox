const STREAMING_COMMANDS = new Set(['anvil'])
const INTERACTIVE_COMMANDS = new Set(['chisel', 'node'])

const WS_ENDPOINT = '/api/ws'
const API_ENDPOINT = '/api/exec'

// Persistent session ID across refreshes (localStorage survives until cleared)
const sessionId =
  localStorage.getItem('sessionId') ||
  `session-${Math.random().toString(36).slice(2, 9)}`
localStorage.setItem('sessionId', sessionId)

// Tab ID survives refresh but not tab close (sessionStorage clears on tab close)
const tabId =
  sessionStorage.getItem('tabId') ||
  `tab-${Math.random().toString(36).slice(2, 9)}`
sessionStorage.setItem('tabId', tabId)

// Check if this is a new session (first load) or continuation (refresh)
const isNewSession = !sessionStorage.getItem('sessionActive')
sessionStorage.setItem('sessionActive', 'true')

const params = new URLSearchParams(window.location.search)
const prefilledCommand = params.get('cmd')
const embedMode = params.get('embed') === 'true'
const autoRun = params.get('autorun') === 'true'

const LOG_LEVEL = params.get('log') === 'debug' ? 'debug' : 'info'

function clearStoredSessionState() {
  localStorage.removeItem('sessionId')
  sessionStorage.removeItem('tabId')
  sessionStorage.removeItem('sessionActive')
}

export {
  LOG_LEVEL,
  API_ENDPOINT,
  WS_ENDPOINT,
  STREAMING_COMMANDS,
  INTERACTIVE_COMMANDS,
  sessionId,
  tabId,
  isNewSession,
  prefilledCommand,
  embedMode,
  autoRun,
  clearStoredSessionState,
}
