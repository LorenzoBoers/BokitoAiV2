import { describe, expect, it } from 'vitest'
import { splitAvatarStack } from './AvatarStack'

describe('splitAvatarStack', () => {
  it('shows every face when there are three or fewer', () => {
    expect(splitAvatarStack(['a'])).toEqual({ shown: ['a'], overflow: 0 })
    expect(splitAvatarStack(['a', 'b'])).toEqual({ shown: ['a', 'b'], overflow: 0 })
    expect(splitAvatarStack(['a', 'b', 'c'])).toEqual({ shown: ['a', 'b', 'c'], overflow: 0 })
  })

  it('uses the third circle as +N once there are more than three', () => {
    expect(splitAvatarStack(['a', 'b', 'c', 'd'])).toEqual({
      shown: ['a', 'b'],
      overflow: 2,
    })
    expect(splitAvatarStack(['a', 'b', 'c', 'd', 'e'])).toEqual({
      shown: ['a', 'b'],
      overflow: 3,
    })
  })
})
