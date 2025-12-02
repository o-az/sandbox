import { CellFlags, type GhosttyCell, type Terminal } from 'ghostty-web'

export type SerializeHtmlOptions = {
  includeGlobalBackground?: boolean
}

const DEFAULT_FONT_FAMILY = 'Lilex, monospace'
const DEFAULT_FOREGROUND = '#f0f6fc'
const DEFAULT_BACKGROUND = '#0d1117'
export class TerminalSerializeAdapter {
  #terminal: Terminal

  constructor(terminal: Terminal) {
    this.#terminal = terminal
  }

  serializeAsHTML(options?: SerializeHtmlOptions): string {
    const wasmTerminal = this.#terminal.wasmTerm
    if (!wasmTerminal) return '<pre class="terminal-html"></pre>'

    const rows = collectRows(wasmTerminal, this.#terminal.rows)
    const lastContentRow = findLastContentRow(rows)
    const firstContentRow = findFirstContentRow(rows)
    let visibleRows: Array<GhosttyCell[] | null> = []
    if (lastContentRow >= 0 && firstContentRow <= lastContentRow) {
      visibleRows = rows.slice(firstContentRow, lastContentRow + 1)
    }
    const rowMarkup = visibleRows.map(renderRow).join('')
    const styles = [
      `font-family:${DEFAULT_FONT_FAMILY}`,
      'font-size:14px',
      'line-height:1.2',
      'margin:0',
      'padding:12px',
      'white-space:pre-wrap',
    ]

    const theme = this.#terminal.options.theme
    const fg = theme?.foreground ?? DEFAULT_FOREGROUND
    const bg = theme?.background ?? DEFAULT_BACKGROUND
    if (options?.includeGlobalBackground) styles.push(`background:${bg}`)
    styles.push(`color:${fg}`)

    const styleAttr = styles.length ? ` style="${styles.join(';')}"` : ''
    return `<pre class="terminal-html"${styleAttr}>${rowMarkup}</pre>`
  }

  serialize(): string {
    const wasmTerminal = this.#terminal.wasmTerm
    if (!wasmTerminal) return ''

    const rows = collectRows(wasmTerminal, this.#terminal.rows)
    return rows.map(renderRowText).join('\n')
  }
}

function collectRows(
  wasmTerminal: { getLine(row: number): GhosttyCell[] | null },
  count: number,
): Array<GhosttyCell[] | null> {
  const rows: Array<GhosttyCell[] | null> = []
  for (let index = 0; index < count; index++) {
    rows.push(wasmTerminal.getLine(index))
  }
  return rows
}

function renderRow(cells: GhosttyCell[] | null): string {
  if (!cells || cells.length === 0) {
    return '<div><span>&nbsp;</span></div>'
  }

  const trimmed = trimRowCells(cells)
  if (trimmed.length === 0) {
    return '<div><span>&nbsp;</span></div>'
  }

  const segments: string[] = []
  let currentStyle: string | undefined
  let buffer = ''

  const flush = () => {
    if (!buffer) return
    const styleAttr = currentStyle ? ` style="${currentStyle}"` : ''
    segments.push(`<span${styleAttr}>${buffer}</span>`)
    buffer = ''
  }

  for (const cell of trimmed) {
    if (!cell || !cell.width) continue
    const text = cellToHtml(cell)
    if (!text) continue

    const style = styleForCell(cell)
    if (style !== currentStyle) {
      flush()
      currentStyle = style
    }
    buffer += text
  }

  flush()

  if (segments.length === 0) return ''
  return `<div>${segments.join('')}</div>`
}

function renderRowText(cells: GhosttyCell[] | null): string {
  if (!cells || cells.length === 0) return ''

  const trimmed = trimRowCells(cells)
  if (trimmed.length === 0) return ''

  let text = ''

  for (const cell of trimmed) {
    if (!cell || !cell.width) continue
    if (cell.flags & CellFlags.INVISIBLE) {
      text += ' '.repeat(Math.max(1, cell.width))
      continue
    }

    const char =
      cell.codepoint === 0 ? ' ' : String.fromCodePoint(cell.codepoint)
    if (char === '\r') {
      continue
    }
    text += char.padEnd(Math.max(1, cell.width), ' ')
  }

  return text.replace(/\s+$/, '')
}

function cellToHtml(cell: GhosttyCell): string {
  const width = Math.max(1, cell.width ?? 1)
  if (cell.flags & CellFlags.INVISIBLE) return repeatNbsp(width)
  if (!cell.codepoint) return repeatNbsp(width)

  let output = escapeHtml(String.fromCodePoint(cell.codepoint))
  if (output === ' ') output = '&nbsp;'
  if (width > 1) output += repeatNbsp(width - 1)
  return output
}

function styleForCell(cell: GhosttyCell): string {
  const codepoint = cell.codepoint ?? 0
  const isPromptDollar = codepoint === 36
  let fg = isPromptDollar
    ? '#3fb950'
    : (rgbToCss(cell.fg_r, cell.fg_g, cell.fg_b) ?? DEFAULT_FOREGROUND)
  let bg = rgbToCss(cell.bg_r, cell.bg_g, cell.bg_b) ?? DEFAULT_BACKGROUND

  if (cell.flags & CellFlags.INVERSE) {
    const temp = fg
    fg = bg
    bg = temp
  }

  const styles = [`color:${fg}`, `background-color:${bg}`]
  if (cell.flags & CellFlags.BOLD) styles.push('font-weight:600')
  if (cell.flags & CellFlags.ITALIC) styles.push('font-style:italic')

  const decorations: string[] = []
  if (cell.flags & CellFlags.UNDERLINE) decorations.push('underline')
  if (cell.flags & CellFlags.STRIKETHROUGH) decorations.push('line-through')
  if (decorations.length)
    styles.push(`text-decoration:${decorations.join(' ')}`)
  if (cell.flags & CellFlags.FAINT) styles.push('opacity:0.65')

  return styles.join(';')
}

function rgbToCss(r?: number, g?: number, b?: number): string | undefined {
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
    return undefined
  }

  return `rgb(${clampColor(r)}, ${clampColor(g)}, ${clampColor(b)})`
}

function clampColor(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(255, value))
}

function repeatNbsp(count: number): string {
  if (count <= 0) return ''
  return '&nbsp;'.repeat(count)
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function trimRowCells(cells: GhosttyCell[]): GhosttyCell[] {
  let end = cells.length - 1
  while (end >= 0) {
    const cell = cells[end]
    if (!cell) {
      end--
      continue
    }
    if (!isWhitespaceCell(cell)) break
    end--
  }
  return cells.slice(0, end + 1)
}

function isWhitespaceCell(cell: GhosttyCell): boolean {
  const codepoint = cell.codepoint ?? 32
  if (
    codepoint === 32 ||
    codepoint === 0 ||
    /\s/.test(String.fromCodePoint(codepoint))
  ) {
    return true
  }
  return false
}

function findLastContentRow(rows: Array<GhosttyCell[] | null>): number {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    if (!row) continue
    const trimmed = trimRowCells(row)
    if (trimmed.length > 0) return index
  }
  return -1
}

function findFirstContentRow(rows: Array<GhosttyCell[] | null>): number {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (!row) continue
    const trimmed = trimRowCells(row)
    if (trimmed.length > 0) return index
  }
  return rows.length
}
