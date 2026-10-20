import type { ReactNode } from 'react'
import { Pressable, View, type ViewStyle } from 'react-native'
import { chatRunCloses, chatRunLeads, type BubbleStack } from '@bokito/shared'
import { useTokens } from '../theme'

export type MessageVariant = 'self' | 'ai' | 'team' | 'customer' | 'note'

const RADIUS = 18
const TIGHT = 6

function cornerStyle(side: 'left' | 'right', stack: BubbleStack) {
  const base = {
    borderTopLeftRadius: RADIUS,
    borderTopRightRadius: RADIUS,
    borderBottomLeftRadius: RADIUS,
    borderBottomRightRadius: RADIUS,
  }
  if (side === 'left') {
    if (stack === 'start') return { ...base, borderTopLeftRadius: TIGHT, borderBottomLeftRadius: TIGHT }
    if (stack === 'middle') return { ...base, borderTopLeftRadius: TIGHT, borderBottomLeftRadius: TIGHT }
    if (stack === 'end') return { ...base, borderTopLeftRadius: TIGHT }
    return { ...base, borderTopLeftRadius: TIGHT }
  }
  if (stack === 'start') return { ...base, borderTopRightRadius: TIGHT, borderBottomRightRadius: TIGHT }
  if (stack === 'middle') return { ...base, borderTopRightRadius: TIGHT, borderBottomRightRadius: TIGHT }
  return { ...base, borderTopRightRadius: TIGHT }
}

export function MessageBubble({
  side,
  variant,
  stack = 'single',
  header,
  body,
  meta,
  actions,
  reactions,
  onPress,
}: {
  side: 'left' | 'right'
  variant: MessageVariant
  stack?: BubbleStack
  header?: ReactNode
  body: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  reactions?: ReactNode
  onPress?: () => void
}) {
  const tokens = useTokens()
  const lead = chatRunLeads(stack)
  const showMeta = meta != null && chatRunCloses(stack)
  const followUp = stack === 'middle' || stack === 'end'

  let cloudStyle: ViewStyle = {
    maxWidth: '85%',
    alignSelf: side === 'right' ? 'flex-end' : 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    overflow: 'hidden',
    ...cornerStyle(side, stack),
  }

  if (variant === 'self') {
    cloudStyle = {
      ...cloudStyle,
      backgroundColor: tokens.color.accent,
      shadowColor: tokens.color.textPrimary,
      shadowOpacity: 0.1,
      shadowRadius: 2,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    }
  } else if (variant === 'ai') {
    cloudStyle = {
      ...cloudStyle,
      backgroundColor: tokens.color.bgSurface,
      borderWidth: 1,
      borderColor: tokens.color.border,
      // Violet only as a soft leading edge, matching the web spine — not a full purple frame.
      borderLeftWidth: followUp ? 1 : 2,
      borderLeftColor: followUp ? tokens.color.border : tokens.color.ai,
      shadowColor: tokens.color.ai,
      shadowOpacity: followUp ? 0.12 : 0.22,
      shadowRadius: followUp ? 8 : 14,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    }
  } else if (variant === 'note') {
    cloudStyle = {
      ...cloudStyle,
      backgroundColor: tokens.color.bgHover,
      borderWidth: 1,
      borderColor: tokens.color.statusWarning,
    }
  } else if (variant === 'team') {
    cloudStyle = {
      ...cloudStyle,
      backgroundColor: tokens.color.bgElevated,
      borderWidth: 1,
      borderColor: tokens.color.border,
    }
  } else {
    cloudStyle = {
      ...cloudStyle,
      backgroundColor: tokens.color.bgSurface,
      borderWidth: 1,
      borderColor: tokens.color.border,
      shadowColor: tokens.color.textPrimary,
      shadowOpacity: 0.04,
      shadowRadius: 2,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    }
  }

  const cloud = (
    <View style={cloudStyle}>
      {variant === 'ai' && lead ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -20,
            left: -20,
            width: 120,
            height: 100,
            borderRadius: 80,
            backgroundColor: tokens.color.ai,
            opacity: 0.08,
          }}
        />
      ) : null}
      {lead ? header : null}
      {body}
      {showMeta || actions ? (
        <View
          style={{
            marginTop: 4,
            flexDirection: 'row',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {actions}
          {showMeta ? meta : null}
        </View>
      ) : null}
    </View>
  )

  return (
    <View style={{ alignSelf: side === 'right' ? 'flex-end' : 'flex-start', maxWidth: '100%' }}>
      {onPress ? <Pressable onPress={onPress}>{cloud}</Pressable> : cloud}
      {reactions}
    </View>
  )
}
