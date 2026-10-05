/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderCanvasTree } from './render'
import type { CanvasNode } from './types'

describe('renderCanvasTree', () => {
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

  it('ignores unknown types and still renders children', () => {
    const tree: CanvasNode = {
      type: 'Iframe',
      children: [{ type: 'Text', props: { text: 'Still here' } }],
    }
    render(<>{renderCanvasTree(tree)}</>)
    expect(screen.getByText('Still here')).toBeTruthy()
  })
})
