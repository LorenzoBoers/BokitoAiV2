import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { AgentStep } from '../hooks/useSignalStream'
import {
  currentActivityHeadline,
  formatStepDetail,
  stepHeadline,
  stepLabel,
} from '../lib/agentSteps'
import { colors, spacing } from '../theme'
import ShimmerText from './ShimmerText'

type Props = {
  steps: AgentStep[]
  active?: boolean
  compact?: boolean
}

export default function ThinkingTrace({ steps, active = false, compact = false }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (steps.length === 0 && !active) return null

  const headline = currentActivityHeadline(steps, active)
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
              <Text style={styles.logLabel}>{stepLabel(step)}</Text>
              <Text style={styles.logTitle}>{stepHeadline(step)}</Text>
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

const styles = StyleSheet.create({
  root: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  rootCompact: {
    marginBottom: spacing.xs,
    borderRadius: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  logTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  logDetail: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
})
