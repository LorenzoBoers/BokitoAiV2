import type { ReactNode } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Icon } from '../Icon'
import { Text } from '../Text'
import { useTokens } from '../theme'

export function ComposerBar({
  value,
  onChangeText,
  placeholder,
  onSend,
  onStop,
  streaming = false,
  canSend = false,
  left,
  above,
  input,
  trailing,
  note = false,
  ai = false,
}: {
  value: string
  onChangeText: (next: string) => void
  placeholder?: string
  onSend?: () => void
  onStop?: () => void
  streaming?: boolean
  canSend?: boolean
  left?: ReactNode
  above?: ReactNode
  input?: ReactNode
  trailing?: ReactNode
  note?: boolean
  ai?: boolean
}) {
  const tokens = useTokens()
  const border = note
    ? tokens.color.border
    : ai
      ? tokens.color.ai
      : tokens.color.border
  return (
    <View style={{ gap: tokens.spacing.sm }}>
      {above}
      <View
        style={{
          borderWidth: 1,
          borderColor: border,
          borderRadius: 12,
          backgroundColor: tokens.color.bgElevated,
          paddingHorizontal: 12,
          paddingTop: 12,
          paddingBottom: 8,
          gap: 8,
        }}
      >
        <View style={{ minHeight: 44 }}>
          {input ?? (
            <TextInput
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={tokens.color.textMuted}
              multiline
              style={{
                maxHeight: 140,
                minHeight: 44,
                color: tokens.color.textPrimary,
                fontSize: tokens.fontSize.base.fontSize,
                lineHeight: tokens.fontSize.base.lineHeight,
                fontFamily: tokens.fontFamily.sansNative,
                padding: 0,
                textAlignVertical: 'top',
              }}
            />
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {left ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{left}</View> : null}
          <View style={{ flex: 1 }} />
          {trailing ?? (
            <Pressable
              accessibilityLabel={streaming ? 'Stop' : 'Send'}
              onPress={streaming ? onStop : onSend}
              disabled={!streaming && !canSend}
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: streaming || canSend ? tokens.color.accent : tokens.color.bgHover,
                opacity: streaming || canSend ? 1 : 0.55,
              }}
            >
              <Icon name={streaming ? 'stop' : 'send'} color={tokens.color.accentFg} size={15} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}

/** Quiet mode pill — same role as the web reply / note chips above the composer. */
export function ComposerMode({
  label,
  active,
  onPress,
  tone = 'default',
}: {
  label: string
  active?: boolean
  onPress?: () => void
  tone?: 'default' | 'note' | 'ai'
}) {
  const tokens = useTokens()
  const activeBorder =
    tone === 'note' ? tokens.color.statusWarning : tone === 'ai' ? tokens.color.ai : tokens.color.border
  const activeFg =
    tone === 'note' ? 'statusWarning' : tone === 'ai' ? 'aiInk' : 'textHeading'
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: active ? activeBorder : 'transparent',
        backgroundColor: active ? tokens.color.bgHover : 'transparent',
        borderRadius: tokens.radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
    >
      <Text variant="xs" tone={active ? activeFg : 'textMuted'}>
        {label}
      </Text>
    </Pressable>
  )
}
