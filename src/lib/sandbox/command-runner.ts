import type { Terminal } from 'ghostty-web'

import type { StatusMode } from '#components/status.tsx'

const textDecoder = new TextDecoder()

export type CommandRunnerOptions = {
  sessionId: string
  terminal: Terminal
  setStatus: (mode: StatusMode) => void
  displayError: (message: string) => void
  streamingCommands?: Set<string>
}

export type SandboxExecResult = {
  stdout?: string
  stderr?: string
  success?: boolean
  error?: string
  exitCode?: number
  duration?: number
  code?: number
}

export type StreamEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'error'; error: string }
  | { type: 'complete'; exitCode: number }
  | { type: 'start' }

export function createCommandRunner({
  sessionId,
  terminal,
  setStatus,
  displayError,
  streamingCommands = new Set(['anvil']),
}: CommandRunnerOptions) {
  if (!sessionId) throw new Error('Session ID is required')

  async function runSimpleCommand(command: string) {
    const response = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, sessionId }),
    })

    const payload = await parseJsonResponse(response)
    terminal.write('\r\n')
    renderExecResult(payload)
  }

  async function runStreamingCommand(command: string) {
    const response = await fetch('/api/exec', {
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
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += textDecoder.decode(value, { stream: true })
      buffer = consumeSseBuffer(buffer, handleStreamEvent)
    }

    const finalChunk = textDecoder.decode()
    if (buffer || finalChunk) {
      consumeSseBuffer(buffer + finalChunk, handleStreamEvent)
    }
  }

  function consumeSseBuffer(
    buffer: string,
    callback: (chunk: StreamEvent) => void,
  ) {
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
        callback(JSON.parse(data) as StreamEvent)
      } catch (error) {
        console.warn('Failed to parse SSE event', error)
      }
    }
    return working
  }

  function handleStreamEvent(event: StreamEvent) {
    if (event.type === 'stdout') {
      terminal.write(event.data)
      return
    }

    if (event.type === 'stderr') {
      terminal.write(`\u001b[31m${event.data}\u001b[0m`)
      return
    }

    if (event.type === 'error') {
      displayError(event.error)
      setStatus('error')
      return
    }

    if (event.type === 'complete') {
      if (event.exitCode !== 0) {
        terminal.writeln(`\r\n[process exited with code ${event.exitCode}]`)
      }
      return
    }

    if (event.type === 'start') {
      terminal.write('\r\n')
      setStatus('online')
    }
  }

  async function parseJsonResponse(
    response: Response,
  ): Promise<SandboxExecResult> {
    const text = await response.text()
    if (!response.ok) {
      throw new Error(text || 'Command failed to start')
    }
    try {
      return JSON.parse(text) as SandboxExecResult
    } catch {
      throw new Error('Malformed JSON response from sandbox')
    }
  }

  function renderExecResult(result: SandboxExecResult) {
    if (result.stdout) {
      terminal.write(result.stdout)
      if (!result.stdout.endsWith('\n')) terminal.write('\r\n')
    }
    if (result.stderr) displayError(result.stderr)

    if (result.success === false) {
      const message = result.error || 'Command failed'
      displayError(message)
      setStatus('error')
    } else {
      setStatus('online')
    }

    const exitCode =
      typeof result.exitCode === 'number' ? result.exitCode : result.code
    if (typeof exitCode === 'number' && exitCode !== 0) {
      terminal.writeln(`\r\n[process exited with code ${exitCode}]`)
    }
  }

  function runCommand(command: string) {
    const binary = command.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    if (streamingCommands.has(binary)) {
      return runStreamingCommand(command)
    }
    return runSimpleCommand(command)
  }

  return {
    runCommand,
    runStreamingCommand,
    runSimpleCommand,
  }
}
