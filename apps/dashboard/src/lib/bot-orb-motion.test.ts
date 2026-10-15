import { describe, expect, it } from 'vitest'
import {
  BOT_ORB_MS,
  decisionOrbPulse,
  errorOrbPulse,
  isBotOrbBusyLoop,
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
    expect(isBotOrbBusyLoop('typing')).toBe(true)
    expect(isBotOrbBusyLoop('idle')).toBe(false)
  })

  it('uses Lottie-inspired one-shot durations', () => {
    expect(oneShotDurationMs('yes')).toBe(BOT_ORB_MS.yes)
    expect(oneShotDurationMs('alert')).toBe(BOT_ORB_MS.alert)
    expect(BOT_ORB_MS.idleLoop).toBeGreaterThan(400)
    expect(BOT_ORB_MS.idleLoop).toBeLessThan(600)
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
    expect(resolveBotOrbDrive({ live: 'typing', presence: 'working' }).motion).toBe('typing')
    expect(resolveBotOrbDrive({ presence: 'working' }).motion).toBe('working')
    expect(resolveBotOrbDrive({}).motion).toBe('idle')
  })
})
