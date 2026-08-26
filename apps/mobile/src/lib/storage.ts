import * as SecureStore from 'expo-secure-store'
import type { Locale } from './copy'
import type { ThemePreference } from '../theme'

const TOKEN_KEY = 'bokito_access_token'
const LANGUAGE_KEY = 'bokito_ui_language'
const LAST_EMAIL_KEY = 'bokito_last_email'
const HIDE_LOOP_KEY = 'bokito_hide_loop_hint'

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token)
}

export async function loadToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY)
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

export async function saveLanguage(locale: Locale): Promise<void> {
  await SecureStore.setItemAsync(LANGUAGE_KEY, locale)
}

export async function loadLanguage(): Promise<Locale | null> {
  const value = await SecureStore.getItemAsync(LANGUAGE_KEY)
  return value === 'nl' || value === 'en' ? value : null
}

export async function saveLastEmail(email: string): Promise<void> {
  await SecureStore.setItemAsync(LAST_EMAIL_KEY, email)
}

export async function loadLastEmail(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_EMAIL_KEY)
}

export async function loadHideLoopHint(): Promise<boolean> {
  const value = await SecureStore.getItemAsync(HIDE_LOOP_KEY)
  return value === '1'
}

export async function saveHideLoopHint(): Promise<void> {
  await SecureStore.setItemAsync(HIDE_LOOP_KEY, '1')
}

const THEME_KEY = 'bokito_ui_theme'

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  await SecureStore.setItemAsync(THEME_KEY, preference)
}

export async function loadThemePreference(): Promise<ThemePreference | null> {
  const value = await SecureStore.getItemAsync(THEME_KEY)
  return value === 'light' || value === 'dark' || value === 'system' ? value : null
}

function draftKey(threadId: string): string {
  return `bokito_thread_draft_${threadId}`
}

export async function loadThreadDraft(threadId: string): Promise<string> {
  if (!threadId) return ''
  return (await SecureStore.getItemAsync(draftKey(threadId))) ?? ''
}

export async function saveThreadDraft(threadId: string, body: string): Promise<void> {
  if (!threadId) return
  const key = draftKey(threadId)
  if (!body.trim()) {
    await SecureStore.deleteItemAsync(key).catch(() => undefined)
    return
  }
  await SecureStore.setItemAsync(key, body)
}
