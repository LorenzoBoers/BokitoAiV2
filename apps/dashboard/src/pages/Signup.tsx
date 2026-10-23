import { useState, FormEvent, useEffect } from 'react';
import { Pressable } from '../components/ui/pressable'
import { Spinner } from '../components/ui/spinner'
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { persistUiLanguage } from '../lib/language-preference';
import { Eye, EyeOff } from 'lucide-react';
import { APP_VERSION } from '../lib/app-version';
import { startGoogleSso, startMicrosoftSso } from '../lib/api';
import { MicrosoftSignInButton } from '../components/auth/MicrosoftSignInButton';
import { GoogleSignInButton } from '../components/auth/GoogleSignInButton';
import { AuthShell } from '../components/auth/AuthShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default function Signup() {
  const { t, i18n } = useTranslation('nav');
  const { signup, user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
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
    if (!authLoading && user && !isLoading) {
      navigate('/', { replace: true });
    }
  }, [authLoading, user, isLoading, navigate]);

  const effectiveSlug = slugTouched ? slug : slugify(companyName);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError(t('signupPage.passwordMin'));
      return;
    }
    if (!effectiveSlug) {
      setError(t('signupPage.needSlug'));
      return;
    }
    setIsLoading(true);
    try {
      const accessToken = await signup({
        email,
        password,
        tenantSlug: effectiveSlug,
        tenantName: companyName.trim() || effectiveSlug,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      try {
        await persistUiLanguage(accessToken, i18n.resolvedLanguage ?? i18n.language);
      } catch {
        // Language is already in localStorage; preference can be set later.
      }
      window.location.assign('/');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('signupPage.failed');
      if (message.toLowerCase().includes('slug taken')) {
        setError(t('signupPage.slugTaken'));
      } else if (message.toLowerCase().includes('already') || message.includes('409')) {
        setError(t('signupPage.emailTaken'));
      } else {
        setError(message);
      }
      setIsLoading(false);
    }
  }

  
  return (
    <AuthShell
      subtitle={t('signupPage.subtitle')}
      below={<p className="mt-1 text-center text-2xs text-text-muted">build: {APP_VERSION}</p>}
    >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="first-name" className="block text-sm font-medium text-text-secondary mb-1.5">
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
                <label htmlFor="last-name" className="block text-sm font-medium text-text-secondary mb-1.5">
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
              <label htmlFor="email" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('signupPage.workEmail')}
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
              <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1.5">
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
                <p className="mt-1 text-xs text-text-muted">
                  {t('signupPage.passwordHint', { count: password.length })}
                </p>
                <Pressable
                  onClick={() => setShowPassword((v) => !v)}
                  className="w-auto text-center absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </Pressable>
              </div>
            </div>

            <div>
              <label htmlFor="company" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('signupPage.companyName')}
              </label>
              <Input
                id="company"
                type="text"
                autoComplete="organization"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="h-10"
                placeholder={t('signupPage.companyPlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('signupPage.workspaceUrl')}
              </label>
              <Input
                id="slug"
                type="text"
                required
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                className="h-10 font-mono"
                placeholder={t('signupPage.slugPlaceholder')}
              />
              <p className="mt-1 text-xs text-text-muted">
                {effectiveSlug
                  ? t('signupPage.slugPreview', { slug: effectiveSlug })
                  : t('signupPage.slugHint')}
              </p>
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
                  {t('signupPage.creating')}
                </>
              ) : (
                t('signupPage.createWorkspace')
              )}
            </Button>
          </form>

          <div className="mt-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text-muted">{t('loginPage.or')}</span>
              <div className="flex-1 h-px bg-border" />
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
          </div>

          <div className="mt-4 text-center">
            <span className="text-sm text-text-muted">{t('signupPage.alreadyAccount')} </span>
            <Link to="/login" className="text-sm text-accent hover:text-accent-hover transition-colors">
              {t('loginPage.signIn')}
            </Link>
          </div>
    </AuthShell>
  );
}
