import { describe, expect, it } from 'vitest'
import { missingRequiredStageFields, type TicketStage } from './tickets-api'

const klaar: TicketStage = {
  key: 'klaar',
  name: 'Klaar',
  kind: 'done',
  fields: [
    { key: 'eindoordeel', name: 'Eindoordeel', type: 'text', required: true },
    { key: 'note', name: 'Note', type: 'text' },
  ],
}

describe('missingRequiredStageFields', () => {
  it('lists empty required fields on the target stage', () => {
    expect(missingRequiredStageFields(klaar, {}).map((field) => field.key)).toEqual(['eindoordeel'])
    expect(missingRequiredStageFields(klaar, { eindoordeel: '  ' }).map((field) => field.key)).toEqual([
      'eindoordeel',
    ])
    expect(missingRequiredStageFields(klaar, { eindoordeel: 'Opgelost' })).toEqual([])
    const open: TicketStage = { key: 'open', name: 'Open', kind: 'open' }
    expect(missingRequiredStageFields(open, {})).toEqual([])
  })
})
