import { useEffect, useState, FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authInviteInfo, type InviteInfo } from '../lib/api';
import { memberRoleLabel } from '../lib/labels';

/**
 * Accept-invite landing page (`/accept-invite?token=...`).
 * New users pick a name + password; existing accounts confirm their current
 * password. On success the session is applied and the app reloads signed in.
 */
export default function AcceptInvite() {
  const { acceptInvite } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [infoError, setInfoError] = useState('');
  const [infoLoading, setInfoLoading] = useState(true);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setInfoError('This invite link is missing its token.');
      setInfoLoading(false);
      return;
    }
    let cancelled = false;
    authInviteInfo(token)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfoError('This invite link is invalid or has expired.');
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
      setError('Password must be at least 8 characters.');
      return;
    }
    setIsLoading(true);
    try {
      await acceptInvite({ token, password, displayName: name.trim() });
      window.location.assign('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not accept the invite.');
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
          <span className="text-sm text-text-secondary mt-1">
            {info ? `Join ${info.tenant_name}` : 'Workspace invite'}
          </span>
        </div>

        <div className="bg-bg-surface border border-border rounded-xl p-8 shadow-xl">
          {infoLoading ? (
            <div className="flex justify-center py-8 text-text-muted">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : infoError ? (
            <div className="space-y-4">
              <div className="px-4 py-3 rounded-md bg-status-error/10 border border-status-error/30 text-status-error text-sm">
                {infoError}
              </div>
              <p className="text-sm text-text-secondary">
                Ask the person who invited you to send a new invite link.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-text-secondary">
                You were invited as <span className="font-medium text-text-primary">{info?.email}</span>
                {info?.role ? ` (${memberRoleLabel(info.role)})` : ''}.
              </p>

              {!info?.existing_user ? (
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-text-secondary mb-1.5">
                    Your name
                  </label>
                  <input
                    id="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClass}
                    placeholder="Jane Doe"
                  />
                </div>
              ) : null}

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1.5">
                  {info?.existing_user ? 'Your current password' : 'Choose a password'}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={info?.existing_user ? 'current-password' : 'new-password'}
                    required
                    minLength={info?.existing_user ? undefined : 8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pr-10`}
                    placeholder={info?.existing_user ? 'Password for your existing account' : 'At least 8 characters'}
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
                {info?.existing_user ? (
                  <p className="mt-1 text-[11px] text-text-muted">
                    An account with this email already exists; confirm its password to join the workspace.
                  </p>
                ) : null}
              </div>

              {error && (
                <div className="px-4 py-3 rounded-md bg-status-error/10 border border-status-error/30 text-status-error text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold text-white bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Joining workspace...
                  </>
                ) : (
                  'Accept invite'
                )}
              </button>
            </form>
          )}

          <div className="mt-4 text-center">
            <span className="text-sm text-text-muted">Already have access? </span>
            <Link to="/login" className="text-sm text-accent hover:text-accent-hover transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
