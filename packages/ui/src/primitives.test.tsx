import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'
import { Badge } from './Badge'
import { UiThemeProvider } from './theme'

function renderWithTheme(node: ReactNode) {
  return render(<UiThemeProvider scheme="dark">{node}</UiThemeProvider>)
}

describe('primitives', () => {
  it('renders an empty state', () => {
    renderWithTheme(<EmptyState title="Nothing here" body="Start a conversation." />)
    expect(screen.getByText('Nothing here')).toBeTruthy()
    expect(screen.getByText('Start a conversation.')).toBeTruthy()
  })

  it('renders a badge label', () => {
    renderWithTheme(<Badge label="AI" tone="ai" />)
    expect(screen.getByText('AI')).toBeTruthy()
  })
})
