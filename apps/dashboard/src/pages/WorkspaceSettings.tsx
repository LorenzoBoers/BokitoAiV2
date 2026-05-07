import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Trash2, Globe, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Select } from '../components/ui/select';

const TIMEZONES = [
  { value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'America/New_York', label: 'New York (EST/EDT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
];

export default function WorkspaceSettings() {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { user } = useAuth();
  const canManageWorkspace = usePermission('delete_workspace') || usePermission('invite_members');
  
  const [workspaceName, setWorkspaceName] = useState(user?.tenant.name || '');
  const [timezone, setTimezone] = useState('Europe/Amsterdam');
  const language = (i18n.resolvedLanguage === 'nl' ? 'nl' : 'en') as 'nl' | 'en';
  const [require2FA, setRequire2FA] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.size <= 1024 * 1024) { // 1MB limit
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogo(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      alert(t('fileSizeError'));
    }
  };

  const handleSave = () => {
    // In a real app, this would save to the backend
    console.log('Saving workspace settings:', {
      name: workspaceName,
      timezone,
      language,
      require2FA,
      logo
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

          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              {t('logo')}
            </label>
            <div className="flex items-center gap-4">
              {logo ? (
                <div className="relative">
                  <img
                    src={logo}
                    alt="Workspace logo"
                    className="w-16 h-16 rounded-lg object-cover border border-border"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 w-6 h-6"
                    onClick={() => setLogo(null)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center">
                  <Upload size={20} className="text-text-muted" />
                </div>
              )}
              
              <div>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleLogoUpload}
                  className="hidden"
                  id="logo-upload"
                  disabled={!canManageWorkspace}
                />
                <label htmlFor="logo-upload">
                  <Button
                    variant="secondary"
                    size="sm"
                    asChild
                    disabled={!canManageWorkspace}
                  >
                    <span>{t('uploadLogo')}</span>
                  </Button>
                </label>
                <p className="text-xs text-text-muted mt-1">
                  {t('fileHint')}
                </p>
              </div>
            </div>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              <Clock size={16} className="inline mr-2" />
              {t('timezone')}
            </label>
            <Select
              value={timezone}
              onValueChange={setTimezone}
              disabled={!canManageWorkspace}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </Select>
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