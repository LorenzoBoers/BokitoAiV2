import type { ReactNode } from 'react'
import i18n from '../../i18n'
import { formatAppDateTime } from '../app-locale'
import { CanvasNotice } from '../../components/project-canvas/sdk'
import {
  AreaChart,
  Badge,
  BarChart,
  Callout,
  Card,
  Divider,
  Grid,
  Heading,
  LineChart,
  PieChart,
  List,
  Row,
  Stack,
  Stat,
  Table,
  Text,
} from '../../components/project-canvas/sdk'
import { asNumber, asString, asStringList, type CanvasNode } from './types'

function prop(node: CanvasNode, key: string): unknown {
  return node.props?.[key]
}

function sourceTime(when: string): string {
  if (!when) return ''
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(when) ? when : `${when}Z`
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return when
  return formatAppDateTime(parsed, i18n.language)
}

function sourceLine(raw: unknown): string {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>
    const tool = asString(rec.tool)
    const label = tool === 'operator' ? i18n.t('projects.canvas.operatorSource', { ns: 'nav' }) : tool
    return [label, sourceTime(asString(rec.as_of))].filter((part) => part.length > 0).join(' · ')
  }
  return asString(raw)
}

function parseNumbers(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => asNumber(item, Number.NaN)).filter((item) => Number.isFinite(item))
}

function parseSlices(raw: unknown): { name: string; value: number }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      return {
        name: asString(rec.name ?? rec.label),
        value: asNumber(rec.value ?? rec.percentage ?? rec.y, Number.NaN),
      }
    })
    .filter((slice) => slice.name.length > 0 && Number.isFinite(slice.value))
}

function parseSeries(raw: unknown): { name: string; points: { x: string; y: number }[] }[] {
  if (!Array.isArray(raw)) return []
  const first = raw[0] && typeof raw[0] === 'object' ? (raw[0] as Record<string, unknown>) : {}
  const looksLikePoints = raw.length > 0 && !('points' in first) && !('values' in first)
  if (looksLikePoints) {
    return [
      {
        name: asString(first.name || first.label || 'Value'),
        points: raw.map((item) => {
          const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
          return {
            x: asString(rec.x ?? rec.label ?? rec.month ?? rec.name ?? rec.day ?? rec.product),
            y: asNumber(rec.y ?? rec.value ?? rec.sales ?? rec.activeUsers ?? rec.revenue),
          }
        }),
      },
    ]
  }
  return raw.map((item, idx) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const pointsRaw = Array.isArray(row.points) ? row.points : Array.isArray(row.values) ? row.values : []
    return {
      name: asString(row.name || row.label || `Series ${idx + 1}`),
      points: pointsRaw.map((pt) => {
        if (pt && typeof pt === 'object') {
          const rec = pt as Record<string, unknown>
          return { x: asString(rec.x ?? rec.label), y: asNumber(rec.y ?? rec.value) }
        }
        return { x: '', y: asNumber(pt) }
      }),
    }
  })
}

function renderChildren(node: CanvasNode): ReactNode[] {
  return (node.children ?? [])
    .map((child, idx) => {
      if (typeof child === 'string') {
        const text = child.trim()
        if (!text || !text.replace(/[{}\s]/g, '')) return null
        return <span key={idx}>{text}</span>
      }
      const rendered = renderCanvasTree(child)
      return rendered ? (
        <span key={idx} className="contents">
          {rendered}
        </span>
      ) : null
    })
    .filter(Boolean) as ReactNode[]
}

export function renderCanvasTree(node: CanvasNode | null | undefined): ReactNode {
  if (!node || typeof node !== 'object') return null
  const type = node.type
  const children = renderChildren(node)

  if (type === 'Stack') return <Stack>{children}</Stack>
  if (type === 'Row') return <Row>{children}</Row>
  if (type === 'Grid') return <Grid columns={asNumber(prop(node, 'columns'), 2)}>{children}</Grid>
  if (type === 'Card') return <Card title={asString(prop(node, 'title'))}>{children}</Card>
  if (type === 'Heading') {
    return (
      <Heading text={asString(prop(node, 'text'))} level={asNumber(prop(node, 'level'), 2)}>
        {children}
      </Heading>
    )
  }
  if (type === 'Text') {
    const raw = asString(prop(node, 'text'))
    if (!raw.replace(/[{}\s]/g, '')) return children.length ? <>{children}</> : null
    return <Text text={raw}>{children}</Text>
  }
  if (type === 'Callout') {
    return (
      <Callout text={asString(prop(node, 'text'))} tone={asString(prop(node, 'tone') || 'info')}>
        {children}
      </Callout>
    )
  }
  if (type === 'Divider') return <Divider />
  if (type === 'List') return <List items={asStringList(prop(node, 'items'))}>{children}</List>
  if (type === 'Badge') return <Badge text={asString(prop(node, 'text'))} label={asString(prop(node, 'label'))} />
  if (type === 'Stat') {
    return (
      <Stat
        title={asString(prop(node, 'title'))}
        label={asString(prop(node, 'label'))}
        value={asString(prop(node, 'value'))}
        unit={asString(prop(node, 'unit'))}
        hint={asString(prop(node, 'hint'))}
        source={sourceLine(prop(node, 'source'))}
        delta={asString(prop(node, 'delta'))}
        trend={asString(prop(node, 'trend'))}
        status={asString(prop(node, 'status'))}
        target={asString(prop(node, 'target'))}
        spark={parseNumbers(prop(node, 'spark'))}
        tile={prop(node, 'tile') === true}
      />
    )
  }
  if (type === 'Table') {
    const columns = asStringList(prop(node, 'columns'))
    const rowsRaw = Array.isArray(prop(node, 'rows')) ? (prop(node, 'rows') as unknown[]) : []
    const rows = rowsRaw
      .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []))
      .filter((row) => row.some((cell) => cell.length > 0))
    return (
      <Table title={asString(prop(node, 'title'))} columns={columns} rows={rows} source={sourceLine(prop(node, 'source'))} />
    )
  }
  if (type === 'BarChart' || type === 'LineChart' || type === 'AreaChart') {
    const Chart = type === 'LineChart' ? LineChart : type === 'AreaChart' ? AreaChart : BarChart
    return (
      <Chart
        title={asString(prop(node, 'title'))}
        xLabel={asString(prop(node, 'xLabel') || prop(node, 'x_label'))}
        yLabel={asString(prop(node, 'yLabel') || prop(node, 'y_label'))}
        source={sourceLine(prop(node, 'source'))}
        series={parseSeries(prop(node, 'series'))}
        stacked={prop(node, 'stacked') === true}
      />
    )
  }
  if (type === 'PieChart') {
    return (
      <PieChart
        title={asString(prop(node, 'title'))}
        source={sourceLine(prop(node, 'source'))}
        slices={parseSlices(prop(node, 'slices') ?? prop(node, 'series'))}
      />
    )
  }
  return (
    <>
      <CanvasNotice k="unknown" />
      {children}
    </>
  )
}
