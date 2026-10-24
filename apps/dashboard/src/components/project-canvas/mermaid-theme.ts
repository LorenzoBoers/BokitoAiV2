/** Mermaid's own palette is light purple boxes and near-black lines.
 * Those lines disappear on the dark canvas. The diagram uses the app tokens
 * instead, and the stylesheet paints the same colors over Mermaid's inline
 * strokes so a theme toggle does not wait for a second render.
 */

export type DiagramPalette = {
  dark: boolean
  text: string
  line: string
  fill: string
  border: string
  surface: string
  cluster: string
}

const DARK: Omit<DiagramPalette, 'dark'> = {
  text: 'rgb(247, 245, 240)',
  line: 'rgb(196, 191, 180)',
  fill: 'rgb(56, 55, 53)',
  border: 'rgb(172, 167, 156)',
  surface: 'rgb(43, 42, 41)',
  cluster: 'rgb(74, 72, 70)',
}

const LIGHT: Omit<DiagramPalette, 'dark'> = {
  text: 'rgb(26, 24, 20)',
  line: 'rgb(87, 83, 74)',
  fill: 'rgb(237, 236, 232)',
  border: 'rgb(107, 102, 92)',
  surface: 'rgb(255, 255, 255)',
  cluster: 'rgb(212, 210, 203)',
}

function channelsToRgb(raw: string): string {
  const channels = raw.split('/')[0]?.trim() ?? ''
  const parts = channels.split(/\s+/).map((part) => Number(part))
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return ''
  return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`
}

export function diagramPalette(
  read: (name: string) => string,
  dark: boolean,
): DiagramPalette {
  const fallback = dark ? DARK : LIGHT
  const pick = (name: string, backup: string) => channelsToRgb(read(name)) || backup
  return {
    dark,
    text: pick('--color-text-heading', fallback.text),
    line: pick('--color-text-secondary', fallback.line),
    fill: pick('--color-bg-hover', fallback.fill),
    border: pick('--color-text-muted', fallback.border),
    surface: pick('--color-bg-surface', fallback.surface),
    cluster: pick('--color-border-light', fallback.cluster),
  }
}

export function readDiagramPalette(root: Element | null): DiagramPalette {
  const theme = root?.getAttribute('data-theme')
  const dark = theme !== 'light'
  const style = root ? getComputedStyle(root) : null
  return diagramPalette((name) => style?.getPropertyValue(name) ?? '', dark)
}

export function mermaidInitConfig(palette: DiagramPalette) {
  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    htmlLabels: false,
    fontFamily: 'Geist, system-ui, sans-serif', // design-system-ignore: mermaid init string, not Tailwind
    theme: 'base' as const,
    themeVariables: {
      darkMode: palette.dark,
      background: 'transparent',
      fontFamily: 'Geist, system-ui, sans-serif', // design-system-ignore: mermaid themeVariables string
      fontSize: '14px',
      primaryColor: palette.fill,
      primaryTextColor: palette.text,
      primaryBorderColor: palette.border,
      secondaryColor: palette.surface,
      secondaryTextColor: palette.text,
      secondaryBorderColor: palette.border,
      tertiaryColor: palette.surface,
      tertiaryTextColor: palette.text,
      tertiaryBorderColor: palette.border,
      lineColor: palette.line,
      textColor: palette.text,
      mainBkg: palette.fill,
      nodeBorder: palette.border,
      nodeTextColor: palette.text,
      clusterBkg: palette.surface,
      clusterBorder: palette.cluster,
      edgeLabelBackground: palette.surface,
      titleColor: palette.text,
      actorBkg: palette.fill,
      actorBorder: palette.border,
      actorTextColor: palette.text,
      actorLineColor: palette.line,
      signalColor: palette.line,
      signalTextColor: palette.text,
      labelBoxBkgColor: palette.surface,
      labelBoxBorderColor: palette.cluster,
      labelTextColor: palette.text,
      loopTextColor: palette.text,
      noteBkgColor: palette.surface,
      noteTextColor: palette.text,
      noteBorderColor: palette.cluster,
      activationBkgColor: palette.fill,
      activationBorderColor: palette.border,
      sequenceNumberColor: palette.text,
    },
    flowchart: {
      curve: 'basis' as const,
      padding: 14,
      nodeSpacing: 40,
      rankSpacing: 48,
      htmlLabels: false,
      diagramPadding: 8,
    },
  }
}
