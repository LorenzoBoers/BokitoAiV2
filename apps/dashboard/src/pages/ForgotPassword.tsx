import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { requestPasswordReset } from '../lib/api';
import { ValidatedInput, ValidationRules, useFormValidation } from '../components/ui/form-validation';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const validation = useFormValidation(
    { email },
    {
      email: [
        ValidationRules.required('Email'),
        ValidationRules.email('Email'),
      ],
    }
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validation.isValid) return;

    setIsLoading(true);
    try {
      const result = await requestPasswordReset(email);
      if (result.dev_link) {
        setDevLink(result.dev_link);
      }
      setIsSuccess(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Password reset request failed');
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
          <div className="bg-bg-surface border border-border/60 rounded-xl p-8 shadow-overlay animate-page-enter text-center">
            <CheckCircle className="w-16 h-16 text-status-success mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-text-heading mb-2">
              Email sent
            </h1>
            <p className="text-text-secondary mb-6">
              We sent a password reset link to <strong>{email}</strong>.
              Check your inbox and spam folder.
            </p>
            {devLink ? (
              <div className="mb-6 rounded-md border border-border bg-bg-input/50 px-4 py-3 text-left text-sm">
                <p className="font-medium text-text-heading mb-1">Local dev reset link</p>
                <p className="text-text-secondary mb-2">No SMTP in dev — use this link instead:</p>
                <Link to={devLink} className="break-all text-accent hover:text-accent-hover">
                  {devLink}
                </Link>
              </div>
            ) : null}
            
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-accent hover:text-accent-hover transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to sign in
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
          <span className="text-sm text-text-secondary mt-1">Forgot password</span>
        </div>

        {/* Card */}
        <div className="bg-bg-surface border border-border/60 rounded-xl p-8 shadow-overlay animate-page-enter">
          <div className="text-center mb-6">
            <Mail className="w-12 h-12 text-accent mx-auto mb-3" />
            <h1 className="text-xl font-semibold text-text-heading mb-2">
              Reset password
            </h1>
            <p className="text-sm text-text-secondary">
              Enter your email and we will send you a link to reset your password.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <ValidatedInput
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={validation.errors.find(e => e.field === 'email')?.message}
              placeholder="you@company.com"
              required
              autoFocus
            />

            <button
              type="submit"
              disabled={isLoading || !validation.isValid}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-semibold text-white bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {isLoading ? 'Sending...' : 'Send reset link'}
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