import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { AgendaDayHeader, AgendaEmpty, AgendaItemRow } from '@bokito/ui'
import { useCopy } from '../../src/context/LocaleContext'
import { useTheme } from '../../src/context/ThemeContext'
import { listAgenda } from '../../src/lib/api'

function dayRange(offset: number): { from: string; to: string; label: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() + offset)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    label: start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  }
}

export default function AgendaScreen() {
  const { t } = useCopy()
  const { colors } = useTheme()
  const [offset, setOffset] = useState(0)
  const range = useMemo(() => dayRange(offset), [offset])
  const query = useQuery({
    queryKey: ['agenda', range.from],
    queryFn: () => listAgenda(range.from, range.to),
  })
  const items = query.data?.items ?? []

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 12 }}>
        <Pressable onPress={() => setOffset((value) => value - 1)}>
          <Text style={{ color: colors.accentInk }}>{t('agenda.previous')}</Text>
        </Pressable>
        <Pressable onPress={() => setOffset(0)}>
          <Text style={{ color: colors.textHeading }}>{t('agenda.today')}</Text>
        </Pressable>
        <Pressable onPress={() => setOffset((value) => value + 1)}>
          <Text style={{ color: colors.accentInk }}>{t('agenda.next')}</Text>
        </Pressable>
      </View>
      {query.isLoading ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={<AgendaDayHeader label={range.label} />}
          ListEmptyComponent={<AgendaEmpty title={t('agenda.empty')} />}
          renderItem={({ item }) => (
            <AgendaItemRow
              time={new Date(item.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              title={item.title}
              owner={item.owner_name ?? undefined}
              repeat={Boolean(item.series_id)}
              status={item.status}
              onPress={() => {
                if (item.signal_id) router.push(`/thread/${item.signal_id}`)
              }}
            />
          )}
        />
      )}
    </View>
  )
}
