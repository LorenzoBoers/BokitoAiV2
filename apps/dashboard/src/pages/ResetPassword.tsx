import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ValidationRules, useFormValidation } from '../components/ui/form-validation';

export default function ResetPassword() {
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

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      navigate('/login');
    }
  }, [token, navigate]);

  const validation = useFormValidation(
    { password, passwordConfirmation },
    {
      password: [
        ValidationRules.required('Password'),
        ValidationRules.minLength(8, 'Password'),
      ],
      passwordConfirmation: [
        ValidationRules.required('Password confirmation'),
        (value: string) => {
          if (value !== password) {
            return 'Passwords do not match';
          }
          return null;
        },
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
      
      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
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
          </div>

          {/* Success Card */}
          <div className="bg-bg-surface border border-border rounded-xl p-8 shadow-xl text-center">
            <CheckCircle className="w-16 h-16 text-status-success mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-text-heading mb-2">
              Password reset
            </h1>
            <p className="text-text-secondary mb-6">
              Your password has been changed. You will be redirected to the sign-in page.
            </p>
            
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
            >
              Sign in now
            </Link>
          </div>

          <p className="text-center text-xs text-text-muted mt-6">
            © {new Date().getFullYear()} Bokito.ai · All rights reserved
          </p>
        </div>
      </div>
    );
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
          <span className="text-sm text-text-secondary mt-1">Set a new password</span>
        </div>

        {/* Card */}
        <div className="bg-bg-surface border border-border rounded-xl p-8 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* New Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1.5">
                New password *
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 rounded-md bg-bg-input border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-border-focus transition"
                  placeholder="At least 8 characters"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
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
                Confirm password *
              </label>
              <div className="relative">
                <input
                  id="passwordConfirmation"
                  type={showPasswordConfirmation ? 'text' : 'password'}
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 rounded-md bg-bg-input border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-border-focus transition"
                  placeholder="Repeat your new password"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordConfirmation(!showPasswordConfirmation)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition"
                  tabIndex={-1}
                >
                  {showPasswordConfirmation ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
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
            <button
              type="submit"
              disabled={isLoading || !validation.isValid}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold text-white bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {isLoading ? 'Saving...' : 'Change password'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm text-accent hover:text-accent-hover transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to sign in
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-text-muted mt-6">
          © {new Date().getFullYear()} Bokito.ai · All rights reserved
        </p>
      </div>
    </div>
  );
}