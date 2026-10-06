import { describe, expect, it } from 'vitest'
import { withNavReveal, stripNavReveal, hasNavReveal, sidebarSectionForLeaf } from './nav-reveal'

describe('nav reveal', () => {
  it('appends reveal=1 without dropping existing query or hash', () => {
    expect(withNavReveal('/communication/project/p1/open')).toBe(
      '/communication/project/p1/open?reveal=1',
    )
    expect(withNavReveal('/communication/tag/klacht/open?foo=1')).toBe(
      '/communication/tag/klacht/open?foo=1&reveal=1',
    )
    expect(withNavReveal('/communication/agent/a1#pane')).toBe(
      '/communication/agent/a1?reveal=1#pane',
    )
  })

  it('does not duplicate the flag', () => {
    expect(withNavReveal('/communication/project/p1/open?reveal=1')).toBe(
      '/communication/project/p1/open?reveal=1',
    )
  })

  it('strips the flag', () => {
    expect(hasNavReveal('?reveal=1')).toBe(true)
    expect(stripNavReveal('?reveal=1&foo=bar')).toBe('?foo=bar')
    expect(stripNavReveal('?reveal=1')).toBe('')
  })

  it('maps leaves to sidebar sections', () => {
    expect(sidebarSectionForLeaf({ type: 'project', projectId: 'p' })).toBe('projects')
    expect(sidebarSectionForLeaf({ type: 'tag', tag: 'klacht' })).toBe('hashtags')
    expect(sidebarSectionForLeaf({ type: 'agent', agentId: 'a' })).toBe('agents')
    expect(sidebarSectionForLeaf({ type: 'inbox' })).toBe(null)
  })
})
