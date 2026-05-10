import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Paintbrush, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Select } from '../components/ui/select';


export default function WorkspaceSettings() {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { user } = useAuth();
  const canManageWorkspace = usePermission('delete_workspace') || usePermission('invite_members');
  
  const [workspaceName, setWorkspaceName] = useState(user?.tenant.name || '');
  const language = (i18n.resolvedLanguage === 'nl' ? 'nl' : 'en') as 'nl' | 'en';
  const [require2FA, setRequire2FA] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);


  const handleSave = () => {
    // In a real app, this would save to the backend
    console.log('Saving workspace settings:', {
      name: workspaceName,
      language,
      require2FA,
    });
    alert(t('saveSuccess'));
  };

  const handleDeleteWorkspace = () => {
    if (deleteConfirmation === workspaceName) {
      // In a real app, this would delete the workspace
      console.log('Deleting workspace:', workspaceName);
      alert(t('deleteDemoNotice'));
      setShowDeleteDialog(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-heading mb-2">
          {t('title')}
        </h1>
        <p className="text-text-muted">
          {t('description')}
        </p>
      </div>

      {/* General Settings */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-text-heading mb-4">
          {t('generalTitle')}
        </h2>
        
        <div className="space-y-6">
          {/* Workspace Name */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              {t('workspaceName')}
            </label>
            <Input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              disabled={!canManageWorkspace}
              className="max-w-md"
            />
          </div>

          {/* Branding link */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Branding
            </label>
            <Link
              to="/settings/branding"
              className="flex items-center justify-between gap-3 rounded-lg border border-border/55 bg-bg-input/40 px-4 py-3 hover:bg-bg-hover/50 hover:border-border/80 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Paintbrush size={15} className="text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-heading">Organisatie branding</p>
                  <p className="text-xs text-text-muted">Logo, kleuren en huisstijl beheren</p>
                </div>
              </div>
              <ArrowRight size={15} className="text-text-muted group-hover:text-text-secondary transition-colors" />
            </Link>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              <Globe size={16} className="inline mr-2" />
              {t('language')}
            </label>
            <div className="flex gap-2">
              <Button
                variant={language === 'nl' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => i18n.changeLanguage('nl')}
                disabled={!canManageWorkspace}
              >
                {t('languageDutch')}
              </Button>
              <Button
                variant={language === 'en' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => i18n.changeLanguage('en')}
                disabled={!canManageWorkspace}
              >
                {t('languageEnglish')}
              </Button>
            </div>
          </div>
        </div>

        {canManageWorkspace && (
          <div className="flex justify-end mt-6 pt-6 border-t border-border">
            <Button onClick={handleSave}>
              {t('saveSettings')}
            </Button>
          </div>
        )}
      </Card>

      {/* Security Settings */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-text-heading mb-4">
          {t('securityTitle')}
        </h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-text-primary">
                {t('require2faTitle')}
              </h3>
              <p className="text-sm text-text-muted">
                {t('require2faDescription')}
              </p>
            </div>
            <Button
              variant={require2FA ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setRequire2FA(!require2FA)}
              disabled={!usePermission('delete_workspace')} // Only owners
            >
              {require2FA ? t('enabled') : t('disabled')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Danger Zone */}
      {usePermission('delete_workspace') && (
        <Card className="p-6 border-red-200 bg-red-50/50">
          <h2 className="text-lg font-semibold text-red-800 mb-4">
            {t('dangerTitle')}
          </h2>
          
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-red-700 mb-2">
                {t('deleteWorkspaceTitle')}
              </h3>
              <p className="text-sm text-red-600 mb-4">
                {t('deleteWorkspaceDescription')}
              </p>
              
              <Button
                variant="destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                {t('deleteWorkspaceButton')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-text-heading mb-4">
              {t('deleteDialogTitle')}
            </h3>
            
            <p className="text-text-muted mb-4">
              {t('deleteDialogPrompt', { name: workspaceName })}
            </p>
            
            <Input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder={t('workspaceNamePlaceholder')}
              className="mb-4"
            />
            
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setDeleteConfirmation('');
                }}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteWorkspace}
                disabled={deleteConfirmation !== workspaceName}
              >
                {t('deleteConfirmButton')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}