import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import EmptyState from '../src/components/EmptyState'
import { useCopy } from '../src/context/LocaleContext'
import { useTheme, useThemedStyles } from '../src/context/ThemeContext'
import { messagingKeys, useNotifications } from '../src/hooks/useMessagingQueries'
import { markAllNotificationsRead, markNotificationRead, type AppNotification } from '../src/lib/api'
import { relativeTime, translateKnownText } from '../src/lib/format'
import { openNotificationRoute, routeFromAppNotification } from '../src/lib/notification-routing'
import { radius, spacing, type ColorTokens } from '../src/theme'

export default function NotificationsScreen() {
  const { t, locale } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(notificationStyles)
  const queryClient = useQueryClient()
  const { data = [], isLoading, isError, refetch, isRefetching } = useNotifications()

  const open = async (item: AppNotification) => {
    if (item.status === 'unread') {
      try {
        await markNotificationRead(item.id)
        await queryClient.invalidateQueries({ queryKey: messagingKeys.notifications })
      } catch {
        // still navigate
      }
    }
    openNotificationRoute(routeFromAppNotification(item))
  }

  const markAll = async () => {
    try {
      await markAllNotificationsRead()
      await queryClient.invalidateQueries({ queryKey: messagingKeys.notifications })
    } catch {
      Alert.alert(t('notifications.markAllFailed'))
    }
  }

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: t('notifications.title'),
          headerRight: () =>
            data.some((item) => item.status === 'unread') ? (
              <Pressable onPress={() => void markAll()} hitSlop={8}>
                <Text style={styles.markAll}>{t('notifications.markAll')}</Text>
              </Pressable>
            ) : null,
        }}
      />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.accent} />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => void open(item)}>
              <View style={styles.rowBody}>
                <Text style={[styles.title, item.status === 'unread' && styles.unread]} numberOfLines={1}>
                  {translateKnownText(item.title, locale)}
                </Text>
                {item.body ? (
                  <Text style={styles.body} numberOfLines={2}>
                    {translateKnownText(item.body, locale)}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.time}>{relativeTime(item.created_at, locale)}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              title={isError ? t('notifications.error') : t('notifications.empty')}
              body={isError ? undefined : t('notifications.emptyHint')}
              actionLabel={isError ? t('common.retry') : undefined}
              onAction={isError ? () => void refetch() : undefined}
            />
          }
        />
      )}
    </View>
  )
}

function notificationStyles(colors: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  markAll: { color: colors.accentInk, fontSize: 13, fontWeight: '600', marginRight: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  rowBody: { flex: 1, gap: 4 },
  title: { color: colors.textPrimary, fontSize: 15 },
  unread: { color: colors.textHeading, fontWeight: '700' },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  time: { color: colors.textMuted, fontSize: 11 },
  }
}
