/** @vitest-environment jsdom */
import '../../i18n'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderCanvasTree } from './render'
import type { CanvasNode } from './types'

describe('renderCanvasTree', () => {
  it('hides leftover JSX brace text', () => {
    const tree: CanvasNode = {
      type: 'Stack',
      children: [
        { type: 'Text', props: { text: '{}' } },
        { type: 'Heading', props: { text: 'Test Dashboard', level: 1 } },
        { type: 'Text', props: { text: '{}' } },
      ],
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByText('Test Dashboard')).toBeTruthy()
    expect(screen.queryByText('{}')).toBeNull()
  })

  it('renders Stat and Table', () => {
    const tree: CanvasNode = {
      type: 'Stack',
      children: [
        { type: 'Stat', props: { title: 'Open items', value: '4', unit: 'items' } },
        {
          type: 'Table',
          props: {
            title: 'Queue',
            columns: ['Title', 'Status'],
            rows: [['Fix login', 'open']],
          },
        },
      ],
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByText('Open items')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText('Fix login')).toBeTruthy()
  })

  it('shows a number source after one tap', () => {
    const tree: CanvasNode = {
      type: 'Stat',
      props: {
        label: 'Open',
        value: '4',
        source: { tool: 'list_threads', tool_use_id: 'toolu_1', as_of: '2026-10-22T17:00:00' },
      },
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.queryByTestId('canvas-source')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /4/ }))
    expect(screen.getByTestId('canvas-source').textContent).toContain('list_threads · ')
    expect(screen.getByTestId('canvas-source').textContent).not.toContain('T17:00:00')
  })

  it('renders a KPI tile with delta, status and target', () => {
    const tree: CanvasNode = {
      type: 'Grid',
      props: { columns: 3, auto: true },
      children: [
        {
          type: 'Stat',
          props: { label: 'Bruto', value: 'EUR 84k', delta: '+12%', trend: 'up', status: 'good', target: 'EUR 75k', tile: true },
        },
      ],
    }
    const { container } = render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByText('+12%').closest('span')?.className).toContain('text-status-success')
    expect(screen.getByText(/EUR 75k/)).toBeTruthy()
    expect(container.querySelector('.rounded-xl.border')).toBeTruthy()
  })

  it('maps callout tones from the server', () => {
    render(<>{renderCanvasTree({ type: 'Callout', props: { text: 'Marge onder druk', tone: 'warning' } })}</>)
    expect(screen.getByText('Marge onder druk').closest('div.rounded-lg')?.className).toContain('status-warning')
  })

  it('renders a bar chart and skips empty series', () => {
    const tree: CanvasNode = {
      type: 'BarChart',
      props: {
        title: 'Throughput',
        xLabel: 'Week',
        yLabel: 'Items',
        series: [
          { name: 'Done', points: [] },
          {
            name: 'Shipped',
            points: [
              { x: 'W1', y: 2 },
              { x: 'W2', y: 5 },
            ],
          },
        ],
      },
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByText('Throughput')).toBeTruthy()
    expect(screen.getByText('W1')).toBeTruthy()
  })

  it('renders row-shaped series as one chart', () => {
    const tree: CanvasNode = {
      type: 'BarChart',
      props: {
        title: 'Omzet',
        series: [
          { month: 'Jan', value: 10 },
          { month: 'Feb', value: 20 },
        ],
      },
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByText('Omzet')).toBeTruthy()
    expect(screen.getByText('Jan')).toBeTruthy()
  })

  it('renders a pie chart from slices', () => {
    const tree: CanvasNode = {
      type: 'PieChart',
      props: {
        title: 'Verdeling',
        slices: [
          { name: 'Laag', value: 25 },
          { name: 'Hoog', value: 75 },
        ],
      },
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByText('Verdeling')).toBeTruthy()
  })

  it('draws a chart that has data but no title', () => {
    const tree: CanvasNode = {
      type: 'BarChart',
      props: {
        series: [{ name: 'Aantal', points: [{ x: '1', y: 3 }] }],
      },
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.queryByTestId('canvas-notice')).toBeNull()
  })

  it('shows a notice when a chart has no data', () => {
    const tree: CanvasNode = {
      type: 'BarChart',
      props: { title: 'Leeg', series: [] },
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByTestId('canvas-notice')).toBeTruthy()
  })

  it('ignores unknown types and still renders children', () => {
    const tree: CanvasNode = {
      type: 'Iframe',
      children: [{ type: 'Text', props: { text: 'Still here' } }],
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByText('Still here')).toBeTruthy()
  })
})
