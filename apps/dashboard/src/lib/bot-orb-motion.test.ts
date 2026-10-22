import { describe, expect, it } from 'vitest'
import {
  BOT_ORB_MS,
  closingOrbPulse,
  decisionOrbPulse,
  errorOrbPulse,
  isBotOrbBusyLoop,
  isBotOrbMotion,
  isBotOrbOneShot,
  oneShotDurationMs,
  presenceOrbMotion,
  resolveBotOrbDrive,
  wakeOrbPulse,
} from './bot-orb-motion'

describe('bot-orb-motion', () => {
  it('classifies one-shots and busy loops', () => {
    expect(isBotOrbOneShot('yes')).toBe(true)
    expect(isBotOrbOneShot('thinking')).toBe(false)
    expect(isBotOrbBusyLoop('writing')).toBe(true)
    expect(isBotOrbMotion('typing')).toBe(false)
    expect(isBotOrbBusyLoop('idle')).toBe(false)
  })

  it('treats the new tool moods as busy and the end reactions as one-shots', () => {
    for (const motion of ['searching', 'writing', 'sending'] as const) {
      expect(isBotOrbBusyLoop(motion)).toBe(true)
    }
    expect(isBotOrbBusyLoop('listening')).toBe(false)
    expect(isBotOrbOneShot('done')).toBe(true)
    expect(isBotOrbOneShot('leave')).toBe(true)
    expect(isBotOrbMotion('leave')).toBe(true)
    expect(isBotOrbMotion('dance')).toBe(false)
    expect(isBotOrbMotion(3)).toBe(false)
  })

  it('keeps every one-shot inside the pulse store window', () => {
    expect(oneShotDurationMs('yes')).toBe(BOT_ORB_MS.yes)
    for (const shot of ['yes', 'no', 'alert', 'jump', 'done', 'leave'] as const) {
      expect(oneShotDurationMs(shot)).toBeLessThan(2000)
    }
  })

  it('builds a closing pulse only for one-shots', () => {
    expect(closingOrbPulse('done', 's1')).toEqual({ motion: 'done', pulseId: 'closing-done-s1' })
    expect(closingOrbPulse('thinking', 's1')).toBeNull()
    expect(closingOrbPulse(null, 's1')).toBeNull()
  })

  it('maps presence to working or idle (error is corner-only)', () => {
    expect(presenceOrbMotion('working')).toBe('working')
    expect(presenceOrbMotion('standby')).toBe('idle')
    expect(presenceOrbMotion('error')).toBe('idle')
  })

  it('builds decision / error / wake pulses', () => {
    expect(decisionOrbPulse('approved').motion).toBe('yes')
    expect(decisionOrbPulse('rejected').motion).toBe('no')
    expect(errorOrbPulse('e1')).toEqual({ motion: 'alert', pulseId: 'e1' })
    expect(wakeOrbPulse('w1')).toEqual({ motion: 'jump', pulseId: 'w1' })
  })

  it('resolves drive priority: one-shot > live > presence > idle', () => {
    expect(
      resolveBotOrbDrive({
        oneShot: decisionOrbPulse('approved'),
        live: 'thinking',
        presence: 'working',
      }).motion,
    ).toBe('yes')
    expect(resolveBotOrbDrive({ live: 'writing', presence: 'working' }).motion).toBe('writing')
    expect(resolveBotOrbDrive({ presence: 'working' }).motion).toBe('working')
    expect(resolveBotOrbDrive({}).motion).toBe('idle')
  })
})
