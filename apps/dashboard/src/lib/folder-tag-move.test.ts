import { describe, expect, it } from 'vitest'
import {
  findExactTagFolder,
  optimisticMoveTag,
  optimisticRemoveTag,
  parseTagDragId,
  tagDragId,
} from './folder-tag-move'

describe('folder-tag-move', () => {
  it('round-trips tag drag ids', () => {
    const id = tagDragId('folder-1', 'reclame')
    expect(parseTagDragId(id)).toEqual({ folderId: 'folder-1', tag: 'reclame' })
    expect(parseTagDragId(tagDragId('a', 'with space'))).toEqual({
      folderId: 'a',
      tag: 'with space',
    })
  })

  it('moves a tag between folders and blocks emptying the source', () => {
    const sources = [
      {
        id: 'a',
        name: 'a',
        tag_ids: ['p', 'ad', 'r'],
        tag_names: ['bokito_platform', 'administratie', 'reclame'],
      },
      { id: 'b', name: 'b', tag_ids: ['ad'], tag_names: ['administratie'] },
    ]
    const moved = optimisticMoveTag(sources, 'a', 'b', 'reclame')
    expect(moved?.find((row) => row.id === 'a')).toMatchObject({
      tag_names: ['bokito_platform', 'administratie'],
      tag_ids: ['p', 'ad'],
    })
    expect(moved?.find((row) => row.id === 'b')).toMatchObject({
      tag_names: ['administratie', 'reclame'],
      tag_ids: ['ad', 'r'],
    })
    expect(optimisticMoveTag(sources, 'b', 'a', 'administratie')).toBeNull()
  })

  it('removes a tag for root moves and finds an exact single-tag folder', () => {
    const sources = [
      {
        id: 'nested',
        name: 'nested',
        tag_ids: ['p', 'r'],
        tag_names: ['bokito_platform', 'reclame'],
      },
      { id: 'solo', name: 'solo', tag_ids: ['r'], tag_names: ['reclame'] },
    ]
    expect(findExactTagFolder(sources, 'reclame')?.id).toBe('solo')
    const stripped = optimisticRemoveTag(sources, 'nested', 'reclame')
    expect(stripped?.find((row) => row.id === 'nested')).toMatchObject({
      tag_names: ['bokito_platform'],
      tag_ids: ['p'],
    })
  })
})
