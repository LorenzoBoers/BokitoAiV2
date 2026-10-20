export const iconNames = [
  'send',
  'stop',
  'plus',
  'search',
  'inbox',
  'calendar',
  'user',
  'sparkles',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'mail',
  'ticket',
  'note',
  'mic',
  'paperclip',
  'x',
  'check',
] as const

export type IconName = (typeof iconNames)[number]
