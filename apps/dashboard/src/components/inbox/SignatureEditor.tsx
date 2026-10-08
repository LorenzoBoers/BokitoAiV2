import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Code,
  Eye,
  Italic,
  Link,
  Save,
  Sparkles,
  Type,
  Underline,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  composeDefaultSignatureHtml,
  renderSignatureTemplate,
  type SignatureIdentityVars,
} from '../../lib/default-signature';

interface SignatureEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSignature?: string;
  onSave: (signature: string) => void;
  /** Shown in the "for" line and used in templates; empty for user/agent signatures. */
  mailboxEmail?: string;
  /** Overrides the "for mailbox X" line (e.g. "Your personal signature"). */
  contextLabel?: string;
  /** Real identity for Preview; falls back to sample data when omitted. */
  identity?: SignatureIdentityVars | null;
}

const SAMPLE_IDENTITY: SignatureIdentityVars = {
  name: 'Jane Doe',
  company: 'Acme Inc.',
  jobTitle: 'Support Lead',
  address: '123 Main Street, Springfield',
  phone: '+1 555 0100',
  website: 'www.example.com',
  email: 'jane@example.com',
  language: 'en',
};

export default function SignatureEditor({
  open,
  onOpenChange,
  initialSignature = '',
  onSave,
  mailboxEmail = '',
  contextLabel,
  identity = null,
}: SignatureEditorProps) {
  const { t, i18n } = useTranslation('communication');
  const [signature, setSignature] = useState(initialSignature);
  const [activeTab, setActiveTab] = useState<'edit' | 'html' | 'preview'>('edit');
  const editorRef = useRef<HTMLDivElement | null>(null);
  // Latest HTML for the callback ref below, so the visual editor always mounts
  // with current content without re-running the ref on every keystroke.
  const signatureRef = useRef(signature);
  signatureRef.current = signature;

  const previewIdentity = useMemo<SignatureIdentityVars>(() => {
    const base = identity
      ? {
          ...identity,
          language: identity.language || i18n.language?.slice(0, 2) || 'nl',
          email: identity.email || mailboxEmail || SAMPLE_IDENTITY.email,
        }
      : {
          ...SAMPLE_IDENTITY,
          email: mailboxEmail || SAMPLE_IDENTITY.email,
          language: i18n.language?.slice(0, 2) || 'en',
        };
    return base;
  }, [identity, mailboxEmail, i18n.language]);

  const defaultTemplates = useMemo(() => {
    const emailToken = mailboxEmail || '{{email}}';
    return [
      {
        name: t('signatureEditor.templateModern'),
        html:
          `<p style="margin:0 0 14px 0">{{closing}},</p>` +
          `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#1f2937;` +
          `padding-left:14px;border-left:2px solid #e5e7eb">` +
          `<div style="font-weight:600;color:#111827">{{name}}</div>` +
          `<div style="color:#6b7280;font-size:13px;margin-top:2px">{{function}}</div>` +
          `<div style="color:#6b7280;font-size:13px">{{company}}</div>` +
          `<div style="margin-top:8px;font-size:12px;color:#4b5563;line-height:1.5">` +
          `${emailToken}<br>{{phone}}<br>{{website}}</div></div>`,
      },
      {
        name: t('signatureEditor.templateStandard'),
        html: `<p>${t('signatureEditor.kindRegards')},<br><br><strong>{{name}}</strong><br>{{company}}<br>${t('signatureEditor.emailAbbr')}: ${emailToken}<br>${t('signatureEditor.phoneAbbr')}: {{phone}}</p>`,
      },
      {
        name: t('signatureEditor.templateShort'),
        html: `<p>${t('signatureEditor.regards')},<br><strong>{{name}}</strong></p>`,
      },
      {
        name: t('signatureEditor.templateExtended'),
        html: `<p>${t('signatureEditor.kindRegards')},<br><br><strong>{{name}}</strong><br><em>{{function}}</em><br><br>{{company}}<br>{{address}}<br>${t('signatureEditor.emailAbbr')}: ${emailToken}<br>${t('signatureEditor.phoneAbbr')}: {{phone}}<br>${t('signatureEditor.webAbbr')}: {{website}}</p>`,
      },
    ];
  }, [mailboxEmail, t]);

  // Re-initialize when the dialog opens (possibly for a different mailbox).
  useEffect(() => {
    if (open) {
      setSignature(initialSignature);
      setActiveTab('edit');
    }
  }, [open, initialSignature]);

  // The contentEditable is uncontrolled: content is written once on mount and
  // read back on input. Binding innerHTML to state would reset the caret to the
  // start of the editor on every keystroke. Radix unmounts inactive tab content,
  // so switching Edit <-> HTML re-mounts the editor with the latest source.
  const initEditor = useCallback((node: HTMLDivElement | null) => {
    editorRef.current = node;
    if (node) {
      node.innerHTML = signatureRef.current;
    }
  }, []);

  const handleContentChange = useCallback(() => {
    if (editorRef.current) {
      setSignature(editorRef.current.innerHTML);
    }
  }, []);

  const handleCommand = useCallback(
    (command: string, value?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      handleContentChange();
    },
    [handleContentChange],
  );

  const handleSave = useCallback(() => {
    onSave(signature);
    onOpenChange(false);
  }, [signature, onSave, onOpenChange]);

  const applyTemplate = useCallback((html: string) => {
    setSignature(html);
    if (editorRef.current) {
      editorRef.current.innerHTML = html;
    }
  }, []);

  const useDynamicDefault = useCallback(() => {
    // Empty stored signature → server composes the modern avatar layout at send time.
    setSignature('');
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
  }, []);

  const previewHtml = useMemo(() => {
    const custom = signature.trim();
    if (!custom) {
      return composeDefaultSignatureHtml(previewIdentity);
    }
    return renderSignatureTemplate(custom, previewIdentity);
  }, [signature, previewIdentity]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[800px] max-w-[95vw] max-h-[90vh] bg-bg-surface border border-border rounded-lg shadow-overlay overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <Dialog.Title className="text-lg font-semibold text-text-heading">
              {t('signatureEditor.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon">
                <X size={16} />
              </Button>
            </Dialog.Close>
          </div>

          <div className="p-4 space-y-4 max-h-[calc(90vh-120px)] overflow-y-auto">
            <div className="text-sm text-text-secondary">
              {contextLabel ?? (
                <>
                  {t('signatureEditor.forMailbox')} <strong>{mailboxEmail}</strong>
                  <p className="mt-1 text-xs text-text-muted">
                    {t('signatureEditor.mailboxFallbackHint')}
                  </p>
                </>
              )}
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as 'edit' | 'html' | 'preview')}
            >
              <TabsList>
                <TabsTrigger value="edit" className="flex items-center gap-2">
                  <Type size={14} />
                  {t('signatureEditor.tabEdit')}
                </TabsTrigger>
                <TabsTrigger value="html" className="flex items-center gap-2">
                  <Code size={14} />
                  {t('signatureEditor.tabHtml')}
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-2">
                  <Eye size={14} />
                  {t('signatureEditor.tabPreview')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="edit" className="space-y-4">
                {/* Toolbar */}
                <div className="flex items-center gap-1 p-2 border border-border rounded-md bg-bg-elevated">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCommand('bold')}
                    title={t('signatureEditor.bold')}
                  >
                    <Bold size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCommand('italic')}
                    title={t('signatureEditor.italic')}
                  >
                    <Italic size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCommand('underline')}
                    title={t('signatureEditor.underline')}
                  >
                    <Underline size={14} />
                  </Button>

                  <div className="w-px h-6 bg-border mx-1" />

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const url = prompt(t('signatureEditor.enterUrl'));
                      if (url) handleCommand('createLink', url);
                    }}
                    title={t('signatureEditor.addLink')}
                  >
                    <Link size={14} />
                  </Button>
                </div>

                {/* Editor */}
                <div className="border border-border rounded-md">
                  <div
                    ref={initEditor}
                    contentEditable
                    className="min-h-[200px] p-4 focus:outline-none focus:ring-2 focus:ring-accent/20 text-sm"
                    style={{ fontFamily: 'system-ui, sans-serif' }}
                    onInput={handleContentChange}
                    suppressContentEditableWarning
                  />
                </div>

                {!signature.trim() && (
                  <p className="text-xs text-text-muted">{t('signatureEditor.dynamicDefaultHint')}</p>
                )}

                {/* Templates */}
                <div>
                  <h4 className="text-sm font-medium text-text-heading mb-2">
                    {t('signatureEditor.templates')}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={useDynamicDefault}
                      className="text-left justify-start"
                    >
                      <Sparkles size={14} className="shrink-0" />
                      {t('signatureEditor.useDynamicDefault')}
                    </Button>
                    {defaultTemplates.map((template) => (
                      <Button
                        key={template.name}
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => applyTemplate(template.html)}
                        className="text-left justify-start"
                      >
                        {template.name}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-text-muted space-y-1">
                  <p>
                    <strong>{t('signatureEditor.tipTitle')}</strong>{' '}
                    {t('signatureEditor.tipVariables')}
                  </p>
                  <p>{t('signatureEditor.tipReplaced')}</p>
                </div>
              </TabsContent>

              <TabsContent value="html" className="space-y-4">
                <textarea
                  value={signature}
                  onChange={(event) => setSignature(event.target.value)}
                  spellCheck={false}
                  aria-label={t('signatureEditor.htmlAria')}
                  placeholder={`<p>${t('signatureEditor.kindRegards')},<br><strong>{{name}}</strong></p>`}
                  className="min-h-[280px] w-full resize-y rounded-md border border-border bg-bg-elevated p-4 font-mono text-xs leading-relaxed text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                <div className="text-xs text-text-muted space-y-1">
                  <p>{t('signatureEditor.htmlHint1')}</p>
                  <p>{t('signatureEditor.htmlHint2')}</p>
                </div>
              </TabsContent>

              <TabsContent value="preview" className="space-y-4">
                <div className="border border-border rounded-md p-4 bg-white text-black min-h-[200px]">
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                </div>
                <p className="text-xs text-text-muted">
                  {identity
                    ? t('signatureEditor.previewHintIdentity')
                    : t('signatureEditor.previewHint')}
                </p>
              </TabsContent>
            </Tabs>
          </div>

          <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-bg-elevated">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('signatureEditor.cancel')}
            </Button>
            <Button onClick={handleSave}>
              <Save size={14} />
              {t('signatureEditor.save')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
