import { Image, Linking, Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme, useThemedStyles } from '../context/ThemeContext'
import { resolveAttachmentUrl, type Attachment } from '../lib/api'
import { spacing, type ColorTokens } from '../theme'

type Props = {
  attachments: Attachment[]
}

export default function MessageAttachments({ attachments }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(attachmentStyles)
  if (!attachments.length) return null

  const images = attachments.filter((a) => a.mime.startsWith('image/'))
  const files = attachments.filter((a) => !a.mime.startsWith('image/'))

  return (
    <View style={styles.root}>
      {images.length > 0 ? (
        <View style={styles.imageRow}>
          {images.map((att) => (
            <Pressable
              key={att.id}
              onPress={() => void Linking.openURL(resolveAttachmentUrl(att.url))}
            >
              <Image
                source={{ uri: resolveAttachmentUrl(att.url) }}
                style={styles.thumbnail as object}
                resizeMode="cover"
              />
            </Pressable>
          ))}
        </View>
      ) : null}
      {files.map((att) => (
        <Pressable
          key={att.id}
          style={styles.chip}
          onPress={() => void Linking.openURL(resolveAttachmentUrl(att.url))}
        >
          <Ionicons name="document-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.chipText} numberOfLines={1}>
            {att.name}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

function attachmentStyles(colors: ColorTokens) {
  return {
    root: { gap: spacing.sm, marginTop: spacing.sm },
    imageRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    thumbnail: {
      width: 120,
      height: 90,
      borderRadius: 8,
      backgroundColor: colors.elevated,
      borderColor: colors.border,
      borderWidth: 1,
    },
    chip: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 6,
      alignSelf: 'flex-start' as const,
      maxWidth: '100%' as const,
      backgroundColor: colors.elevated,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    chipText: { color: colors.textSecondary, fontSize: 12, flexShrink: 1 },
  }
}
