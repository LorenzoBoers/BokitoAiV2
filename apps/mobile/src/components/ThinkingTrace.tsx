import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useCopy } from '../context/LocaleContext'
import { useTheme, useThemedStyles } from '../context/ThemeContext'
import type { AgentStep } from '../hooks/useSignalStream'
import {
  currentActivityHeadline,
  formatStepDetail,
  stepHeadline,
  stepLabel,
} from '../lib/agentSteps'
import { spacing, type ColorTokens } from '../theme'
import ShimmerText from './ShimmerText'

type Props = {
  steps: AgentStep[]
  active?: boolean
  compact?: boolean
}

export default function ThinkingTrace({ steps, active = false, compact = false }: Props) {
  const { locale } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(traceStyles)
  const [expanded, setExpanded] = useState(false)

  if (steps.length === 0 && !active) return null

  const headline = currentActivityHeadline(steps, active, locale)
  const canExpand = steps.length > 0

  return (
    <View style={[styles.root, compact && styles.rootCompact]}>
      <Pressable
        style={styles.header}
        onPress={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
      >
        <View style={styles.headerLeft}>
          {active ? (
            <ActivityIndicator size="small" color={colors.accent} style={styles.spinner} />
          ) : (
            <Ionicons name="sparkles-outline" size={14} color={colors.textMuted} style={styles.spinner} />
          )}
          <ShimmerText active={active} style={styles.headline}>
            {headline}
          </ShimmerText>
        </View>
        {canExpand ? (
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        ) : null}
      </Pressable>

      {expanded ? (
        <View style={styles.log}>
          {steps.map((step) => (
            <View key={step.id} style={styles.logRow}>
              <Text style={styles.logLabel}>{stepLabel(step, locale)}</Text>
              <Text style={styles.logTitle}>{stepHeadline(step, locale)}</Text>
              {formatStepDetail(step) ? (
                <Text style={styles.logDetail}>{formatStepDetail(step)}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function traceStyles(colors: ColorTokens) {
  return {
    root: {
      alignSelf: 'flex-start' as const,
      maxWidth: '92%' as const,
      backgroundColor: colors.elevated,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      overflow: 'hidden' as const,
      marginBottom: spacing.sm,
    },
    rootCompact: {
      marginBottom: spacing.xs,
      borderRadius: 10,
    },
    header: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
    },
    headerLeft: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      flex: 1,
      gap: spacing.sm,
    },
    spinner: { marginRight: 2 },
    headline: { flexShrink: 1 },
    log: {
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    logRow: {
      gap: 2,
      paddingTop: spacing.xs,
    },
    logLabel: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '700' as const,
      letterSpacing: 0.6,
      textTransform: 'uppercase' as const,
    },
    logTitle: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600' as const,
    },
    logDetail: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: 'monospace',
    },
  }
}
