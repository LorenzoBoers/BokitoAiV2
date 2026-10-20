import { describe, expect, it } from 'vitest'
import type { OrgFlow, OrgFlowNode } from './org-flow-api'
import {
  MODE_STYLE,
  columnHeight,
  crossesFlowCard,
  emphasis,
  isLit,
  layoutOrgFlow2D,
  layoutOrgFlow3D,
  openStack,
  pathWidth,
} from './org-flow-layout'

function node(id: string, layer: OrgFlowNode['layer'], kind: OrgFlowNode['kind'], extra: Partial<OrgFlowNode> = {}): OrgFlowNode {
  return { id, layer, kind, label: id, href: null, count: 1, open: 0, open_by_label: {}, issues: [], ...extra }
}

function fixture(): OrgFlow {
  return {
    days: 7,
    since: '2026-10-13T00:00:00Z',
    layers: ['input', 'executor', 'work', 'result'],
    zones: [
      { id: 'dept-a', label: 'Klantenservice', href: null, hint: 'agent_first' },
      { id: 'dept-b', label: 'Sales', href: null, hint: 'people' },
      { id: 'none', label: '', href: null, hint: '' },
    ],
    nodes: [
      node('channel:mail', 'input', 'channel', { count: 30 }),
      node('channel:wa', 'input', 'channel', { count: 10 }),
      node('agent:1', 'executor', 'agent', { count: 25, zones: ['dept-a', 'dept-b'], open: 6, open_by_label: { t1: 4, none: 2 } }),
      node('user:1', 'executor', 'user', { count: 8, zones: ['dept-b'] }),
      node('user:2', 'executor', 'user', { count: 3, zones: [] }),
      node('executor:unassigned', 'executor', 'unassigned', { count: 4 }),
      node('flow:1', 'work', 'flow', { count: 12 }),
      node('flow:2', 'work', 'flow', { count: 5 }),
      node('result:reply', 'result', 'reply', { count: 20 }),
      node('folder:1', 'result', 'folder', { count: 6, works_in: [] }),
      node('result:knowledge', 'result', 'knowledge', { count: 2 }),
      node('result:open', 'result', 'sink_open', { count: 9 }),
      node('result:closed_without_result', 'result', 'sink_closed_without_result', { count: 1 }),
    ],
    paths: [
      { source: 'channel:mail', target: 'agent:1', count: 25, mode: 'autonomous', by_label: { t1: 20, none: 5 } },
      { source: 'channel:wa', target: 'user:1', count: 8, mode: 'human', by_label: { none: 8 } },
      { source: 'agent:1', target: 'flow:1', count: 12, mode: 'assisted', by_label: { t1: 12 } },
      { source: 'agent:1', target: 'result:reply', count: 13, mode: 'autonomous', by_label: { t1: 8, none: 5 } },
      { source: 'user:1', target: 'result:reply', count: 7, mode: 'human', by_label: { none: 7 } },
      { source: 'flow:1', target: 'folder:1', count: 6, mode: 'assisted', by_label: { t1: 6 } },
      { source: 'executor:unassigned', target: 'result:open', count: 4, mode: 'none', by_label: { none: 4 } },
      { source: 'result:reply', target: 'result:knowledge', count: 2, mode: 'human', by_label: { none: 2 } },
    ],
    labels: [
      { id: 't1', name: 'Offerte', color: 'sky', flow_id: 'f1' },
      { id: null, name: '', color: 'neutral', flow_id: null },
    ],
    estimated: false,
    issues: [],
  }
}

describe('layoutOrgFlow2D', () => {
  it('places each layer in its own column, busiest first', () => {
    const layout = layoutOrgFlow2D(fixture())
    const card = (id: string) => layout.cards.find((c) => c.nodeId === id && !c.ghost)!
    expect(card('channel:mail').x).toBeLessThan(card('agent:1').x)
    expect(card('agent:1').x).toBeLessThan(card('flow:1').x)
    expect(card('flow:1').x).toBeLessThan(card('result:reply').x)
    expect(card('channel:mail').y).toBeLessThan(card('channel:wa').y)
    expect(card('flow:1').y).toBeLessThan(card('flow:2').y)
  })

  it('draws a ghost card in the second department and a zone for people without one', () => {
    const layout = layoutOrgFlow2D(fixture())
    const agentCards = layout.cards.filter((c) => c.nodeId === 'agent:1')
    expect(agentCards).toHaveLength(2)
    expect(agentCards.find((c) => c.ghost)?.zoneId).toBe('dept-b')
    expect(layout.zones.map((z) => z.id)).toEqual(['dept-a', 'dept-b', 'none'])
    expect(layout.zones.find((z) => z.id === 'none')?.none).toBe(true)
  })

  it('routes lines without a flow above the flow column', () => {
    const layout = layoutOrgFlow2D(fixture())
    const laned = layout.paths.filter((p) => p.laned)
    expect(laned.map((p) => p.id).sort()).toEqual(['agent:1->result:reply', 'executor:unassigned->result:open', 'user:1->result:reply'])
    for (const path of laned) expect(crossesFlowCard(layout, path)).toBe(false)
  })

  it('draws knowledge as a separate line, not a regular path', () => {
    const layout = layoutOrgFlow2D(fixture())
    expect(layout.knowledgeLine).not.toBeNull()
    expect(layout.paths.some((p) => p.target === 'result:knowledge')).toBe(false)
  })

  it('splits paths into label strips whose widths add up', () => {
    const layout = layoutOrgFlow2D(fixture(), { labels: true })
    const path = layout.paths.find((p) => p.id === 'channel:mail->agent:1')!
    expect(path.strips.map((s) => s.labelKey)).toEqual(['t1', 'none'])
    const total = path.strips.reduce((sum, s) => sum + s.width, 0)
    expect(total).toBeCloseTo(path.width, 5)
    expect(path.strips[0].color).toBe('#38BDF8')
  })

  it('keeps one strip in mode colors outside the Labels lens', () => {
    const layout = layoutOrgFlow2D(fixture())
    const path = layout.paths.find((p) => p.id === 'channel:wa->user:1')!
    expect(path.strips).toHaveLength(1)
    expect(path.strips[0].color).toBe(MODE_STYLE.human.color)
  })
})

describe('mode style and widths', () => {
  it('gives each mode its own line', () => {
    expect(MODE_STYLE.autonomous.dash).toBeNull()
    expect(MODE_STYLE.assisted.dash).toBe('7 6')
    expect(MODE_STYLE.none.dash).toBe('2 5')
    expect(MODE_STYLE.human.color).not.toBe(MODE_STYLE.autonomous.color)
  })

  it('grows widths on a log scale within bounds', () => {
    expect(pathWidth(0)).toBe(1.5)
    expect(pathWidth(10)).toBeGreaterThan(pathWidth(2))
    expect(pathWidth(100000)).toBe(10)
  })

  it('caps column height', () => {
    expect(columnHeight(0)).toBe(0)
    expect(columnHeight(1_000_000)).toBe(4)
  })
})

describe('openStack', () => {
  it('orders open work per label, biggest first', () => {
    const data = fixture()
    const agent = data.nodes.find((n) => n.id === 'agent:1')!
    expect(openStack(agent, data.labels).map((s) => [s.key, s.count])).toEqual([
      ['t1', 4],
      ['none', 2],
    ])
  })
})

describe('emphasis', () => {
  it('lights a focused node, its paths and their other ends', () => {
    const e = emphasis(fixture(), 'flow', { focus: 'flow:1' })
    expect([...e.litPaths!].sort()).toEqual(['agent:1->flow:1', 'flow:1->folder:1'])
    expect(e.litNodes!.has('agent:1') && e.litNodes!.has('folder:1')).toBe(true)
    expect(e.litNodes!.has('channel:wa')).toBe(false)
  })

  it('dims everything without the isolated label', () => {
    const e = emphasis(fixture(), 'labels', { label: 't1' })
    expect(e.label).toBe('t1')
    expect(e.litPaths!.has('channel:wa->user:1')).toBe(false)
    expect(e.litPaths!.has('channel:mail->agent:1')).toBe(true)
    expect(isLit(e.litNodes, 'user:1')).toBe(false)
  })

  it('keeps only bottlenecks lit in the Bottlenecks lens', () => {
    const data = fixture()
    data.nodes.find((n) => n.id === 'executor:unassigned')!.issues = ['unassigned']
    const e = emphasis(data, 'issues')
    expect([...e.litNodes!]).toEqual(['executor:unassigned'])
    expect(e.litPaths!.has('executor:unassigned->result:open')).toBe(true)
    expect(e.litPaths!.has('channel:wa->user:1')).toBe(false)
  })

  it('dims nothing in the plain Flow lens', () => {
    const e = emphasis(fixture(), 'flow')
    expect(e.litNodes).toBeNull()
    expect(isLit(e.litPaths, 'anything')).toBe(true)
  })
})

describe('layoutOrgFlow3D', () => {
  it('bends Result back as a horseshoe that ends next to Intake', () => {
    const layout = layoutOrgFlow3D(fixture())
    const pos = (id: string) => layout.nodes.find((n) => n.nodeId === id && !n.ghost)!
    const results = layout.nodes.filter((n) => n.nodeId.startsWith('result:') || n.nodeId.startsWith('folder:'))
    const rowBottom = Math.max(...layout.nodes.filter((n) => !results.includes(n)).map((n) => n.z))
    for (const r of results) expect(r.z).toBeGreaterThan(rowBottom)
    const first = results[0]
    const last = results[results.length - 1]
    expect(Math.abs(first.x - pos('flow:1').x)).toBeLessThan(Math.abs(first.x - pos('channel:mail').x))
    expect(Math.abs(last.x - pos('channel:mail').x)).toBeLessThan(Math.abs(last.x - pos('flow:1').x))
    expect(layout.plates.map((p) => p.layer)).toEqual(['input', 'executor', 'work', 'result'])
  })
})
