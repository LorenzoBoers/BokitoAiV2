import { useEffect, useRef, useState, FormEvent, ChangeEvent } from 'react';
import { Checkbox } from '../components/ui/checkbox'
import { Spinner } from '../components/ui/spinner'
import { Pressable } from '../components/ui/pressable'
import { Link, useSearchParams } from 'react-router-dom';
import { Camera, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { persistUiLanguage } from '../lib/language-preference';
import { useTranslation } from 'react-i18next';
import { authInviteInfo, type InviteInfo } from '../lib/api';
import { apiPatchAuth, AUTH_API_BASE, buildAuthHeaders } from '../lib/api';
import { authRoutes } from '../api/routes/auth.routes';
import { policyRoutes } from '../api/routes/policy.routes';
import { InviteCardSkeleton } from '../components/ui/skeleton'
import { memberRoleLabel } from '../lib/labels';
import { AuthShell } from '../components/auth/AuthShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type PrefRow = {
  id: string;
  channels: { desktop: boolean; email: boolean; mobile: boolean };
};

// Tier 1 events offered for email at sign-up; the rest lives in Notification settings.
const DEFAULT_PREF_ROWS: PrefRow[] = [
  {
    id: 'assigned-to-me',
    channels: { desktop: true, email: false, mobile: false },
  },
  {
    id: 'mentions',
    channels: { desktop: true, email: false, mobile: false },
  },
  {
    id: 'decisions',
    channels: { desktop: true, email: false, mobile: false },
  },
];

/**
 * Accept-invite landing page (`/accept-invite?token=...`).
 * New users pick a name + password; existing accounts confirm their current
 * password. On success a light, skippable welcome step confirms display name,
 * avatar and notification preferences before entering the dashboard.
 */
export default function AcceptInvite() {
  const { acceptInvite } = useAuth();
  const { i18n, t } = useTranslation('nav');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [infoError, setInfoError] = useState('');
  const [infoLoading, setInfoLoading] = useState(true);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Welcome (onboarding) step shown after the invite is accepted.
  const [step, setStep] = useState<'form' | 'welcome'>('form');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [welcomeFirstName, setWelcomeFirstName] = useState('');
  const [welcomeLastName, setWelcomeLastName] = useState('');
  const [prefRows, setPrefRows] = useState<PrefRow[]>(DEFAULT_PREF_ROWS);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) {
      setInfoError(t('acceptInvitePage.missingToken'));
      setInfoLoading(false);
      return;
    }
    let cancelled = false;
    authInviteInfo(token)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfoError(t('acceptInvitePage.invalidLink'));
      })
      .finally(() => {
        if (!cancelled) setInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!info?.existing_user && password.length < 8) {
      setError(t('acceptInvitePage.passwordMin'));
      return;
    }
    setIsLoading(true);
    try {
      const accessToken = await acceptInvite({
        token,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      try {
        await persistUiLanguage(accessToken, i18n.resolvedLanguage ?? i18n.language);
      } catch {
        // Language is already in localStorage; preference can be set later.
      }
      setSessionToken(accessToken);
      setWelcomeFirstName(firstName.trim() || (info?.email ? info.email.split('@')[0] : ''));
      setWelcomeLastName(lastName.trim());
      setStep('welcome');
      setIsLoading(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('acceptInvitePage.acceptError'));
      setIsLoading(false);
    }
  }

  function handleAvatarPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setAvatarFile(file);
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(file ? URL.createObjectURL(file) : null);
  }

  function togglePrefEmail(rowId: string) {
    setPrefRows((rows) =>
      rows.map((row) =>
        row.id === rowId
          ? { ...row, channels: { ...row.channels, email: !row.channels.email } }
          : row,
      ),
    );
  }

  /** Persist the welcome step. Onboarding must never block entry, so every
   * write is best-effort and the redirect always happens. */
  async function completeOnboarding(skip: boolean) {
    if (finishing) return;
    setFinishing(true);
    if (sessionToken) {
      try {
        const first = welcomeFirstName.trim();
        const last = welcomeLastName.trim();
        await apiPatchAuth(
          authRoutes.profile.patch,
          {
            ...(!skip && (first || last) ? { first_name: first, last_name: last } : {}),
            onboarded: true,
          },
          sessionToken,
        );
        if (!skip && avatarFile) {
          const form = new FormData();
          form.append('avatar', avatarFile);
          await fetch(`${AUTH_API_BASE}${authRoutes.users.meAvatar}`, {
            method: 'POST',
            headers: buildAuthHeaders(sessionToken, false),
            credentials: 'include',
            body: form,
          });
        }
        if (!skip) {
          await fetch(`/api${policyRoutes.notificationPreferences()}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${sessionToken}`,
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              tiers: { '1': { email: prefRows.some((row) => row.channels.email) } },
              rows: prefRows.map((row) => ({ id: row.id, channels: { email: row.channels.email } })),
            }),
          });
        }
      } catch {
        // Best-effort: preferences can be changed later in profile settings.
      }
    }
    window.location.assign('/');
  }

  
  function inviteRoleLabel(role: string | undefined): string {
    if (!role) return '';
    return t(`membersPage.roles.${role.toLowerCase()}`, { defaultValue: memberRoleLabel(role) });
  }

  const headerSubtitle =
    step === 'welcome'
      ? t('acceptInvitePage.welcomeTitle', { tenant: info?.tenant_name ?? t('acceptInvitePage.inviteTitle') })
      : info
        ? t('acceptInvitePage.joinTitle', { tenant: info.tenant_name })
        : t('acceptInvitePage.inviteTitle');

  return (
    <AuthShell subtitle={headerSubtitle}>
          {step === 'welcome' ? (
            <div className="space-y-5">
              <p className="text-sm text-text-secondary">
                {t('acceptInvitePage.welcomeIntro')}
              </p>

              <div className="flex items-center gap-3">
                <Pressable
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-border bg-bg-input flex items-center justify-center text-text-muted hover:border-border-focus transition"
                  title={t('acceptInvitePage.uploadPhoto')}
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt={t('acceptInvitePage.avatarPreview')} className="h-full w-full object-cover" />
                  ) : (
                    <Camera size={16} />
                  )}
                </Pressable>
                <input // design-system-ignore: hidden file input opened from the profile photo
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarPick}
                />
                <div className="min-w-0 flex-1 grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="welcome-first-name" className="block text-sm font-medium text-text-secondary mb-1">
                      {t('acceptInvitePage.firstName')}
                    </label>
                    <Input
                      id="welcome-first-name"
                      type="text"
                      autoComplete="given-name"
                      value={welcomeFirstName}
                      onChange={(e) => setWelcomeFirstName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void completeOnboarding(false);
                        }
                      }}
                      className="h-10"
                      placeholder={t('acceptInvitePage.firstNamePlaceholder')}
                    />
                  </div>
                  <div>
                    <label htmlFor="welcome-last-name" className="block text-sm font-medium text-text-secondary mb-1">
                      {t('acceptInvitePage.lastName')}
                    </label>
                    <Input
                      id="welcome-last-name"
                      type="text"
                      autoComplete="family-name"
                      value={welcomeLastName}
                      onChange={(e) => setWelcomeLastName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void completeOnboarding(false);
                        }
                      }}
                      className="h-10"
                      placeholder={t('acceptInvitePage.lastNamePlaceholder')}
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-text-secondary mb-2">{t('acceptInvitePage.emailNotifications')}</p>
                <div className="space-y-2">
                  {prefRows.map((row) => (
                    <label key={row.id} className="flex items-start gap-2.5 cursor-pointer">
                      <Checkbox
                        checked={row.channels.email}
                        onChange={() => togglePrefEmail(row.id)}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-text-secondary">
                        {t(`acceptInvitePage.prefs.${row.id === 'assigned-to-me' ? 'assignedToMe' : row.id}`)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <Button size="lg"
                  type="button"
                  onClick={() => void completeOnboarding(false)}
                  disabled={finishing}
                  className="w-full"
                >
                  {finishing ? (
                    <>
                      <Spinner size="md" />
                      {t('acceptInvitePage.settingUp')}
                    </>
                  ) : (
                    t('acceptInvitePage.getStarted')
                  )}
                </Button>
                <Pressable
                  type="button"
                  onClick={() => void completeOnboarding(true)}
                  disabled={finishing}
                  className="w-full px-4 py-2 text-sm text-text-muted hover:text-text-secondary transition"
                >
                  {t('acceptInvitePage.skipForNow')}
                </Pressable>
              </div>
            </div>
          ) : infoLoading ? (
            <InviteCardSkeleton />
          ) : infoError ? (
            <div className="space-y-4">
              <div className="px-4 py-3 rounded-md bg-status-error/10 border border-status-error/30 text-status-error text-sm">
                {infoError}
              </div>
              <p className="text-sm text-text-secondary">
                {t('acceptInvitePage.askResend')}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-text-secondary">
                {info?.role
                  ? t('acceptInvitePage.invitedAsWithRole', {
                      email: info.email,
                      role: inviteRoleLabel(info.role),
                    })
                  : t('acceptInvitePage.invitedAs', { email: info?.email })}
              </p>

              {!info?.existing_user ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="first-name" className="block text-sm font-medium text-text-secondary mb-1.5">
                      {t('acceptInvitePage.firstName')}
                    </label>
                    <Input
                      id="first-name"
                      type="text"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="h-10"
                      placeholder={t('acceptInvitePage.firstNamePlaceholder')}
                    />
                  </div>
                  <div>
                    <label htmlFor="last-name" className="block text-sm font-medium text-text-secondary mb-1.5">
                      {t('acceptInvitePage.lastName')}
                    </label>
                    <Input
                      id="last-name"
                      type="text"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="h-10"
                      placeholder={t('acceptInvitePage.lastNamePlaceholder')}
                    />
                  </div>
                </div>
              ) : null}

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1.5">
                  {info?.existing_user
                    ? t('acceptInvitePage.currentPassword')
                    : t('acceptInvitePage.choosePassword')}
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={info?.existing_user ? 'current-password' : 'new-password'}
                    required
                    minLength={info?.existing_user ? undefined : 8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 pr-10"
                    placeholder={
                      info?.existing_user
                        ? t('acceptInvitePage.passwordPlaceholderExisting')
                        : t('acceptInvitePage.passwordPlaceholderNew')
                    }
                  />
                  <Pressable
                    onClick={() => setShowPassword((v) => !v)}
                    className="w-auto text-center absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Pressable>
                </div>
                {info?.existing_user ? (
                  <p className="mt-1 text-xs text-text-muted">
                    {t('acceptInvitePage.existingAccountHint')}
                  </p>
                ) : null}
              </div>

              {error && (
                <div className="px-4 py-3 rounded-md bg-status-error/10 border border-status-error/30 text-status-error text-sm">
                  {error}
                </div>
              )}

              <Button size="lg"
                type="submit"
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Spinner size="md" />
                    {t('acceptInvitePage.joining')}
                  </>
                ) : (
                  t('acceptInvitePage.acceptInvite')
                )}
              </Button>
            </form>
          )}

          {step !== 'welcome' ? (
            <div className="mt-6 text-center">
              <Link
                to="/login"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-text-heading hover:bg-bg-hover transition-colors"
              >
                {t('loginPage.backToSignIn')}
              </Link>
              <p className="mt-2 text-sm text-text-muted">{t('acceptInvitePage.alreadyHaveAccess')}</p>
            </div>
          ) : null}
    </AuthShell>
  );
}
