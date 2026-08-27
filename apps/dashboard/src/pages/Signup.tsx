import { useState, FormEvent, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { persistUiLanguage } from '../lib/language-preference';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { APP_VERSION } from '../lib/app-version';
import { startMicrosoftSso } from '../lib/api';
import { MicrosoftSignInButton } from '../components/auth/MicrosoftSignInButton';

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

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSsoLoading, setIsSsoLoading] = useState(false);

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
        displayName: name.trim(),
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

  const inputClass =
    'w-full px-4 py-2.5 rounded-md bg-bg-input border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-border-focus transition';

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4 py-10">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img
            src="/bokito-logo-in-circel.svg"
            alt="Bokito.ai"
            className="w-12 h-12 mb-3"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span className="text-2xl font-semibold text-text-heading tracking-tight">Bokito.ai</span>
          <span className="text-sm text-text-secondary mt-1">{t('signupPage.subtitle')}</span>
        </div>

        <div className="bg-bg-surface border border-border/60 rounded-xl p-8 shadow-overlay animate-page-enter">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('signupPage.yourName')}
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder={t('signupPage.namePlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('signupPage.workEmail')}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder={t('signupPage.emailPlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('loginPage.password')}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-10`}
                  placeholder={t('signupPage.passwordPlaceholder')}
                />
                <p className="mt-1 text-[11px] text-text-muted">
                  {t('signupPage.passwordHint', { count: password.length })}
                </p>
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

            <div>
              <label htmlFor="company" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('signupPage.companyName')}
              </label>
              <input
                id="company"
                type="text"
                autoComplete="organization"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className={inputClass}
                placeholder={t('signupPage.companyPlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('signupPage.workspaceUrl')}
              </label>
              <input
                id="slug"
                type="text"
                required
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                className={`${inputClass} font-mono`}
                placeholder={t('signupPage.slugPlaceholder')}
              />
              <p className="mt-1 text-[11px] text-text-muted">
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

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold text-accent-fg bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t('signupPage.creating')}
                </>
              ) : (
                t('signupPage.createWorkspace')
              )}
            </button>
          </form>

          <div className="mt-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text-muted">{t('loginPage.or')}</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <MicrosoftSignInButton
              onClick={() => void handleMicrosoftSignIn()}
              isLoading={isSsoLoading}
              label={t('signupPage.microsoft')}
            />
          </div>

          <div className="mt-4 text-center">
            <span className="text-sm text-text-muted">{t('signupPage.alreadyAccount')} </span>
            <Link to="/login" className="text-sm text-accent hover:text-accent-hover transition-colors">
              {t('loginPage.signIn')}
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-text-muted mt-6">
          © {new Date().getFullYear()} Bokito.ai · {t('loginPage.rights')}
        </p>
        <p className="text-center text-[10px] text-text-muted/80 mt-1">
          build: {APP_VERSION}
        </p>
      </div>
    </div>
  );
}
