import type { ReactNode } from 'react'
import {
  Badge,
  BarChart,
  Callout,
  Card,
  Divider,
  Grid,
  Heading,
  LineChart,
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

function parseSeries(raw: unknown): { name: string; points: { x: string; y: number }[] }[] {
  if (!Array.isArray(raw)) return []
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
        return text ? <span key={idx}>{text}</span> : null
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
  if (type === 'Text') return <Text text={asString(prop(node, 'text'))}>{children}</Text>
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
        source={asString(prop(node, 'source'))}
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
      <Table title={asString(prop(node, 'title'))} columns={columns} rows={rows} source={asString(prop(node, 'source'))} />
    )
  }
  if (type === 'BarChart' || type === 'LineChart') {
    const Chart = type === 'LineChart' ? LineChart : BarChart
    return (
      <Chart
        title={asString(prop(node, 'title'))}
        xLabel={asString(prop(node, 'xLabel') || prop(node, 'x_label'))}
        yLabel={asString(prop(node, 'yLabel') || prop(node, 'y_label'))}
        source={asString(prop(node, 'source'))}
        series={parseSeries(prop(node, 'series'))}
      />
    )
  }
  return children.length ? <>{children}</> : null
}
