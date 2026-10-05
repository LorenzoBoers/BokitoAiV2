import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetLiveStoreForTests,
  applyLive,
  emitEntityChange,
  getLive,
  isLiveSeeded,
  listLive,
  onEntityChange,
  removeLive,
  seedLive,
  subscribeLive,
} from './live-store'

type Row = { id: string; name: string }

describe('live-store', () => {
  beforeEach(() => __resetLiveStoreForTests())

  it('seeds, patches and removes rows with stable list identity between changes', () => {
    expect(isLiveSeeded('row')).toBe(false)
    seedLive<Row>('row', [{ id: 'a', name: 'A' }], (r) => r.id)
    expect(isLiveSeeded('row')).toBe(true)
    const first = listLive<Row>('row')
    expect(listLive<Row>('row')).toBe(first)

    applyLive<Row>('row', 'b', { id: 'b', name: 'B' })
    const second = listLive<Row>('row')
    expect(second).not.toBe(first)
    expect(second.map((r) => r.id)).toEqual(['a', 'b'])

    applyLive<Row>('row', 'a', (prev) => (prev ? { ...prev, name: 'A2' } : prev))
    expect(getLive<Row>('row', 'a')?.name).toBe('A2')

    removeLive('row', 'a')
    expect(getLive<Row>('row', 'a')).toBeNull()
  })

  it('does not notify when an updater returns the previous row', () => {
    seedLive<Row>('row', [{ id: 'a', name: 'A' }], (r) => r.id)
    const listener = vi.fn()
    const off = subscribeLive('row', listener)
    expect(applyLive<Row>('row', 'a', (prev) => prev)).toBe(false)
    expect(listener).not.toHaveBeenCalled()
    applyLive<Row>('row', 'a', { id: 'a', name: 'B' })
    expect(listener).toHaveBeenCalledTimes(1)
    off()
  })

  it('routes entity changes only to matching listeners', () => {
    const triggers = vi.fn()
    const teams = vi.fn()
    const offA = onEntityChange('trigger', triggers)
    const offB = onEntityChange(['team', 'project'], teams)
    emitEntityChange({ entity: 'trigger', id: 't1', op: 'created', row: null })
    emitEntityChange({ entity: 'project', id: 'p1', op: 'updated', row: null })
    expect(triggers).toHaveBeenCalledTimes(1)
    expect(teams).toHaveBeenCalledTimes(1)
    offA()
    offB()
    emitEntityChange({ entity: 'trigger', id: 't2', op: 'deleted', row: null })
    expect(triggers).toHaveBeenCalledTimes(1)
  })
})
