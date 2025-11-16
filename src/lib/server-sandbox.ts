import { makeObjectStorage } from '@solid-primitives/storage'
import { createServerOnlyFn } from '@tanstack/start-client-core'

export type SandboxRecord = {
  sandboxId: string
  activeTabs: string[]
}

type SandboxGlobal = typeof globalThis & {
  __sandboxSessions?: Record<string, string>
}

const getSandboxStorage = createServerOnlyFn(() =>
  makeObjectStorage(((globalThis as SandboxGlobal).__sandboxSessions ??= {})),
)

export function ensureSandboxSession(
  sessionId: string,
  tabId?: string,
): SandboxRecord {
  const record = readSandboxSession(sessionId) ?? {
    sandboxId: sessionId,
    activeTabs: [],
  }

  if (tabId && !record.activeTabs.includes(tabId)) {
    record.activeTabs = [...record.activeTabs, tabId]
  }

  writeSandboxSession(sessionId, record)
  return record
}

export function readSandboxSession(
  sessionId: string,
): SandboxRecord | undefined {
  const storage = getSandboxStorage()
  const raw = storage.getItem(sessionId)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as SandboxRecord
  } catch {
    storage.removeItem(sessionId)
    return undefined
  }
}

export function writeSandboxSession(sessionId: string, record: SandboxRecord) {
  getSandboxStorage().setItem(sessionId, JSON.stringify(record))
}

export function getActiveTabCount(sessionId: string) {
  return readSandboxSession(sessionId)?.activeTabs.length ?? 0
}

export function removeActiveTab(sessionId: string, tabId?: string) {
  const record = readSandboxSession(sessionId)
  if (!record) return 0
  if (tabId) {
    record.activeTabs = record.activeTabs.filter(value => value !== tabId)
  }
  writeSandboxSession(sessionId, record)
  return record.activeTabs.length
}

export function clearSandboxSession(sessionId: string) {
  getSandboxStorage().removeItem(sessionId)
}
