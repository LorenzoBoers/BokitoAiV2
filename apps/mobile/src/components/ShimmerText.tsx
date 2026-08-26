import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, type TextStyle, View } from 'react-native'
import MaskedView from '@react-native-masked-view/masked-view'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '../context/ThemeContext'

type Props = {
  children: string
  style?: TextStyle
  active?: boolean
}

const SHIMMER_WIDTH = 180

export default function ShimmerText({ children, style, active = true }: Props) {
  const { colors } = useTheme()
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!active) {
      progress.stopAnimation()
      progress.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [active, progress])

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-SHIMMER_WIDTH, SHIMMER_WIDTH],
  })

  const textStyle = [styles.text, { color: colors.textSecondary }, style]

  if (!active) {
    return <Text style={textStyle}>{children}</Text>
  }

  return (
    <MaskedView
      style={styles.mask}
      maskElement={<Text style={textStyle}>{children}</Text>}
    >
      <View style={[styles.base, { backgroundColor: colors.elevated }]}>
        <Text style={[textStyle, styles.baseText]}>{children}</Text>
      </View>
      <Animated.View style={[styles.shimmerWrap, { transform: [{ translateX }] }]}>
        <LinearGradient
          colors={['transparent', 'rgba(13,148,136,0.15)', 'rgba(13,148,136,0.85)', 'rgba(13,148,136,0.15)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.shimmer}
        />
      </Animated.View>
    </MaskedView>
  )
}

const styles = StyleSheet.create({
  mask: { alignSelf: 'flex-start' },
  base: {},
  text: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  baseText: { opacity: 0.92 },
  shimmerWrap: {
    ...StyleSheet.absoluteFillObject,
    width: SHIMMER_WIDTH * 2,
  },
  shimmer: {
    flex: 1,
    width: SHIMMER_WIDTH,
  },
})
