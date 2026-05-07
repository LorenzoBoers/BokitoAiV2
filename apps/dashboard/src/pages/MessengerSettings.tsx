import { MessageSquare, Search, Send, SlidersHorizontal } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Switch } from '../components/ui/switch'

export default function MessengerSettings() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1120px] flex-col py-2">
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div>
          <h2 className="text-base font-semibold text-text-heading">Messenger</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Choose what you want to customize.
          </p>
        </div>
        <Button size="sm">Save changes</Button>
      </div>

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <div className="min-h-0 overflow-auto rounded-2xl border border-border/70 bg-bg-surface/90 p-4">
          <Tabs defaultValue="customization" className="space-y-4">
            <TabsList>
              <TabsTrigger value="customization">Customization</TabsTrigger>
              <TabsTrigger value="conversations">Conversations</TabsTrigger>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="installation">Installation</TabsTrigger>
            </TabsList>

            <TabsContent value="customization" className="space-y-3">
              <div className="rounded-xl border border-border/65 bg-bg-input/45 p-3">
                <p className="text-sm font-medium text-text-heading">Enabled modules</p>
                <p className="mt-1 text-xs text-text-secondary">
                  Configure which modules should be available in your messenger.
                </p>
                <div className="mt-3 space-y-2">
                  {[
                    { label: 'Home', enabled: true },
                    { label: 'Messages', enabled: true },
                    { label: 'Help', enabled: true },
                    { label: 'Changelog', enabled: false },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between rounded-lg border border-border/60 bg-bg-surface/85 px-3 py-2">
                      <span className="text-sm text-text-primary">{item.label}</span>
                      <Switch checked={item.enabled} aria-label={item.label} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border/65 bg-bg-input/45 p-3">
                <p className="text-sm font-medium text-text-heading">Welcome message</p>
                <Input className="mt-2" defaultValue="Hi, how can we help you today?" />
              </div>
            </TabsContent>

            <TabsContent value="conversations" className="rounded-xl border border-border/65 bg-bg-input/45 p-3 text-sm text-text-secondary">
              Conversation defaults UX placeholder.
            </TabsContent>
            <TabsContent value="general" className="rounded-xl border border-border/65 bg-bg-input/45 p-3 text-sm text-text-secondary">
              General settings UX placeholder.
            </TabsContent>
            <TabsContent value="installation" className="rounded-xl border border-border/65 bg-bg-input/45 p-3 text-sm text-text-secondary">
              Installation UX placeholder.
            </TabsContent>
          </Tabs>
        </div>

        <div className="min-h-0 overflow-auto rounded-2xl border border-border/70 bg-bg-surface/90 p-4">
          <p className="mb-3 text-sm font-medium text-text-heading">Preview</p>
          <div className="mx-auto w-full max-w-[290px] rounded-[18px] border border-border/65 bg-bg-elevated/80 p-3 shadow-[0_20px_35px_-28px_rgba(15,23,42,0.45)]">
            <div className="rounded-xl bg-gradient-to-b from-accent/90 to-accent/30 p-4 text-white">
              <p className="text-[26px] font-semibold leading-tight">Hi, Preview user</p>
              <p className="text-[26px] font-semibold leading-tight">How can we help you today?</p>
            </div>
            <div className="mt-3 space-y-2">
              <button type="button" className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-bg-surface px-3 py-2 text-sm text-text-primary">
                <span>Send us a message</span>
                <Send size={13} className="text-text-muted" />
              </button>
              <button type="button" className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-bg-surface px-3 py-2 text-sm text-text-primary">
                <span>Search for help</span>
                <Search size={13} className="text-text-muted" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-4 border-t border-border/60 pt-3 text-center text-2xs text-text-muted">
              <div className="space-y-1">
                <MessageSquare size={12} className="mx-auto" />
                <p>Home</p>
              </div>
              <div className="space-y-1">
                <MessageSquare size={12} className="mx-auto" />
                <p>Messages</p>
              </div>
              <div className="space-y-1">
                <Search size={12} className="mx-auto" />
                <p>Help</p>
              </div>
              <div className="space-y-1">
                <SlidersHorizontal size={12} className="mx-auto" />
                <p>Settings</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
