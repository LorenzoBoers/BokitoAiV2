import { useState, useEffect } from 'react';
import { Pressable } from '../components/ui/pressable'
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useFormValidation } from '../components/ui/form-validation';
import { AuthShell } from '../components/auth/AuthShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

export default function ResetPassword() {
  const { t } = useTranslation('nav');
  const { resetPassword } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(3);

  const token = searchParams.get('token');

  const validation = useFormValidation(
    { password, passwordConfirmation },
    {
      password: [
        (value: string) => (value ? null : t('resetPage.passwordRequired')),
        (value: string) => (value && value.length < 8 ? t('resetPage.passwordMin') : null),
      ],
      passwordConfirmation: [
        (value: string) => (value ? null : t('resetPage.confirmRequired')),
        (value: string) => (value !== password ? t('resetPage.mismatch') : null),
      ],
    }
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validation.isValid || !token) return;

    setIsLoading(true);
    setError('');
    
    try {
      await resetPassword(token, password);
      setIsSuccess(true);
      setSecondsLeft(3);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('resetPage.failed');
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isSuccess) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          navigate('/login');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isSuccess, navigate]);

  if (!token) {
    return (
      <AuthShell cardClassName="text-center">
            <AlertCircle className="w-16 h-16 text-status-error mx-auto mb-4" />
            <h1 className="title-page mb-2">{t('resetPage.missingTitle')}</h1>
            <p className="text-text-secondary mb-6">{t('resetPage.missingBody')}</p>
            <Link
              to="/forgot-password"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-accent-fg rounded-md transition-colors"
            >
              {t('resetPage.requestNew')}
            </Link>
            <div className="mt-4">
              <Link to="/login" className="inline-flex items-center gap-2 text-sm text-accent hover:text-accent-hover">
                <ArrowLeft className="w-4 h-4" />
                {t('loginPage.backToSignIn')}
              </Link>
            </div>
    </AuthShell>
    );
  }

  if (isSuccess) {
    return (
      <AuthShell cardClassName="text-center">
            <CheckCircle className="w-16 h-16 text-status-success mx-auto mb-4" />
            <h1 className="title-page mb-2">
              {t('resetPage.successTitle')}
            </h1>
            <p className="text-text-secondary mb-6">
              {t('resetPage.redirectIn', { seconds: secondsLeft })}
            </p>
            
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-accent-fg rounded-md transition-colors"
            >
              {t('resetPage.signInNow')}
            </Link>
    </AuthShell>
    );
  }

  return (
    <AuthShell subtitle={t('resetPage.subtitle')}>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* New Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('resetPage.newPassword')} *
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 pr-10"
                  placeholder={t('resetPage.passwordPlaceholder')}
                  autoFocus
                />
                <Pressable
                  onClick={() => setShowPassword(!showPassword)}
                  className="w-auto text-center absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </Pressable>
              </div>
              {validation.errors.find(e => e.field === 'password') && (
                <p className="text-sm text-status-error mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {validation.errors.find(e => e.field === 'password')?.message}
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="passwordConfirmation" className="block text-sm font-medium text-text-secondary mb-1.5">
                {t('resetPage.confirmPassword')} *
              </label>
              <div className="relative">
                <Input
                  id="passwordConfirmation"
                  type={showPasswordConfirmation ? 'text' : 'password'}
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  className="h-10 pr-10"
                  placeholder={t('resetPage.confirmPlaceholder')}
                />
                <Pressable
                  onClick={() => setShowPasswordConfirmation(!showPasswordConfirmation)}
                  className="w-auto text-center absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition"
                  tabIndex={-1}
                >
                  {showPasswordConfirmation ? <EyeOff size={16} /> : <Eye size={16} />}
                </Pressable>
              </div>
              {validation.errors.find(e => e.field === 'passwordConfirmation') && (
                <p className="text-sm text-status-error mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {validation.errors.find(e => e.field === 'passwordConfirmation')?.message}
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="px-4 py-3 rounded-md bg-status-error/10 border border-status-error/30 text-status-error text-sm">
                {error}
              </div>
            )}

            {/* Submit */}
            <Button size="lg"
              type="submit"
              disabled={isLoading || !validation.isValid}
              className="w-full"
            >
              {isLoading ? t('resetPage.saving') : t('resetPage.change')}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm text-accent hover:text-accent-hover transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('loginPage.backToSignIn')}
            </Link>
          </div>
    </AuthShell>
  );
}