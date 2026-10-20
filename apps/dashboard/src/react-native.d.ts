declare module 'react-native' {
  import type { ComponentType } from 'react'

  type AnyComponent = ComponentType<any>

  export const View: AnyComponent
  export const Text: AnyComponent
  export const Pressable: AnyComponent
  export const Image: AnyComponent
  export const ScrollView: AnyComponent
  export const TextInput: AnyComponent
  export interface ViewProps { style?: unknown; children?: unknown }
  export interface TextProps { style?: unknown; children?: unknown; numberOfLines?: number }
  export interface PressableProps { style?: unknown; children?: unknown; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string }
  export type StyleProp<T> = T | T[]
  export type ViewStyle = Record<string, unknown>
  export type TextStyle = Record<string, unknown>
}
