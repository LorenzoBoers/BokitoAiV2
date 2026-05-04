import { useState, useRef, useCallback } from 'react';
import { 
  Bold, 
  Italic, 
  Underline, 
  Link, 
  Image, 
  Type,
  Eye,
  Save,
  X
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

interface SignatureEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSignature?: string;
  onSave: (signature: string) => void;
  mailboxEmail: string;
}

export default function SignatureEditor({ 
  open, 
  onOpenChange, 
  initialSignature = '', 
  onSave,
  mailboxEmail 
}: SignatureEditorProps) {
  const [signature, setSignature] = useState(initialSignature);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const editorRef = useRef<HTMLDivElement>(null);

  const handleCommand = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setSignature(editorRef.current.innerHTML);
    }
  }, []);

  const handleSave = useCallback(() => {
    onSave(signature);
    onOpenChange(false);
  }, [signature, onSave, onOpenChange]);

  const handleContentChange = useCallback(() => {
    if (editorRef.current) {
      setSignature(editorRef.current.innerHTML);
    }
  }, []);

  const insertTemplate = useCallback((template: string) => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const templateNode = document.createElement('span');
      templateNode.innerHTML = template;
      range.insertNode(templateNode);
      handleContentChange();
    }
  }, [handleContentChange]);

  const defaultTemplates = [
    {
      name: 'Standaard zakelijk',
      html: `<p>Met vriendelijke groet,<br><br><strong>{{name}}</strong><br>{{company}}<br>E: ${mailboxEmail}<br>T: +31 20 123 4567</p>`
    },
    {
      name: 'Kort & bondig',
      html: `<p>Groet,<br><strong>{{name}}</strong></p>`
    },
    {
      name: 'Uitgebreid',
      html: `<p>Met vriendelijke groet,<br><br><strong>{{name}}</strong><br><em>{{function}}</em><br><br>{{company}}<br>{{address}}<br>E: ${mailboxEmail}<br>T: {{phone}}<br>W: {{website}}</p>`
    }
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[800px] max-w-[95vw] max-h-[90vh] bg-bg-surface border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <Dialog.Title className="text-lg font-semibold text-text-heading">
              E-mail handtekening bewerken
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon">
                <X size={16} />
              </Button>
            </Dialog.Close>
          </div>

          <div className="p-4 space-y-4 max-h-[calc(90vh-120px)] overflow-y-auto">
            <div className="text-sm text-text-secondary">
              Voor mailbox: <strong>{mailboxEmail}</strong>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'edit' | 'preview')}>
              <TabsList>
                <TabsTrigger value="edit" className="flex items-center gap-2">
                  <Type size={14} />
                  Bewerken
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-2">
                  <Eye size={14} />
                  Voorbeeld
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
                    title="Vetgedrukt"
                  >
                    <Bold size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCommand('italic')}
                    title="Cursief"
                  >
                    <Italic size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCommand('underline')}
                    title="Onderstreept"
                  >
                    <Underline size={14} />
                  </Button>
                  
                  <div className="w-px h-6 bg-border mx-1" />
                  
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const url = prompt('Voer URL in:');
                      if (url) handleCommand('createLink', url);
                    }}
                    title="Link toevoegen"
                  >
                    <Link size={14} />
                  </Button>
                </div>

                {/* Editor */}
                <div className="border border-border rounded-md">
                  <div
                    ref={editorRef}
                    contentEditable
                    className="min-h-[200px] p-4 focus:outline-none focus:ring-2 focus:ring-accent/20 text-sm"
                    style={{ fontFamily: 'system-ui, sans-serif' }}
                    dangerouslySetInnerHTML={{ __html: signature }}
                    onInput={handleContentChange}
                    suppressContentEditableWarning
                  />
                </div>

                {/* Templates */}
                <div>
                  <h4 className="text-sm font-medium text-text-heading mb-2">Sjablonen</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {defaultTemplates.map((template) => (
                      <Button
                        key={template.name}
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSignature(template.html);
                          if (editorRef.current) {
                            editorRef.current.innerHTML = template.html;
                          }
                        }}
                        className="text-left justify-start"
                      >
                        {template.name}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-text-muted space-y-1">
                  <p><strong>Tip:</strong> Gebruik variabelen zoals {'{{name}}'}, {'{{company}}'}, {'{{function}}'} voor dynamische content.</p>
                  <p>Deze worden automatisch vervangen bij het versturen van e-mails.</p>
                </div>
              </TabsContent>

              <TabsContent value="preview" className="space-y-4">
                <div className="border border-border rounded-md p-4 bg-white text-black min-h-[200px]">
                  <div 
                    dangerouslySetInnerHTML={{ 
                      __html: signature
                        .replace(/\{\{name\}\}/g, 'Jan Jansen')
                        .replace(/\{\{company\}\}/g, 'VBA Accountancy')
                        .replace(/\{\{function\}\}/g, 'Senior Accountant')
                        .replace(/\{\{address\}\}/g, 'Hoofdstraat 123, 1234 AB Amsterdam')
                        .replace(/\{\{phone\}\}/g, '+31 20 123 4567')
                        .replace(/\{\{website\}\}/g, 'www.vba-accountancy.nl')
                    }} 
                  />
                </div>
                <p className="text-xs text-text-muted">
                  Dit is hoe je handtekening eruit ziet met voorbeeldgegevens.
                </p>
              </TabsContent>
            </Tabs>
          </div>

          <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-bg-elevated">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Annuleren
            </Button>
            <Button onClick={handleSave}>
              <Save size={14} />
              Opslaan
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}