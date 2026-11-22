/**
 * 内联图标：16×16 线性、1.5px 描边、currentColor。
 * 全部手写而非外部图库——本应用只需要 chrome 级图标（侧栏折叠/便签/缩放），
 * 地图 POI 图库（Maki）没有这些形状，引一个图标库为 8 个图标不值。
 */

const OPEN = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
const CLOSE = '</svg>'

function line(paths: string): string {
  return OPEN + paths + CLOSE
}

function solid(paths: string): string {
  return (
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" stroke="none" aria-hidden="true">' +
    paths +
    CLOSE
  )
}

export const icons = {
  sidebar: line('<rect x="2.5" y="3" width="11" height="10" rx="1"/><path d="M6.5 3v10"/>'),
  open: line(
    '<path d="M2 12.5V4a1 1 0 0 1 1-1h3l1.4 1.6H13a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z"/>',
  ),
  select: line('<path d="M4 2.6 11.4 8.6 8.1 9 9.7 12.4 8.2 13.2 6.6 9.7 4 11.6Z"/>'),
  highlight: line(
    '<path d="M3 13.2h10"/><path d="M5.4 10.9 11.8 4.5a1.1 1.1 0 0 1 1.6 0l.1.1a1.1 1.1 0 0 1 0 1.6L7.1 12.6Z"/>',
  ),
  underline: line('<path d="M5 3v5a3 3 0 0 0 6 0V3"/><path d="M3.5 13.2h9"/>'),
  note: line('<path d="M3 3h10v6.6L9.6 13H3Z"/><path d="M13 9.6H9.6V13"/>'),
  text: line('<path d="M3.5 3.5h9"/><path d="M8 3.5v9"/><path d="M6 12.5h4"/>'),
  prev: line('<path d="M9.6 4 6 8l3.6 4"/>'),
  next: line('<path d="M6.4 4 10 8l-3.6 4"/>'),
  minus: line('<path d="M4 8h8"/>'),
  plus: line('<path d="M4 8h8M8 4v8"/>'),
  fit: line('<path d="M3 6V3h3"/><path d="M13 6V3h-3"/><path d="M3 10v3h3"/><path d="M13 10v3h-3"/>'),
  close: line('<path d="M4.5 4.5 11.5 11.5"/><path d="M11.5 4.5 4.5 11.5"/>'),
  play: solid('<path d="M5 3.2 12 8l-7 4.8Z"/>'),
  pause: solid('<rect x="4.6" y="3.4" width="2.3" height="9.2" rx=".4"/><rect x="9.1" y="3.4" width="2.3" height="9.2" rx=".4"/>'),
  trash: line('<path d="M3.5 5h9"/><path d="M6.2 5V3.6h3.6V5"/><path d="M4.8 5l.5 8h5.4l.5-8"/>'),
  copy: line('<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5V3.6a1 1 0 0 0-1-1H3.6a1 1 0 0 0-1 1v5.9a1 1 0 0 0 1 1h1.9"/>'),
} as const

export type IconName = keyof typeof icons
