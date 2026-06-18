import { useMemo, useState } from 'react'
import {
  Bot,
  ChevronRight,
  Code2,
  List,
  Palette,
  Play,
  RotateCcw,
  Rocket,
  Save,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  MessageSquare,
} from 'lucide-react'

export interface AssistantEditorConfig {
  name: string
  tagline: string
  avatarInitials: string
  avatarColor: string
  primaryColor: string
  userBubbleColor: string
  backgroundColor: string
  fontFamily: string
  widgetWidth: number
  welcomeMessage: string
  model: string
  language: string
  temperature: number
  wakeTemplate: string
  launcherPosition: 'bottom-right' | 'bottom-left'
  launcherLabel: string
  showLauncherLabel: boolean
  openOnLoad: boolean
  systemPrompt: string
}

type SectionId = 'uiterlijk' | 'begroeting' | 'launcher' | 'systeem' | 'embed'

const SECTION_META: Array<{ id: SectionId; title: string; icon: React.ElementType }> = [
  { id: 'uiterlijk', title: 'Uiterlijk', icon: Palette },
  { id: 'begroeting', title: 'Begroeting', icon: MessageSquare },
  { id: 'launcher', title: 'Launcher', icon: Rocket },
  { id: 'systeem', title: 'Systeem', icon: Settings2 },
  { id: 'embed', title: 'Embed', icon: Code2 },
]

function SectionCard({
  title,
  icon: Icon,
  isOpen,
  onToggle,
  children,
}: {
  title: string
  icon: React.ElementType
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-bg-surface/85 backdrop-blur-sm shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full h-10 px-3.5 flex items-center gap-2 text-left hover:bg-bg-hover/60 transition-colors"
      >
        <Icon size={13} className="text-text-muted" />
        <span className="text-xs font-semibold text-text-secondary flex-1">{title}</span>
        <ChevronRight
          size={13}
          className={`text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
      </button>
      {isOpen ? <div className="px-3.5 pb-3.5">{children}</div> : null}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] text-text-secondary mb-1">{children}</label>
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-9 w-full rounded-md border border-border bg-bg-input px-3 text-sm ${props.className ?? ''}`} />
}

export default function AssistantEditor({
  config,
  onChange,
  onSave,
  onBack,
  onReset,
}: {
  config: AssistantEditorConfig
  onChange: (next: AssistantEditorConfig) => void
  onSave: () => void
  onBack: () => void
  onReset: () => void
}) {
  const [openSections, setOpenSections] = useState<Set<SectionId>>(new Set(['uiterlijk']))
  const [activeDockItem, setActiveDockItem] = useState<'run' | 'config' | 'logs'>('config')

  const setField = <K extends keyof AssistantEditorConfig>(key: K, value: AssistantEditorConfig[K]) => {
    onChange({ ...config, [key]: value })
  }

  const toggleSection = (section: SectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const embedSnippet = useMemo(
    () => `<script
  src="/chat-widget/external/bokito-chat.js"
  data-bokito-chat-widget
  data-agent-slug="bokito-webchat"
  data-api-url=""
  data-bot-name="${config.name}"
  data-primary-color="${config.primaryColor}"
  data-position="${config.launcherPosition}"
  defer
></script>`,
    [config.name, config.primaryColor, config.launcherPosition],
  )

  return (
    <div className="relative h-full min-h-0 rounded-xl border border-border overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundColor: 'rgb(var(--color-bg-surface))',
          backgroundImage: 'radial-gradient(circle, rgba(var(--color-border),0.55) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative z-10 h-full min-h-0 flex flex-col">
        <div className="h-12 px-4 border-b border-border/70 bg-bg-surface/70 backdrop-blur-sm flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-heading truncate">Workforce Assistent Editor</div>
              <div className="text-[11px] text-text-secondary truncate">Styling en gedrag voor de assistent op workforce</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="h-8 px-3 rounded-md border border-border text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              Terug naar canvas
            </button>
            <button
              type="button"
              onClick={onSave}
              className="h-8 px-3 rounded-md bg-accent text-white text-xs font-semibold hover:bg-accent-hover transition-colors"
            >
              Save
            </button>
          </div>
        </div>

        <div className="p-4 pb-24 h-full min-h-0 overflow-y-auto">
          <div className="rounded-2xl border-2 border-emerald-400/45 bg-bg-surface/90 shadow-sm p-3 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-400/15 border border-emerald-400/30">
                <Bot size={18} className="text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className="text-base font-semibold text-text-heading truncate">{config.name}</div>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                </div>
                <div className="text-xs text-text-secondary truncate">{config.model} · actief</div>
                <div className="mt-2 inline-flex items-center rounded-md bg-emerald-400/15 text-emerald-500 px-2 py-0.5 text-[10px] font-semibold">
                  Cloud Agent
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div className="space-y-3">
              <SectionCard title={SECTION_META[0].title} icon={SECTION_META[0].icon} isOpen={openSections.has('uiterlijk')} onToggle={() => toggleSection('uiterlijk')}>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Bot naam</Label>
                      <TextInput value={config.name} onChange={(event) => setField('name', event.target.value)} />
                    </div>
                    <div>
                      <Label>Tagline</Label>
                      <TextInput value={config.tagline} onChange={(event) => setField('tagline', event.target.value)} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold" style={{ background: config.avatarColor, color: '#0f172a' }}>
                      {config.avatarInitials}
                    </div>
                    <TextInput
                      value={config.avatarInitials}
                      onChange={(event) => setField('avatarInitials', event.target.value.slice(0, 2).toUpperCase())}
                    />
                    <input
                      type="color"
                      value={config.avatarColor}
                      onChange={(event) => setField('avatarColor', event.target.value)}
                      className="w-8 h-8 rounded-md bg-transparent p-0 border-0"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label>Accent</Label>
                      <input type="color" value={config.primaryColor} onChange={(event) => setField('primaryColor', event.target.value)} className="w-full h-9 rounded-md bg-transparent p-0 border-0" />
                    </div>
                    <div>
                      <Label>Bubbel</Label>
                      <input type="color" value={config.userBubbleColor} onChange={(event) => setField('userBubbleColor', event.target.value)} className="w-full h-9 rounded-md bg-transparent p-0 border-0" />
                    </div>
                    <div>
                      <Label>Achtergrond</Label>
                      <input type="color" value={config.backgroundColor} onChange={(event) => setField('backgroundColor', event.target.value)} className="w-full h-9 rounded-md bg-transparent p-0 border-0" />
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                    <div>
                      <Label>Lettertype</Label>
                      <select className="h-9 w-full rounded-md border border-border bg-bg-input px-3 text-sm" value={config.fontFamily} onChange={(event) => setField('fontFamily', event.target.value)}>
                        <option value="Inter">Inter</option>
                        <option value="DM Sans">DM Sans</option>
                        <option value="Poppins">Poppins</option>
                        <option value="Montserrat">Montserrat</option>
                      </select>
                    </div>
                    <div className="text-xs text-text-muted pb-2">Breedte: {config.widgetWidth}px</div>
                  </div>
                  <input
                    type="range"
                    min={300}
                    max={480}
                    step={10}
                    className="w-full accent-accent"
                    value={config.widgetWidth}
                    onChange={(event) => setField('widgetWidth', Number(event.target.value))}
                  />
                </div>
              </SectionCard>

              <SectionCard title={SECTION_META[1].title} icon={SECTION_META[1].icon} isOpen={openSections.has('begroeting')} onToggle={() => toggleSection('begroeting')}>
                <div className="space-y-3">
                  <div>
                    <Label>Welkomstbericht</Label>
                    <textarea
                      rows={3}
                      className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm"
                      value={config.welcomeMessage}
                      onChange={(event) => setField('welcomeMessage', event.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Wake template</Label>
                    <textarea
                      rows={4}
                      className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm"
                      value={config.wakeTemplate}
                      onChange={(event) => setField('wakeTemplate', event.target.value)}
                    />
                  </div>
                </div>
              </SectionCard>

              <SectionCard title={SECTION_META[2].title} icon={SECTION_META[2].icon} isOpen={openSections.has('launcher')} onToggle={() => toggleSection('launcher')}>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setField('launcherPosition', 'bottom-right')}
                      className={`h-9 rounded-md border text-xs transition-colors ${config.launcherPosition === 'bottom-right' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary hover:bg-bg-hover'}`}
                    >
                      Rechts
                    </button>
                    <button
                      type="button"
                      onClick={() => setField('launcherPosition', 'bottom-left')}
                      className={`h-9 rounded-md border text-xs transition-colors ${config.launcherPosition === 'bottom-left' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary hover:bg-bg-hover'}`}
                    >
                      Links
                    </button>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                      <input type="checkbox" checked={config.showLauncherLabel} onChange={(event) => setField('showLauncherLabel', event.target.checked)} />
                      Toon launcher label
                    </label>
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                      <input type="checkbox" checked={config.openOnLoad} onChange={(event) => setField('openOnLoad', event.target.checked)} />
                      Auto-open bij laden
                    </label>
                  </div>
                  {config.showLauncherLabel ? (
                    <div>
                      <Label>Launcher label</Label>
                      <TextInput value={config.launcherLabel} onChange={(event) => setField('launcherLabel', event.target.value)} />
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            </div>

            <div className="space-y-3">
              <SectionCard title={SECTION_META[3].title} icon={SECTION_META[3].icon} isOpen={openSections.has('systeem')} onToggle={() => toggleSection('systeem')}>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Model</Label>
                      <select className="h-9 w-full rounded-md border border-border bg-bg-input px-3 text-sm" value={config.model} onChange={(event) => setField('model', event.target.value)}>
                        <option value="gpt-4o">gpt-4o</option>
                        <option value="gpt-4o-mini">gpt-4o-mini</option>
                        <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
                      </select>
                    </div>
                    <div>
                      <Label>Taal</Label>
                      <select className="h-9 w-full rounded-md border border-border bg-bg-input px-3 text-sm" value={config.language} onChange={(event) => setField('language', event.target.value)}>
                        <option value="nl">NL</option>
                        <option value="en">EN</option>
                        <option value="auto">Auto</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <Label>Temperature ({config.temperature.toFixed(1)})</Label>
                    <input type="range" min={0} max={1} step={0.1} className="w-full accent-accent" value={config.temperature} onChange={(event) => setField('temperature', Number(event.target.value))} />
                  </div>
                  <div>
                    <Label>Systeemprompt</Label>
                    <textarea rows={6} className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm" value={config.systemPrompt} onChange={(event) => setField('systemPrompt', event.target.value)} />
                  </div>
                </div>
              </SectionCard>

              <SectionCard title={SECTION_META[4].title} icon={SECTION_META[4].icon} isOpen={openSections.has('embed')} onToggle={() => toggleSection('embed')}>
                <div className="space-y-2">
                  <p className="text-xs text-text-secondary">Script snippet voor embed op externe websites.</p>
                  <pre className="rounded-md border border-border bg-bg-elevated p-2 text-[10px] leading-relaxed text-text-muted overflow-x-auto">
                    {embedSnippet}
                  </pre>
                </div>
              </SectionCard>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setActiveDockItem('run')}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${activeDockItem === 'run' ? 'text-emerald-500 bg-emerald-500/10' : 'text-text-secondary hover:bg-bg-hover'}`}
          >
            <Play size={11} />
            Run
          </button>
          <button
            type="button"
            onClick={() => setActiveDockItem('config')}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${activeDockItem === 'config' ? 'text-accent bg-accent/10' : 'text-text-secondary hover:bg-bg-hover'}`}
          >
            <SlidersHorizontal size={11} />
            Config
          </button>
          <button
            type="button"
            onClick={() => setActiveDockItem('logs')}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${activeDockItem === 'logs' ? 'text-text-heading bg-bg-hover' : 'text-text-secondary hover:bg-bg-hover'}`}
          >
            <List size={11} />
            Logs
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <RotateCcw size={11} />
            Reset
          </button>
          <button
            type="button"
            onClick={onSave}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Save size={11} />
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
