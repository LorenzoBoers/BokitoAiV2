import { useEffect, useRef, useState, FormEvent, ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Camera, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authInviteInfo, type InviteInfo } from '../lib/api';
import { apiPatchAuth, AUTH_API_BASE, buildAuthHeaders } from '../lib/api';
import { authRoutes } from '../api/routes/auth.routes';
import { policyRoutes } from '../api/routes/policy.routes';
import { memberRoleLabel } from '../lib/labels';

type PrefRow = {
  id: string;
  label: string;
  channels: { desktop: boolean; email: boolean; mobile: boolean };
};

// Mirrors the backend defaults (inbox_settings DEFAULT_NOTIFICATION_ROWS).
const DEFAULT_PREF_ROWS: PrefRow[] = [
  {
    id: 'assigned-to-me',
    label: 'When a conversation is assigned to you',
    channels: { desktop: true, email: false, mobile: false },
  },
  {
    id: 'mentions',
    label: 'When you are mentioned in conversations',
    channels: { desktop: true, email: false, mobile: false },
  },
  {
    id: 'decisions',
    label: 'When an agent needs your decision on an assigned conversation',
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

  // Welcome (onboarding) step shown after the invite is accepted.
  const [step, setStep] = useState<'form' | 'welcome'>('form');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [welcomeName, setWelcomeName] = useState('');
  const [prefRows, setPrefRows] = useState<PrefRow[]>(DEFAULT_PREF_ROWS);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

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
      const accessToken = await acceptInvite({ token, password, displayName: name.trim() });
      setSessionToken(accessToken);
      setWelcomeName(name.trim() || (info?.email ? info.email.split('@')[0] : ''));
      setStep('welcome');
      setIsLoading(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not accept the invite.');
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
        const trimmed = welcomeName.trim();
        await apiPatchAuth(
          authRoutes.profile.patch,
          { ...(!skip && trimmed ? { name: trimmed } : {}), onboarded: true },
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
            body: JSON.stringify({ rows: prefRows }),
          });
        }
      } catch {
        // Best-effort: preferences can be changed later in profile settings.
      }
    }
    window.location.assign('/');
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
            {step === 'welcome'
              ? `Welcome to ${info?.tenant_name ?? 'your workspace'}`
              : info
                ? `Join ${info.tenant_name}`
                : 'Workspace invite'}
          </span>
        </div>

        <div className="bg-bg-surface border border-border rounded-xl p-8 shadow-xl">
          {step === 'welcome' ? (
            <div className="space-y-5">
              <p className="text-sm text-text-secondary">
                You are in. Check your details below - everything can be changed later in your
                profile settings.
              </p>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-border bg-bg-input flex items-center justify-center text-text-muted hover:border-border-focus transition"
                  title="Upload a profile photo"
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
                  ) : (
                    <Camera size={16} />
                  )}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarPick}
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor="welcome-name" className="block text-sm font-medium text-text-secondary mb-1">
                    Display name
                  </label>
                  <input
                    id="welcome-name"
                    type="text"
                    value={welcomeName}
                    onChange={(e) => setWelcomeName(e.target.value)}
                    className={inputClass}
                    placeholder="Jane Doe"
                  />
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-text-secondary mb-2">Email notifications</p>
                <div className="space-y-2">
                  {prefRows.map((row) => (
                    <label key={row.id} className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={row.channels.email}
                        onChange={() => togglePrefEmail(row.id)}
                        className="mt-0.5 accent-current"
                      />
                      <span className="text-sm text-text-secondary">{row.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => void completeOnboarding(false)}
                  disabled={finishing}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold text-white bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition"
                >
                  {finishing ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    'Get started'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void completeOnboarding(true)}
                  disabled={finishing}
                  className="w-full px-4 py-2 text-sm text-text-muted hover:text-text-secondary transition"
                >
                  Skip for now
                </button>
              </div>
            </div>
          ) : infoLoading ? (
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

          {step !== 'welcome' ? (
            <div className="mt-4 text-center">
              <span className="text-sm text-text-muted">Already have access? </span>
              <Link to="/login" className="text-sm text-accent hover:text-accent-hover transition-colors">
                Sign in
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
