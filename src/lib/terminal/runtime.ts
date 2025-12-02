import { init } from 'ghostty-web'

const runtimeReady = init()

export function waitForTerminalRuntime(): Promise<void> {
  return runtimeReady
}
