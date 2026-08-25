import { useState, FormEvent, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { TwoFactorRequiredError, WorkspaceRequiredError, useAuth } from '../context/AuthContext';
import { Building2, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { appendDevLocalhostCrossHostAccessHash, needsDevLocalhostCrossHostHandoff, sanitizeCrossHostReturnTo } from '../lib/host-routing';
import { APP_VERSION } from '../lib/app-version';
import { startMicrosoftSso } from '../lib/api';
import { MicrosoftSignInButton, describeSsoError } from '../components/auth/MicrosoftSignInButton';

function sanitizeRelativeReturnTo(rawReturnTo: string | null): string {
  if (!rawReturnTo) return '/';
  if (!rawReturnTo.startsWith('/')) return '/';
  if (rawReturnTo.startsWith('//')) return '/';
  if (rawReturnTo.includes('://')) return '/';
  const normalized = rawReturnTo.toLowerCase();
  if (normalized === '/login' || normalized.startsWith('/login?')) return '/';
  if (normalized.startsWith('/auth/handoff')) return '/';
  return rawReturnTo;
}

export default function Login() {
  const { t } = useTranslation('nav');
  const { login, verifyTotp, setupAcceptInvite, setupCreateWorkspace, user, token, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSsoLoading, setIsSsoLoading] = useState(false);
  // Two-step login: set after a correct password on a 2FA-enabled account.
  const [twoFactorChallenge, setTwoFactorChallenge] = useState('');
  const [totpCode, setTotpCode] = useState('');
  // Set when the password was correct but the account has no workspace
  // membership anymore (removed from its last tenant). The account persists.
  const [workspaceSetup, setWorkspaceSetup] = useState<WorkspaceRequiredError | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const rawReturnTo = searchParams.get('return_to');
  const absoluteReturnTo = sanitizeCrossHostReturnTo(rawReturnTo);
  const ssoError = searchParams.get('sso_error');

  useEffect(() => {
    if (ssoError) {
      setError(t(`loginPage.sso.${ssoError}`, { defaultValue: describeSsoError(ssoError) }));
    }
  }, [ssoError, t]);

  function resolvePostLoginTarget(): string {
    if (absoluteReturnTo) return absoluteReturnTo;
    return sanitizeRelativeReturnTo(rawReturnTo);
  }

  async function redirectToTarget(target: string, accessToken: string | null): Promise<void> {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      const url = appendDevLocalhostCrossHostAccessHash(target, accessToken);
      window.location.assign(url);
    } else {
      navigate(target, { replace: true });
    }
  }

  useEffect(() => {
    if (authLoading || !user) return;
    const target = resolvePostLoginTarget();
    if (needsDevLocalhostCrossHostHandoff(target) && !token?.trim()) return;

    const schedule = window.setTimeout(() => {
      void redirectToTarget(target, token);
    }, 0);

    return () => window.clearTimeout(schedule);
  }, [authLoading, user, token, rawReturnTo]);

  async function handleMicrosoftSignIn() {
    setError('');
    setIsSsoLoading(true);
    try {
      const returnUrl = `${window.location.origin}/login`;
      const { authorize_url } = await startMicrosoftSso(returnUrl);
      window.location.assign(authorize_url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('503') || message.toLowerCase().includes('not configured')
          ? t('loginPage.microsoftNotConfigured')
          : t('loginPage.microsoftStartFailed')
      );
      setIsSsoLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const accessToken = await login(email, password);
      const target = resolvePostLoginTarget();
      await redirectToTarget(target, accessToken);
    } catch (err: unknown) {
      if (err instanceof TwoFactorRequiredError) {
        setTwoFactorChallenge(err.challengeToken);
        setTotpCode('');
        return;
      }
      if (err instanceof WorkspaceRequiredError) {
        setWorkspaceSetup(err);
        return;
      }
      const message = err instanceof Error ? err.message : t('loginPage.failed');
      setError(
        message.includes('Invalid') ||
        message.includes('401') ||
        message.includes('password') ||
        message.toLowerCase().includes('valid integer')
        ? t('loginPage.incorrect')
        : message
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleTotpSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const accessToken = await verifyTotp(twoFactorChallenge, totpCode);
      const target = resolvePostLoginTarget();
      await redirectToTarget(target, accessToken);
    } catch (err: unknown) {
      if (err instanceof WorkspaceRequiredError) {
        setTwoFactorChallenge('');
        setWorkspaceSetup(err);
        return;
      }
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('challenge')
          ? t('loginPage.totpExpired')
          : t('loginPage.totpIncorrect')
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAcceptPendingInvite(inviteId: string) {
    if (!workspaceSetup) return;
    setError('');
    setIsLoading(true);
    try {
      const accessToken = await setupAcceptInvite(workspaceSetup.setupToken, inviteId);
      await redirectToTarget(resolvePostLoginTarget(), accessToken);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('setup token')
          ? t('loginPage.sessionExpired')
          : t('loginPage.inviteFailed')
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateWorkspace(e: FormEvent) {
    e.preventDefault();
    if (!workspaceSetup) return;
    setError('');
    setIsLoading(true);
    try {
      const accessToken = await setupCreateWorkspace(workspaceSetup.setupToken, newWorkspaceName);
      await redirectToTarget(resolvePostLoginTarget(), accessToken);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('setup token')
          ? t('loginPage.sessionExpired')
          : t('loginPage.createWorkspaceFailed')
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="app-atmosphere relative min-h-screen flex items-center justify-center px-4">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/bokito-logo-in-circel.svg"
            alt="Bokito.ai"
            className="w-12 h-12 mb-3"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span className="text-2xl font-semibold text-text-heading tracking-tight">Bokito.ai</span>
          <span className="text-sm text-text-secondary mt-1">{t('loginPage.subtitle')}</span>
        </div>

        {/* Card */}
        <div className="bg-bg-surface border border-border/60 rounded-xl p-8 shadow-overlay animate-page-enter">
          {workspaceSetup ? (
            <div className="space-y-5">
              <div className="flex flex-col items-center text-center">
                <Building2 size={28} className="mb-2 text-accent" />
                <h2 className="text-sm font-semibold text-text-heading">{t('loginPage.noWorkspaceTitle')}</h2>
                <p className="mt-1 text-[12.5px] text-text-secondary">
                  {t('loginPage.noWorkspaceBody', { email: workspaceSetup.email })}
                </p>
              </div>

              {workspaceSetup.pendingInvites.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-[0.06em] text-text-muted">
                    {t('loginPage.pendingInvites')}
                  </p>
                  {workspaceSetup.pendingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-input px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-heading">
                          {invite.tenant_name}
                        </p>
                        <p className="text-xs text-text-muted">
                          {invite.invited_by_name
                            ? t('loginPage.invitedBy', { name: invite.invited_by_name, role: invite.role })
                            : t('loginPage.roleLabel', { role: invite.role })}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => void handleAcceptPendingInvite(invite.id)}
                        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60 transition"
                      >
                        {t('loginPage.join')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleCreateWorkspace} className="space-y-2.5">
                <p className="text-xs font-medium uppercase tracking-[0.06em] text-text-muted">
                  {workspaceSetup.pendingInvites.length > 0 ? t('loginPage.orStartFresh') : t('loginPage.startFresh')}
                </p>
                <input
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder={t('loginPage.workspaceNamePlaceholder')}
                  className="w-full rounded-md border border-border bg-bg-input px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-border-focus transition"
                />
                <button
                  type="submit"
                  disabled={isLoading || !newWorkspaceName.trim()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition"
                >
                  {isLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                  {t('loginPage.createWorkspace')}
                </button>
              </form>

              {error && (
                <div className="px-4 py-3 rounded-md bg-status-error/10 border border-status-error/30 text-status-error text-sm">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setWorkspaceSetup(null);
                  setNewWorkspaceName('');
                  setError('');
                }}
                className="w-full text-center text-sm text-accent hover:text-accent-hover transition-colors"
              >
                {t('loginPage.backToSignIn')}
              </button>
            </div>
          ) : twoFactorChallenge ? (
            <form onSubmit={handleTotpSubmit} className="space-y-5">
              <div className="flex flex-col items-center text-center">
                <ShieldCheck size={28} className="mb-2 text-accent" />
                <h2 className="text-sm font-semibold text-text-heading">{t('loginPage.totpTitle')}</h2>
                <p className="mt-1 text-[12.5px] text-text-secondary">
                  {t('loginPage.totpBody')}
                </p>
              </div>
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-md border border-border bg-bg-input px-4 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-text-primary placeholder-text-muted focus:outline-none focus:border-border-focus transition"
                placeholder={t('loginPage.totpPlaceholder')}
              />
              {error && (
                <div className="px-4 py-3 rounded-md bg-status-error/10 border border-status-error/30 text-status-error text-sm">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={isLoading || totpCode.length !== 6}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t('loginPage.verifying')}
                  </>
                ) : (
                  t('loginPage.verify')
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTwoFactorChallenge('');
                  setTotpCode('');
                  setError('');
                }}
                className="w-full text-center text-sm text-accent hover:text-accent-hover transition-colors"
              >
                {t('loginPage.backToSignIn')}
              </button>
            </form>
          ) : (
          <>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('loginPage.email')}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-md bg-bg-input border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-border-focus transition"
                placeholder={t('loginPage.emailPlaceholder')}
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('loginPage.password')}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 rounded-md bg-bg-input border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-border-focus transition"
                  placeholder={t('loginPage.passwordPlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="px-4 py-3 rounded-md bg-status-error/10 border border-status-error/30 text-status-error text-sm">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t('loginPage.signingIn')}
                </>
              ) : (
                t('loginPage.signIn')
              )}
            </button>
          </form>

          {/* SSO */}
          <div className="mt-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text-muted">{t('loginPage.or')}</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <MicrosoftSignInButton onClick={() => void handleMicrosoftSignIn()} isLoading={isSsoLoading} label={t('loginPage.microsoft')} />
          </div>

          {/* Forgot Password / Signup */}
          <div className="mt-4 flex items-center justify-between text-sm">
            <Link
              to="/forgot-password"
              className="text-accent hover:text-accent-hover transition-colors"
            >
              {t('loginPage.forgot')}
            </Link>
            <Link
              to="/signup"
              className="text-accent hover:text-accent-hover transition-colors"
            >
              {t('loginPage.createAccount')}
            </Link>
          </div>
          </>
          )}
        </div>

        <p className="text-center text-xs text-text-muted mt-6">
          © {new Date().getFullYear()} Bokito.ai · {t('loginPage.rights')}
        </p>
        <p className="text-center text-[10px] text-text-muted/80 mt-1">
          build: {APP_VERSION}
        </p>
        {import.meta.env.DEV ? (
          <p className="text-center text-[11px] text-text-muted mt-3 max-w-sm mx-auto leading-relaxed">
            {t('loginPage.localDevHint', { email: 'admin@bokito.ai', password: 'bokito-test-password' })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
