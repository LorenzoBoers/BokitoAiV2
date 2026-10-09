/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Chart } from './chart'

describe('Chart', () => {
  it('renders nothing when every series is empty', () => {
    const { container } = render(
      <Chart kind="bar" series={[{ name: 'Done', points: [] }]} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows a dashed placeholder when emptyLabel is set', () => {
    render(<Chart kind="area" series={[]} emptyLabel="No tokens yet" />)
    expect(screen.getByText('No tokens yet')).toBeTruthy()
  })

  it('renders an area sparkline for a quiet series with one peak', () => {
    expect(() =>
      render(
        <Chart
          kind="area"
          showAxes={false}
          series={[
            {
              name: 'Tokens',
              points: [
                { x: '10 sep', y: 0 },
                { x: '9 okt', y: 12 },
              ],
            },
          ]}
        />,
      ),
    ).not.toThrow()
  })

  it('exposes bar category labels without relying on plot layout', () => {
    render(
      <Chart
        kind="bar"
        series={[
          {
            name: 'Shipped',
            points: [
              { x: 'W1', y: 2 },
              { x: 'W2', y: 5 },
            ],
          },
        ]}
      />,
    )
    expect(screen.getByText('W1')).toBeTruthy()
    expect(screen.getByText('W2')).toBeTruthy()
  })
})
