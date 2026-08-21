import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold,
  Code,
  Eye,
  Italic,
  Link,
  Save,
  Type,
  Underline,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

interface SignatureEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSignature?: string;
  onSave: (signature: string) => void;
  mailboxEmail: string;
}

const SAMPLE_VARIABLES: Record<string, string> = {
  name: 'Jane Doe',
  company: 'Acme Inc.',
  function: 'Support Lead',
  address: '123 Main Street, Springfield',
  phone: '+1 555 0100',
  website: 'www.example.com',
};

function withSampleData(html: string): string {
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    SAMPLE_VARIABLES[key] ?? match,
  );
}

export default function SignatureEditor({
  open,
  onOpenChange,
  initialSignature = '',
  onSave,
  mailboxEmail,
}: SignatureEditorProps) {
  const [signature, setSignature] = useState(initialSignature);
  const [activeTab, setActiveTab] = useState<'edit' | 'html' | 'preview'>('edit');
  const editorRef = useRef<HTMLDivElement | null>(null);
  // Latest HTML for the callback ref below, so the visual editor always mounts
  // with current content without re-running the ref on every keystroke.
  const signatureRef = useRef(signature);
  signatureRef.current = signature;

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

  const defaultTemplates = [
    {
      name: 'Standard business',
      html: `<p>Kind regards,<br><br><strong>{{name}}</strong><br>{{company}}<br>E: ${mailboxEmail}<br>T: {{phone}}</p>`,
    },
    {
      name: 'Short',
      html: `<p>Regards,<br><strong>{{name}}</strong></p>`,
    },
    {
      name: 'Extended',
      html: `<p>Kind regards,<br><br><strong>{{name}}</strong><br><em>{{function}}</em><br><br>{{company}}<br>{{address}}<br>E: ${mailboxEmail}<br>T: {{phone}}<br>W: {{website}}</p>`,
    },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[800px] max-w-[95vw] max-h-[90vh] bg-bg-surface border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <Dialog.Title className="text-lg font-semibold text-text-heading">
              Edit email signature
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon">
                <X size={16} />
              </Button>
            </Dialog.Close>
          </div>

          <div className="p-4 space-y-4 max-h-[calc(90vh-120px)] overflow-y-auto">
            <div className="text-sm text-text-secondary">
              For mailbox: <strong>{mailboxEmail}</strong>
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as 'edit' | 'html' | 'preview')}
            >
              <TabsList>
                <TabsTrigger value="edit" className="flex items-center gap-2">
                  <Type size={14} />
                  Edit
                </TabsTrigger>
                <TabsTrigger value="html" className="flex items-center gap-2">
                  <Code size={14} />
                  HTML
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-2">
                  <Eye size={14} />
                  Preview
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
                    title="Bold"
                  >
                    <Bold size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCommand('italic')}
                    title="Italic"
                  >
                    <Italic size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCommand('underline')}
                    title="Underline"
                  >
                    <Underline size={14} />
                  </Button>

                  <div className="w-px h-6 bg-border mx-1" />

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const url = prompt('Enter URL:');
                      if (url) handleCommand('createLink', url);
                    }}
                    title="Add link"
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

                {/* Templates */}
                <div>
                  <h4 className="text-sm font-medium text-text-heading mb-2">Templates</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                  <p><strong>Tip:</strong> Use variables like {'{{name}}'}, {'{{company}}'}, {'{{function}}'} for dynamic content.</p>
                  <p>These are replaced automatically when sending emails.</p>
                </div>
              </TabsContent>

              <TabsContent value="html" className="space-y-4">
                <textarea
                  value={signature}
                  onChange={(event) => setSignature(event.target.value)}
                  spellCheck={false}
                  aria-label="Signature HTML source"
                  placeholder={'<p>Kind regards,<br><strong>{{name}}</strong></p>'}
                  className="min-h-[280px] w-full resize-y rounded-md border border-border bg-bg-elevated p-4 font-mono text-xs leading-relaxed text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                <div className="text-xs text-text-muted space-y-1">
                  <p>
                    Edit or paste the raw HTML of your signature, for example one exported
                    from a signature generator. Inline styles are kept as-is when sending.
                  </p>
                  <p>Switch to Preview to check the result before saving.</p>
                </div>
              </TabsContent>

              <TabsContent value="preview" className="space-y-4">
                <div className="border border-border rounded-md p-4 bg-white text-black min-h-[200px]">
                  <div dangerouslySetInnerHTML={{ __html: withSampleData(signature) }} />
                </div>
                <p className="text-xs text-text-muted">
                  This is how your signature looks with sample data.
                </p>
              </TabsContent>
            </Tabs>
          </div>

          <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-bg-elevated">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              <Save size={14} />
              Save
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
