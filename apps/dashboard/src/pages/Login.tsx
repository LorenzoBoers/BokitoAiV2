import { useState, FormEvent, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { appendDevLocalhostCrossHostAccessHash, needsDevLocalhostCrossHostHandoff, sanitizeCrossHostReturnTo } from '../lib/host-routing';
import { APP_VERSION } from '../lib/app-version';

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
  const { login, user, token, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const rawReturnTo = searchParams.get('return_to');
  const absoluteReturnTo = sanitizeCrossHostReturnTo(rawReturnTo);

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const accessToken = await login(email, password);
      const target = resolvePostLoginTarget();
      await redirectToTarget(target, accessToken);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      setError(
        message.includes('Invalid') ||
        message.includes('401') ||
        message.includes('password') ||
        message.toLowerCase().includes('valid integer')
        ? 'Incorrect email or password.'
        : message
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
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
          <span className="text-sm text-text-secondary mt-1">Sign in to your dashboard</span>
        </div>

        {/* Card */}
        <div className="bg-bg-surface border border-border rounded-xl p-8 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-text-secondary mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-md bg-bg-input border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-border-focus transition"
                placeholder="you@company.com"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1.5">
                Password
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
                  placeholder="••••••••"
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
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold text-white bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* Forgot Password */}
          <div className="mt-4 text-center">
            <Link
              to="/forgot-password"
              className="text-sm text-accent hover:text-accent-hover transition-colors"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-text-muted mt-6">
          © {new Date().getFullYear()} Bokito.ai · All rights reserved
        </p>
        <p className="text-center text-[10px] text-text-muted/80 mt-1">
          build: {APP_VERSION}
        </p>
        {import.meta.env.DEV ? (
          <p className="text-center text-[11px] text-text-muted mt-3 max-w-sm mx-auto leading-relaxed">
            Local dev: sign in with <span className="font-mono">admin@bokito.ai</span> /{' '}
            <span className="font-mono">bokito-test-password</span>. Requires the FastAPI API on port 8000.
          </p>
        ) : null}
      </div>
    </div>
  );
}
