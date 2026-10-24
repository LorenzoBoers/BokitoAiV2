import { useState, FormEvent, useEffect, type ReactNode } from 'react';
import { Pressable } from '../components/ui/pressable'
import { Spinner } from '../components/ui/spinner'
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { WorkspaceRequiredError, useAuth } from '../context/AuthContext';
import { persistUiLanguage } from '../lib/language-preference';
import { Building2, Eye, EyeOff } from 'lucide-react';
import { APP_VERSION } from '../lib/app-version';
import { startGoogleSso, startMicrosoftSso } from '../lib/api';
import { MicrosoftSignInButton } from '../components/auth/MicrosoftSignInButton';
import { GoogleSignInButton } from '../components/auth/GoogleSignInButton';
import { AuthShell } from '../components/auth/AuthShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type Step = 'account' | 'workspace';

const CONSUMER_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.nl',
  'hotmail.com',
  'hotmail.nl',
  'live.com',
  'live.nl',
  'msn.com',
  'yahoo.com',
  'yahoo.nl',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'aol.com',
  'ziggo.nl',
  'kpnmail.nl',
  'xs4all.nl',
  'upcmail.nl',
  'tele2.nl',
  'planet.nl',
  'home.nl',
]);

const MAILBOX_LABELS = new Set(['mail', 'email', 'smtp', 'mx', 'webmail']);
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'gov']);

/** Company-shaped label from a work domain. Consumer inboxes stay blank. */
function suggestWorkspaceName(email: string): string {
  const domain = email.split('@')[1]?.trim().toLowerCase() ?? '';
  if (!domain || CONSUMER_EMAIL_DOMAINS.has(domain)) return '';
  let labels = domain.split('.').filter(Boolean);
  if (labels.length >= 2) labels = labels.slice(0, -1);
  if (labels.length >= 2 && SECOND_LEVEL.has(labels[labels.length - 1] ?? '')) {
    labels = labels.slice(0, -1);
  }
  const label = [...labels].reverse().find((part) => !MAILBOX_LABELS.has(part) && part.length >= 2) ?? '';
  if (!label) return '';
  return label
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="px-4 py-3 rounded-md bg-status-error/10 border border-status-error/30 text-status-error text-sm">
      {message}
    </div>
  );
}

export default function Signup() {
  const { t, i18n } = useTranslation('nav');
  const { signup, setupAcceptInvite, setupCreateWorkspace, user, isLoading: authLoading } = useAuth();

  const [step, setStep] = useState<Step>('account');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [workspaceSetup, setWorkspaceSetup] = useState<WorkspaceRequiredError | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState<'microsoft' | 'google' | null>(null);

  async function handleMicrosoftSignIn() {
    setError('');
    setSsoLoading('microsoft');
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
      setSsoLoading(null);
    }
  }

  async function handleGoogleSignIn() {
    setError('');
    setSsoLoading('google');
    try {
      const returnUrl = `${window.location.origin}/login`;
      const { authorize_url } = await startGoogleSso(returnUrl);
      window.location.assign(authorize_url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('503') || message.toLowerCase().includes('not configured')
          ? t('loginPage.googleNotConfigured')
          : t('loginPage.googleStartFailed')
      );
      setSsoLoading(null);
    }
  }

  useEffect(() => {
    if (!authLoading && user && !isLoading && step !== 'workspace') {
      window.location.assign('/');
    }
  }, [authLoading, user, isLoading, step]);

  function openWorkspaceStep(err: WorkspaceRequiredError) {
    setWorkspaceSetup(err);
    setWorkspaceName((current) => current || suggestWorkspaceName(err.email || email));
    setStep('workspace');
    setError('');
  }

  async function finishSession(accessToken: string) {
    try {
      await persistUiLanguage(accessToken, i18n.resolvedLanguage ?? i18n.language);
    } catch {
      // Language is already in localStorage; preference can be set later.
    }
    window.location.assign('/');
  }

  async function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError(t('signupPage.passwordMin'));
      return;
    }
    setIsLoading(true);
    try {
      const accessToken = await signup({
        email,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      await finishSession(accessToken);
    } catch (err: unknown) {
      if (err instanceof WorkspaceRequiredError) {
        openWorkspaceStep(err);
        setIsLoading(false);
        return;
      }
      const message = err instanceof Error ? err.message : '';
      const lower = message.toLowerCase();
      if (lower.includes('already') || lower.includes('registered')) {
        setError(t('signupPage.emailTaken'));
      } else if (lower.includes('password') || lower.includes('8 character')) {
        setError(t('signupPage.passwordMin'));
      } else {
        setError(t('signupPage.failed'));
      }
      setIsLoading(false);
    }
  }

  async function handleAcceptPendingInvite(inviteId: string) {
    if (!workspaceSetup) return;
    setError('');
    setIsLoading(true);
    try {
      const accessToken = await setupAcceptInvite(workspaceSetup.setupToken, inviteId);
      await finishSession(accessToken);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('setup token')
          ? t('loginPage.sessionExpired')
          : t('loginPage.inviteFailed')
      );
      setIsLoading(false);
    }
  }

  async function handleCreateWorkspace(e: FormEvent) {
    e.preventDefault();
    if (!workspaceSetup) return;
    setError('');
    setIsLoading(true);
    try {
      const accessToken = await setupCreateWorkspace(workspaceSetup.setupToken, workspaceName.trim());
      await finishSession(accessToken);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('setup token')
          ? t('loginPage.sessionExpired')
          : t('loginPage.createWorkspaceFailed')
      );
      setIsLoading(false);
    }
  }

  const invited = (workspaceSetup?.pendingInvites.length ?? 0) > 0;
  const subtitle = step === 'workspace'
    ? t(invited ? 'signupPage.invitedTitle' : 'signupPage.workspaceTitle')
    : undefined;

  let body: ReactNode;
  if (step === 'workspace' && workspaceSetup) {
    body = (
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center">
          <Building2 size={24} className="mb-2 text-accent" />
          <p className="text-sm text-text-secondary">
            {t(invited ? 'signupPage.invitedBody' : 'signupPage.workspaceBody')}
          </p>
        </div>

        {invited && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-text-muted">
              {t('loginPage.pendingInvites')}
            </p>
            {workspaceSetup.pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-input px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate-fade text-sm font-medium text-text-heading">
                    {invite.tenant_name}
                  </p>
                  <p className="text-xs text-text-muted">
                    {invite.invited_by_name
                      ? t('loginPage.invitedBy', { name: invite.invited_by_name, role: invite.role })
                      : t('loginPage.roleLabel', { role: invite.role })}
                  </p>
                </div>
                <Button
                  size="xs"
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleAcceptPendingInvite(invite.id)}
                  className="shrink-0"
                >
                  {t('loginPage.join')}
                </Button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleCreateWorkspace} className="space-y-2.5">
          <label htmlFor="workspace-name" className="block text-xs font-medium text-text-muted">
            {invited ? t('loginPage.orStartFresh') : t('signupPage.workspaceName')}
          </label>
          <Input
            id="workspace-name"
            type="text"
            autoComplete="organization"
            autoFocus
            required
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            className="h-10"
            placeholder={t('signupPage.workspacePlaceholder')}
          />
          <Button
            size="lg"
            type="submit"
            disabled={isLoading || !workspaceName.trim()}
            className="w-full"
          >
            {isLoading ? (
              <>
                <Spinner size="md" />
                {t('signupPage.creating')}
              </>
            ) : (
              t('signupPage.createWorkspace')
            )}
          </Button>
        </form>
        <FormError message={error} />
      </div>
    );
  } else {
    body = (
      <>
        <div className="mb-5 text-center">
          <h1 className="title-page">{t('signupPage.title')}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t('signupPage.intro')}</p>
        </div>

        <div className="space-y-2">
          <GoogleSignInButton
            onClick={() => void handleGoogleSignIn()}
            isLoading={ssoLoading === 'google'}
            disabled={ssoLoading !== null && ssoLoading !== 'google'}
            label={t('signupPage.google')}
          />
          <MicrosoftSignInButton
            onClick={() => void handleMicrosoftSignIn()}
            isLoading={ssoLoading === 'microsoft'}
            disabled={ssoLoading !== null && ssoLoading !== 'microsoft'}
            label={t('signupPage.microsoft')}
          />
        </div>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-text-muted">{t('signupPage.orEmail')}</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleAccountSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="first-name" className="mb-1.5 block text-sm font-medium text-text-secondary">
                {t('signupPage.firstName')}
              </label>
              <Input
                id="first-name"
                type="text"
                autoComplete="given-name"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-10"
                placeholder={t('signupPage.firstNamePlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="last-name" className="mb-1.5 block text-sm font-medium text-text-secondary">
                {t('signupPage.lastName')}
              </label>
              <Input
                id="last-name"
                type="text"
                autoComplete="family-name"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-10"
                placeholder={t('signupPage.lastNamePlaceholder')}
              />
            </div>
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-text-secondary">
              {t('signupPage.emailLabel')}
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10"
              placeholder={t('signupPage.emailPlaceholder')}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-text-secondary">
              {t('loginPage.password')}
            </label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 pr-10"
                placeholder={t('signupPage.passwordPlaceholder')}
              />
              <Pressable
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 w-auto -translate-y-1/2 text-center text-text-muted transition hover:text-text-secondary"
                tabIndex={-1}
                aria-label={showPassword ? t('signupPage.hidePassword') : t('signupPage.showPassword')}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </Pressable>
            </div>
          </div>

          <FormError message={error} />

          <Button size="lg" type="submit" disabled={isLoading} className="w-full">
            {isLoading ? (
              <>
                <Spinner size="md" />
                {t('signupPage.creatingAccount')}
              </>
            ) : (
              t('signupPage.createAccount')
            )}
          </Button>
        </form>
      </>
    );
  }

  return (
    <AuthShell
      subtitle={subtitle}
      frameClassName="max-w-md"
      below={<p className="mt-1 text-center text-2xs text-text-muted">build: {APP_VERSION}</p>}
    >
      {body}
      {step !== 'workspace' ? (
        <div className="mt-4 text-center">
          <span className="text-sm text-text-muted">{t('signupPage.alreadyAccount')} </span>
          <Link to="/login" className="text-sm text-accent hover:text-accent-hover transition-colors">
            {t('loginPage.signIn')}
          </Link>
        </div>
      ) : null}
    </AuthShell>
  );
}
