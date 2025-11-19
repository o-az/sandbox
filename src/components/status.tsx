import { createMemo } from 'solid-js'

export type StatusMode = 'online' | 'interactive' | 'error' | 'offline'

export const STATUS_STYLE: Record<StatusMode, { text: string; color: string }> =
  {
    online: { text: 'Online', color: '#4ade80' },
    interactive: { text: 'Interactive', color: '#38bdf8' },
    error: { text: 'Error', color: '#f87171' },
    offline: { text: 'Offline', color: '#fbbf24' },
  }

type StatusProps = {
  mode: StatusMode
  message: string
}

export function Status(props: StatusProps) {
  const style = createMemo(() => STATUS_STYLE[props.mode])

  return (
    <p
      class="top-0 right-0 m-2 absolute text-sm font-mono z-1000"
      style={{
        color: style().color,
      }}>
      {style().text} · {props.message}
    </p>
  )
}
