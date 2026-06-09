import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { ArrowRight, ArrowLeft, Check, Building, Table, Users, Sparkles } from 'lucide-react';
import { useValidation } from '../../context/ValidationContext';
import { cn } from '../../lib/utils';

interface OnboardingWizardProps {
  onComplete: (data: OnboardingData) => void;
  onSkip?: () => void;
}

interface OnboardingData {
  workspace: {
    name: string;
    timezone: string;
  };
  table: {
    type: 'blank' | 'template';
    templateId?: string;
    name?: string;
  };
  invites: string[];
}

const TEMPLATES = [
  {
    id: 'crm',
    name: 'CRM Contacten',
    description: 'Beheer klanten en prospects',
    icon: '👥',
    fields: ['Naam', 'E-mail', 'Telefoon', 'Bedrijf', 'Status'],
  },
  {
    id: 'tasks',
    name: 'Taakbeheer',
    description: 'Organiseer projecten en taken',
    icon: '✅',
    fields: ['Taak', 'Status', 'Prioriteit', 'Deadline', 'Toegewezen aan'],
  },
  {
    id: 'inventory',
    name: 'Voorraad',
    description: 'Beheer producten en voorraad',
    icon: '📦',
    fields: ['Product', 'SKU', 'Voorraad', 'Prijs', 'Categorie'],
  },
  {
    id: 'events',
    name: 'Evenementen',
    description: 'Plan en beheer evenementen',
    icon: '📅',
    fields: ['Evenement', 'Datum', 'Locatie', 'Deelnemers', 'Status'],
  },
];

const TIMEZONES = [
  { value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'America/New_York', label: 'New York (EST/EDT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
];

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>({
    workspace: {
      name: '',
      timezone: 'Europe/Amsterdam',
    },
    table: {
      type: 'blank',
    },
    invites: [],
  });
  const [inviteEmail, setInviteEmail] = useState('');
  
  const { validateField, getFieldError, clearErrors } = useValidation();

  const handleNext = () => {
    if (step === 1) {
      // Validate workspace name
      const isValid = validateField('workspaceName', data.workspace.name, [
        { type: 'required', message: 'Workspace naam is verplicht' },
        { type: 'minLength', value: 2, message: 'Workspace naam moet minimaal 2 karakters zijn' },
      ]);
      
      if (!isValid) return;
    }

    if (step < 3) {
      setStep(step + 1);
    } else {
      onComplete(data);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const addInvite = () => {
    if (!inviteEmail.trim()) return;
    
    const isValid = validateField('inviteEmail', inviteEmail, [
      { type: 'email', message: 'Ongeldig e-mailadres' },
    ]);
    
    if (isValid && !data.invites.includes(inviteEmail)) {
      setData(prev => ({
        ...prev,
        invites: [...prev.invites, inviteEmail],
      }));
      setInviteEmail('');
      clearErrors();
    }
  };

  const removeInvite = (email: string) => {
    setData(prev => ({
      ...prev,
      invites: prev.invites.filter(e => e !== email),
    }));
  };

  const selectTemplate = (templateId: string) => {
    setData(prev => ({
      ...prev,
      table: {
        type: 'template',
        templateId,
      },
    }));
  };

  const selectBlankTable = () => {
    setData(prev => ({
      ...prev,
      table: {
        type: 'blank',
        name: '',
      },
    }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        <div className="flex items-center justify-center mb-8">
          {[1, 2, 3].map((i) => (
            <React.Fragment key={i}>
              <div
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium',
                  i <= step
                    ? 'bg-accent text-white'
                    : 'bg-bg-elevated text-text-muted'
                )}
              >
                {i < step ? <Check size={16} /> : i}
              </div>
              {i < 3 && (
                <div
                  className={cn(
                    'w-12 h-0.5 mx-2',
                    i < step ? 'bg-accent' : 'bg-bg-elevated'
                  )}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        <Card className="p-8">
          {/* Step 1: Workspace Setup */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="text-center">
                <Building className="w-12 h-12 text-accent mx-auto mb-4" />
                <h2 className="text-2xl font-semibold text-text-heading mb-2">
                  Welkom bij Bokito.ai
                </h2>
                <p className="text-text-secondary">
                  Laten we beginnen met het instellen van je workspace
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Workspace naam *
                  </label>
                  <Input
                    placeholder="Bijv. Mijn Bedrijf"
                    value={data.workspace.name}
                    onChange={(e) => setData(prev => ({
                      ...prev,
                      workspace: { ...prev.workspace, name: e.target.value },
                    }))}
                    className={getFieldError('workspaceName') ? 'border-status-error' : ''}
                  />
                  {getFieldError('workspaceName') && (
                    <p className="text-status-error text-sm mt-1">
                      {getFieldError('workspaceName')}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Tijdzone
                  </label>
                  <select
                    value={data.workspace.timezone}
                    onChange={(e) => setData(prev => ({
                      ...prev,
                      workspace: { ...prev.workspace, timezone: e.target.value },
                    }))}
                    className="w-full px-4 py-2.5 rounded-md bg-bg-input border border-border text-text-primary text-sm focus:outline-none focus:border-border-focus transition"
                  >
                    {TIMEZONES.map(tz => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Table Setup */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="text-center">
                <Table className="w-12 h-12 text-accent mx-auto mb-4" />
                <h2 className="text-2xl font-semibold text-text-heading mb-2">
                  Je eerste tabel
                </h2>
                <p className="text-text-secondary">
                  Begin met een template of maak een lege tabel
                </p>
              </div>

              <div className="space-y-4">
                {/* Blank Table Option */}
                <div
                  onClick={selectBlankTable}
                  className={cn(
                    'p-4 border-2 rounded-lg cursor-pointer transition-colors',
                    data.table.type === 'blank'
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-border-light'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-bg-elevated rounded-lg flex items-center justify-center">
                      <Sparkles size={20} className="text-text-secondary" />
                    </div>
                    <div>
                      <h3 className="font-medium text-text-primary">Lege tabel</h3>
                      <p className="text-sm text-text-secondary">Begin vanaf nul</p>
                    </div>
                  </div>
                </div>

                {/* Template Options */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {TEMPLATES.map(template => (
                    <div
                      key={template.id}
                      onClick={() => selectTemplate(template.id)}
                      className={cn(
                        'p-4 border-2 rounded-lg cursor-pointer transition-colors',
                        data.table.templateId === template.id
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-border-light'
                      )}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{template.icon}</span>
                          <h3 className="font-medium text-text-primary">{template.name}</h3>
                        </div>
                        <p className="text-sm text-text-secondary">{template.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {template.fields.slice(0, 3).map(field => (
                            <Badge key={field} variant="secondary" className="text-xs">
                              {field}
                            </Badge>
                          ))}
                          {template.fields.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{template.fields.length - 3}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Team Invites */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="text-center">
                <Users className="w-12 h-12 text-accent mx-auto mb-4" />
                <h2 className="text-2xl font-semibold text-text-heading mb-2">
                  Nodig je team uit
                </h2>
                <p className="text-text-secondary">
                  Voeg teamleden toe aan je workspace (optioneel)
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="naam@bedrijf.nl"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addInvite()}
                    className={getFieldError('inviteEmail') ? 'border-status-error' : ''}
                  />
                  <Button onClick={addInvite} variant="secondary">
                    Add
                  </Button>
                </div>
                {getFieldError('inviteEmail') && (
                  <p className="text-status-error text-sm">
                    {getFieldError('inviteEmail')}
                  </p>
                )}

                {data.invites.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-text-secondary">
                      Uitnodigingen ({data.invites.length})
                    </h4>
                    <div className="space-y-2">
                      {data.invites.map(email => (
                        <div key={email} className="flex items-center justify-between p-2 bg-bg-elevated rounded-md">
                          <span className="text-sm text-text-primary">{email}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeInvite(email)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between items-center mt-8 pt-6 border-t border-border">
            <div className="flex gap-2">
              {step > 1 && (
                <Button variant="ghost" onClick={handleBack}>
                  <ArrowLeft size={16} />
                  Terug
                </Button>
              )}
              {onSkip && step === 1 && (
                <Button variant="ghost" onClick={onSkip}>
                  Overslaan
                </Button>
              )}
            </div>

            <Button onClick={handleNext}>
              {step === 3 ? 'Voltooien' : 'Volgende'}
              {step < 3 && <ArrowRight size={16} />}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}