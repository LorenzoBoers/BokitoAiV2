import { describe, expect, it } from 'vitest'
import { buildApiTokenCurl } from './api-token-curl'

describe('buildApiTokenCurl', () => {
  it('builds a same-origin public API example', () => {
    expect(buildApiTokenCurl('bk_test', 'https://app.bokito.nl')).toBe(
      'curl -sS "https://app.bokito.nl/api/public/v1/signals" -H "Authorization: Bearer bk_test"',
    )
  })
})
