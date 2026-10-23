import { Pressable } from '../components/ui/pressable'
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { requestPasswordReset } from '../lib/api';
import { ValidatedInput, useFormValidation } from '../components/ui/form-validation';
import { AuthShell } from '../components/auth/AuthShell';
import { Button } from '../components/ui/button';
import { TextLink } from '../components/ui/text-link';

export default function ForgotPassword() {
  const { t } = useTranslation('nav');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const validation = useFormValidation(
    { email },
    {
      email: [
        (value: string) => (value ? null : t('forgotPage.emailRequired')),
        (value: string) =>
          value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? t('forgotPage.emailInvalid') : null,
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
      toast.error(error instanceof Error ? error.message : t('forgotPage.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <AuthShell cardClassName="text-center">
            <CheckCircle className="w-16 h-16 text-status-success mx-auto mb-4" />
            <h1 className="title-page mb-2">
              {t('forgotPage.sentTitle')}
            </h1>
            <p className="text-text-secondary mb-6">
              {t('forgotPage.sentBody', { email })}
            </p>
            {devLink ? (
              <div className="mb-6 rounded-md border border-border bg-bg-input/50 px-4 py-3 text-left text-sm">
                <p className="font-medium text-text-heading mb-1">{t('forgotPage.devTitle')}</p>
                <p className="text-text-secondary mb-2">{t('forgotPage.devBody')}</p>
                <Link to={devLink} className="break-all text-accent hover:text-accent-hover">
                  {devLink}
                </Link>
                <TextLink
                  type="button"
                  className="mt-2 text-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(devLink).then(
                      () => toast.success(t('forgotPage.copied')),
                      () => toast.error(t('forgotPage.failed')),
                    )
                  }}
                >
                  {t('forgotPage.copyLink')}
                </TextLink>
              </div>
            ) : null}
            <Pressable
              type="button"
              className="mb-4 block w-full text-sm font-medium text-accent hover:underline"
              onClick={() => {
                setIsSuccess(false)
                setDevLink(null)
              }}
            >
              {t('forgotPage.tryDifferent')}
            </Pressable>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-accent hover:text-accent-hover transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('loginPage.backToSignIn')}
            </Link>
    </AuthShell>
    );
  }

  return (
    <AuthShell subtitle={t('forgotPage.subtitle')}>
          <div className="text-center mb-6">
            <Mail className="w-12 h-12 text-accent mx-auto mb-3" />
            <h1 className="title-page mb-2">
              {t('forgotPage.title')}
            </h1>
            <p className="text-sm text-text-secondary">
              {t('forgotPage.body')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <ValidatedInput
              label={t('loginPage.email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={validation.errors.find(e => e.field === 'email')?.message}
              placeholder={t('forgotPage.emailPlaceholder')}
              required
              autoFocus
            />

            <Button size="lg"
              type="submit"
              disabled={isLoading || !validation.isValid}
              className="w-full"
            >
              {isLoading ? t('forgotPage.sending') : t('forgotPage.sendLink')}
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