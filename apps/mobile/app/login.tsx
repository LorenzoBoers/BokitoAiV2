import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useAuth } from '../src/context/AuthContext'
import { useCopy } from '../src/context/LocaleContext'
import { useTheme, useThemedStyles } from '../src/context/ThemeContext'
import { ApiError, requestPasswordReset } from '../src/lib/api'
import { loadLastEmail } from '../src/lib/storage'
import { radius, spacing, type ColorTokens } from '../src/theme'

export default function Login() {
  const { signIn, completeTwoFactor } = useAuth()
  const { t } = useCopy()
  const { colors } = useTheme()
  const styles = useThemedStyles(loginStyles)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadLastEmail().then((saved) => {
      if (saved) setEmail(saved)
    })
  }, [])

  const fail = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 401) {
      setError(challengeToken ? t('login.twoFactorInvalid') : t('login.invalid'))
      return
    }
    setError(fallback)
  }

  const submitPassword = async () => {
    if (!email.trim() || !password || busy) return
    Keyboard.dismiss()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const result = await signIn(email.trim(), password)
      if (result.status === '2fa') {
        setChallengeToken(result.challengeToken)
        return
      }
      router.replace('/(tabs)/home')
    } catch (err) {
      fail(err, t('login.offline'))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async () => {
    if (!challengeToken || code.trim().length < 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      await completeTwoFactor(challengeToken, code.trim())
      router.replace('/(tabs)/home')
    } catch (err) {
      fail(err, t('login.twoFactorInvalid'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAwareScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.brand}>{t('login.brand')}</Text>
        <Text style={styles.tagline}>{t('login.tagline')}</Text>
        <Text style={styles.subtitle}>
          {challengeToken ? t('login.twoFactorTitle') : t('login.subtitle')}
        </Text>

        {challengeToken ? (
          <>
            <Text style={styles.help}>{t('login.twoFactorBody')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('login.twoFactorCode')}
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={8}
              value={code}
              onChangeText={setCode}
              autoFocus
              onSubmitEditing={() => void submitCode()}
            />
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder={t('login.email')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <View style={styles.passwordWrap}>
              <TextInput
                style={styles.passwordInput}
                placeholder={t('login.password')}
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => void submitPassword()}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8} style={styles.eye}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {info ? <Text style={styles.info}>{info}</Text> : null}

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={() => void (challengeToken ? submitCode() : submitPassword())}
        >
          {busy ? (
            <ActivityIndicator color={colors.accentFg} />
          ) : (
            <Text style={styles.buttonText}>
              {challengeToken ? t('login.twoFactorSubmit') : t('login.submit')}
            </Text>
          )}
        </Pressable>

        {challengeToken ? (
          <Pressable
            onPress={() => {
              setChallengeToken(null)
              setCode('')
              setError(null)
              setInfo(null)
            }}
          >
            <Text style={styles.back}>{t('login.back')}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              if (!email.trim()) {
                setError(t('login.forgotNeedEmail'))
                return
              }
              setBusy(true)
              setError(null)
              void requestPasswordReset(email.trim())
                .then(() => setInfo(t('login.forgotSent')))
                .catch(() => setInfo(t('login.forgotSent')))
                .finally(() => setBusy(false))
            }}
          >
            <Text style={styles.back}>{t('login.forgot')}</Text>
          </Pressable>
        )}

        {__DEV__ && !challengeToken ? (
          <Pressable
            onPress={() => {
              setEmail('admin@bokito.ai')
              setPassword('bokito-test-password')
              setError(null)
            }}
          >
            <Text style={styles.devFill}>{t('login.devFill')}</Text>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAwareScrollView>
  )
}

function loginStyles(colors: ColorTokens) {
  return {
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: { width: '100%', maxWidth: 380, gap: spacing.md },
  brand: {
    color: colors.textHeading,
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
  },
  tagline: {
    color: colors.accentInk,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  help: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
  },
  eye: { paddingHorizontal: spacing.md },
  error: { color: colors.error, fontSize: 13 },
  info: { color: colors.success, fontSize: 13 },
  devFill: { color: colors.textMuted, textAlign: 'center', fontSize: 12 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.accentFg, fontSize: 15, fontWeight: '600' },
  back: { color: colors.accentInk, textAlign: 'center', fontSize: 13, fontWeight: '600' },
  }
}
