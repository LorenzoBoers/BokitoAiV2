import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_DEFAULT_PATH,
  assistantSettingsCanonicalPath,
  assistantSettingsPath,
  parseAssistantSettingsParams,
} from './assistant-settings-path'

describe('assistant settings paths', () => {
  it('maps the website widget to external hours and look', () => {
    expect(assistantSettingsPath('internal', 'hours')).toBe('/ai/assistant/external/hours')
    expect(parseAssistantSettingsParams('external', 'agent')?.section).toBe('hours')
    expect(assistantSettingsCanonicalPath('internal', 'agent')).toBe('/ai/assistant/external/hours')
    expect(assistantSettingsCanonicalPath('nope', 'look')).toBe(ASSISTANT_DEFAULT_PATH)
  })
})
