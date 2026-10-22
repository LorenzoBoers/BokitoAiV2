/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
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

  it('ignores unknown types and still renders children', () => {
    const tree: CanvasNode = {
      type: 'Iframe',
      children: [{ type: 'Text', props: { text: 'Still here' } }],
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByText('Still here')).toBeTruthy()
  })
})
