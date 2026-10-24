import { describe, expect, it } from 'vitest'
import { documentSource, numericColumns } from './CanvasKindBody'
import { diagramPalette, mermaidInitConfig } from './mermaid-theme'

describe('documentSource', () => {
  it('drops a leading heading that repeats the canvas title', () => {
    const source = '# Social trends\n\n## Inleiding\n\nTekst.'
    expect(documentSource(source, 'Social trends')).toBe('## Inleiding\n\nTekst.')
  })

  it('keeps a heading that is the document, not the title', () => {
    const source = '# Andere kop\n\nTekst.'
    expect(documentSource(source, 'Social trends')).toBe(source)
  })
})

describe('numericColumns', () => {
  it('marks a column of figures and leaves labels on the left', () => {
    const columns = ['Stad', 'Min']
    const rows = [
      ['Amsterdam', '9'],
      ['Rotterdam', '8'],
    ]
    expect(numericColumns(columns, rows)).toEqual([false, true])
  })
})

describe('diagramPalette', () => {
  it('uses the app text color for lines so they stay visible on a dark canvas', () => {
    const palette = diagramPalette(() => '', true)
    const config = mermaidInitConfig(palette)
    expect(config.themeVariables.lineColor).toBe('rgb(196, 191, 180)')
    expect(config.themeVariables.lineColor).not.toBe('#333333')
    expect(config.themeVariables.primaryBorderColor).toBe('rgb(172, 167, 156)')
    expect(config.flowchart.curve).toBe('basis')
  })

  it('reads a light theme token when the page is light', () => {
    const palette = diagramPalette((name) => (name === '--color-text-secondary' ? '87 83 74' : ''), false)
    expect(palette.line).toBe('rgb(87, 83, 74)')
    expect(palette.dark).toBe(false)
  })
})
