import { useState, useRef } from 'react'
import {
  Building2,
  Globe,
  Users,
  MessageSquare,
  Sparkles,
  Palette,
  Type,
  Upload,
  CheckCircle2,
  Loader2,
  Plus,
  X,
  ChevronDown,
  Info,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────

type ScanState = 'idle' | 'scanning' | 'done'

// ── Sub-components ────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description?: string }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-7 h-7 rounded-md bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={16} className="text-accent" />
      </div>
      <div>
        <h2 className="text-[14px] font-semibold text-text-primary">{title}</h2>
        {description && <p className="text-[12px] text-text-muted mt-0.5">{description}</p>}
      </div>
    </div>
  )
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">
      {children}
      {optional && <span className="ml-1.5 normal-case text-text-muted/60 font-normal">(optioneel)</span>}
    </label>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-bg-surface/45 border border-border/55 rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/55 transition-colors"
    />
  )
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-bg-surface/45 border border-border/55 rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/55 transition-colors resize-none"
    />
  )
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-bg-surface/45 border border-border/55 rounded-lg px-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:border-accent/55 transition-colors pr-8"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
    </div>
  )
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('')

  const addTag = () => {
    const val = input.trim()
    if (val && !tags.includes(val)) onChange([...tags, val])
    setInput('')
  }

  return (
    <div className="flex flex-wrap gap-1.5 bg-bg-surface/45 border border-border/55 rounded-lg px-3 py-2 min-h-[42px] items-center focus-within:border-accent/55 transition-colors">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent">
          {tag}
          <button type="button" onClick={() => onChange(tags.filter((t) => t !== tag))} className="hover:text-accent/60">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[120px] bg-transparent text-[13px] text-text-primary placeholder-text-muted focus:outline-none"
        placeholder={tags.length === 0 ? 'Voeg toe en druk Enter…' : ''}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
        onBlur={addTag}
      />
    </div>
  )
}

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="w-10 h-10 rounded-lg border border-border shadow-sm cursor-pointer hover:scale-105 transition-transform"
        style={{ background: color }}
        title={color}
      />
      <span className="text-[10px] text-text-muted font-mono">{color}</span>
      <span className="text-[10px] text-text-muted">{label}</span>
    </div>
  )
}

// ── Style Scanner ─────────────────────────────────────────────────────────

function StyleScanner() {
  const [url, setUrl] = useState('')
  const [state, setScanState] = useState<ScanState>('idle')
  const [scanned, setScanned] = useState<{
    colors: Array<{ hex: string; label: string }>
    fonts: string[]
    name: string
  } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleScan = () => {
    if (!url.trim()) return
    setScanState('scanning')
    setScanned(null)
    timerRef.current = setTimeout(() => {
      setScanState('done')
      setScanned({
        name: url.replace(/https?:\/\/(www\.)?/, '').split('/')[0],
        colors: [
          { hex: '#00FF99', label: 'Primair' },
          { hex: '#1A1F2E', label: 'Achtergrond' },
          { hex: '#FFFFFF', label: 'Tekst' },
          { hex: '#0EA5E9', label: 'Accent' },
        ],
        fonts: ['Montserrat', 'Inter'],
      })
    }, 2800)
  }

  const handleApply = () => {
    setScanState('idle')
    setScanned(null)
    setUrl('')
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-5 relative overflow-hidden">
      {/* Decorative glow */}
      <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-accent/10 blur-2xl pointer-events-none" />

      <div className="relative">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center flex-shrink-0">
            <Sparkles size={18} className="text-accent" />
          </div>
          <div>
            <h3 className="text-[14px] font-bold text-text-primary">Nieuwe huisstijl?</h3>
            <p className="text-[12px] text-text-secondary mt-0.5 leading-relaxed">
              Laat Bokito hem meteen overnemen. Vul je website-URL in en Bokito detecteert automatisch je merkkleur, lettertypen en logo.
            </p>
          </div>
        </div>

        {/* URL input + button */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://jouwbedrijf.nl"
              disabled={state === 'scanning'}
              onKeyDown={(e) => { if (e.key === 'Enter') handleScan() }}
              className="w-full bg-bg-surface border border-border rounded-lg pl-9 pr-3 py-2.5 text-[13px] text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/60 transition-colors disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={handleScan}
            disabled={state === 'scanning' || !url.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            {state === 'scanning' ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Scannen…
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Huisstijl scannen
              </>
            )}
          </button>
        </div>

        {/* Scanning animation */}
        {state === 'scanning' && (
          <div className="mt-4 space-y-2">
            {['Websitepagina laden…', 'Kleuren analyseren…', 'Lettertypen detecteren…'].map((step, i) => (
              <div key={step} className="flex items-center gap-2 text-[12px] text-text-secondary">
                <Loader2 size={12} className="animate-spin text-accent flex-shrink-0" style={{ animationDelay: `${i * 0.2}s` }} />
                {step}
              </div>
            ))}
          </div>
        )}

        {/* Scan result */}
        {state === 'done' && scanned && (
          <div className="mt-4 p-4 bg-bg-elevated border border-border rounded-lg space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-accent" />
              <span className="text-[13px] font-semibold text-text-primary">
                Huisstijl gevonden voor <span className="text-accent">{scanned.name}</span>
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Gedetecteerde kleuren</p>
                <div className="flex gap-4">
                  {scanned.colors.map((c) => (
                    <ColorSwatch key={c.hex} color={c.hex} label={c.label} />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">Lettertypen</p>
                <div className="flex gap-2">
                  {scanned.fonts.map((f) => (
                    <span key={f} className="text-[12px] px-2.5 py-1 rounded-md bg-bg-hover border border-border text-text-primary font-medium">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleApply}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-hover transition-colors"
              >
                <CheckCircle2 size={14} />
                Huisstijl overnemen
              </button>
              <button
                type="button"
                onClick={() => { setScanState('idle'); setScanned(null) }}
                className="px-4 py-2 rounded-lg border border-border text-text-secondary text-[13px] hover:bg-bg-hover transition-colors"
              >
                Annuleren
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function CompanyConfig() {
  // Context state
  const [companyName, setCompanyName] = useState('Bokito AI')
  const [industry, setIndustry] = useState('Software & Technologie')
  const [website, setWebsite] = useState('https://bokito.ai')
  const [description, setDescription] = useState(
    'Bokito is een AI-gedreven platform dat bedrijven helpt hun klantenservice, sales en interne processen te automatiseren met slimme cloud agents en no-code workflows.',
  )
  const [targetAudience, setTargetAudience] = useState(
    'MKB en enterprise bedrijven in de Benelux die digitale transformatie willen versnellen zonder grote IT-teams.',
  )
  const [toneOfVoice, setToneOfVoice] = useState('Professioneel maar toegankelijk')
  const [values, setValues] = useState(['Innovatie', 'Transparantie', 'Efficiency', 'Vertrouwen'])
  const [systemContext, setSystemContext] = useState(
    'Bokito agents spreken altijd in het Nederlands tenzij de klant een andere taal gebruikt. Ze zijn behulpzaam, to-the-point en vermijden technisch jargon tenzij de gebruiker daar om vraagt.',
  )

  // Style state
  const [primaryColor, setPrimaryColor] = useState('#00FF99')
  const [secondaryColor, setSecondaryColor] = useState('#1A1F2E')
  const [fontDisplay, setFontDisplay] = useState('Montserrat')
  const [fontBody, setFontBody] = useState('Inter')
  const [logoUploaded, setLogoUploaded] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const INDUSTRIES = [
    'Software & Technologie', 'Retail & E-commerce', 'Financiën & Verzekeringen',
    'Zorg & Welzijn', 'Logistiek & Transport', 'Marketing & Communicatie',
    'Industrie & Productie', 'Onderwijs', 'Overheid', 'Overig',
  ]

  const TONES = [
    'Professioneel maar toegankelijk', 'Formeel', 'Informeel & vriendelijk',
    'Technisch & precies', 'Enthousiast & energiek', 'Empathisch & zorgzaam',
  ]

  const FONTS = ['Montserrat', 'Inter', 'Roboto', 'Poppins', 'Lato', 'Open Sans', 'Nunito', 'Raleway', 'DM Sans']

  return (
    <div className="flex flex-col h-full overflow-hidden py-3">
      {/* Sticky save bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-2.5 border-b border-border/45 bg-transparent">
        <p className="text-[12px] text-text-muted">
          Wijzigingen worden direct toegepast op alle actieve Bokito agents.
        </p>
        <button
          type="button"
          onClick={handleSave}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all ${
            saved
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-accent text-white hover:bg-accent-hover'
          }`}
        >
          {saved ? (
            <><CheckCircle2 size={14} />Opgeslagen</>
          ) : (
            'Opslaan'
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-5 space-y-7">

          {/* ── CONTEXT SECTION ──────────────────────────────────────────── */}
          <section>
            <SectionHeader
              icon={Building2}
              title="Bedrijfscontext"
              description="Deze informatie gebruiken je Bokito agents als achtergrondkennis bij elk gesprek."
            />

            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Bedrijfsnaam</FieldLabel>
                  <TextInput value={companyName} onChange={setCompanyName} placeholder="Jouw bedrijf B.V." />
                </div>
                <div>
                  <FieldLabel>Branche</FieldLabel>
                  <SelectInput value={industry} onChange={setIndustry} options={INDUSTRIES} />
                </div>
              </div>

              <div>
                <FieldLabel>Website</FieldLabel>
                <TextInput value={website} onChange={setWebsite} placeholder="https://jouwbedrijf.nl" type="url" />
              </div>

              <div>
                <FieldLabel>Bedrijfsbeschrijving</FieldLabel>
                <TextArea
                  value={description}
                  onChange={setDescription}
                  placeholder="Beschrijf kort wat jouw bedrijf doet, voor wie en wat jullie onderscheidt."
                  rows={3}
                />
              </div>

              <div>
                <FieldLabel>Doelgroep</FieldLabel>
                <TextArea
                  value={targetAudience}
                  onChange={setTargetAudience}
                  placeholder="Beschrijf je doelgroep: sector, bedrijfsgrootte, uitdagingen…"
                  rows={2}
                />
              </div>

              <div>
                <FieldLabel>Toon & stijl van communicatie</FieldLabel>
                <SelectInput value={toneOfVoice} onChange={setToneOfVoice} options={TONES} />
              </div>

              <div>
                <FieldLabel>Bedrijfswaarden</FieldLabel>
                <TagInput tags={values} onChange={setValues} />
                <p className="text-[11px] text-text-muted mt-1.5 flex items-center gap-1">
                  <Info size={11} />Waarden die agents meewegen in hun toonzetting.
                </p>
              </div>

              <div>
                <FieldLabel>Extra context voor agents</FieldLabel>
                <TextArea
                  value={systemContext}
                  onChange={setSystemContext}
                  placeholder="Aanvullende instructies voor het gedrag van je agents: taal, grenzen, specifieke regels…"
                  rows={4}
                />
                <p className="text-[11px] text-text-muted mt-1.5 flex items-center gap-1">
                  <Info size={11} />Dit wordt als systeem-instructie meegegeven aan alle actieve agents.
                </p>
              </div>
            </div>
          </section>

          <div className="border-t border-border/35" />

          {/* ── STYLE SECTION ─────────────────────────────────────────────── */}
          <section>
            <SectionHeader
              icon={Palette}
              title="Huisstijl & Branding"
              description="Pas de visuele identiteit aan die Bokito gebruikt in webchat, e-mails en rapporten."
            />

            <div className="space-y-6">
              {/* Logo */}
              <div>
                <FieldLabel optional>Logo</FieldLabel>
                <div
                  className="flex items-center gap-4 p-4 border border-border/45 rounded-xl hover:border-accent/35 transition-colors cursor-pointer group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="w-12 h-12 rounded-lg bg-bg-elevated/60 border border-border/50 flex items-center justify-center flex-shrink-0">
                    {logoUploaded ? (
                      <img src="/bokito-logo.svg" alt="logo" className="w-8 h-8 object-contain" />
                    ) : (
                      <Upload size={18} className="text-text-muted group-hover:text-accent transition-colors" />
                    )}
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">
                      {logoUploaded ? 'Logo geüpload' : 'Logo uploaden'}
                    </p>
                    <p className="text-[11px] text-text-muted">SVG, PNG of WebP · max 2 MB</p>
                  </div>
                  {!logoUploaded && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setLogoUploaded(true) }}
                      className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:bg-bg-hover transition-colors"
                    >
                      <Plus size={13} />Uploaden
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={() => setLogoUploaded(true)} />
                </div>
              </div>

              {/* Colors */}
              <div>
                <FieldLabel>Merkkleuren</FieldLabel>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Primaire kleur', value: primaryColor, onChange: setPrimaryColor },
                    { label: 'Achtergrondkleur', value: secondaryColor, onChange: setSecondaryColor },
                  ].map(({ label, value, onChange }) => (
                    <div key={label} className="flex items-center gap-3 p-3 bg-bg-surface/45 border border-border/50 rounded-lg">
                      <div className="relative flex-shrink-0">
                        <input
                          type="color"
                          value={value}
                          onChange={(e) => onChange(e.target.value)}
                          className="w-10 h-10 rounded-lg border-0 cursor-pointer bg-transparent p-0"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-text-muted font-medium">{label}</p>
                        <p className="text-[13px] text-text-primary font-mono">{value.toUpperCase()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Typography */}
              <div>
                <FieldLabel>Typografie</FieldLabel>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] text-text-muted mb-1.5 flex items-center gap-1"><Type size={11} />Display / Titels</p>
                    <SelectInput value={fontDisplay} onChange={setFontDisplay} options={FONTS} />
                  </div>
                  <div>
                    <p className="text-[11px] text-text-muted mb-1.5 flex items-center gap-1"><Type size={11} />Body / Tekst</p>
                    <SelectInput value={fontBody} onChange={setFontBody} options={FONTS} />
                  </div>
                </div>
                <div
                  className="mt-3 p-4 rounded-lg bg-bg-surface border border-border"
                  style={{ fontFamily: fontBody }}
                >
                  <p className="text-[18px] font-bold text-text-primary mb-1" style={{ fontFamily: fontDisplay }}>
                    Welkom bij {companyName || 'jouw bedrijf'}
                  </p>
                  <p className="text-[13px] text-text-secondary">
                    Dit is een voorbeeld van hoe tekst eruit ziet met de geselecteerde lettertypen.
                  </p>
                </div>
              </div>

              {/* Style scanner */}
              <StyleScanner />
            </div>
          </section>

          {/* ── CONTACT SECTION ──────────────────────────────────────────── */}
          <section>
            <SectionHeader
              icon={Users}
              title="Contactinformatie"
              description="Wordt getoond in automatische berichten en agent-handoffs."
            />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel optional>Telefoonnummer</FieldLabel>
                  <TextInput value="" onChange={() => {}} placeholder="+31 20 123 4567" type="tel" />
                </div>
                <div>
                  <FieldLabel optional>Support e-mail</FieldLabel>
                  <TextInput value="" onChange={() => {}} placeholder="support@jouwbedrijf.nl" type="email" />
                </div>
              </div>
              <div>
                <FieldLabel optional>Openingstijden</FieldLabel>
                <TextInput value="" onChange={() => {}} placeholder="Ma–vr 09:00–17:30" />
              </div>
            </div>
          </section>

          {/* ── AGENT PERSONA SECTION ─────────────────────────────────────── */}
          <section>
            <SectionHeader
              icon={MessageSquare}
              title="Agent persona"
              description="Geef je standaard agent een naam en karakter."
            />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Agent naam</FieldLabel>
                  <TextInput value="Bokito" onChange={() => {}} placeholder="bijv. Lisa, Max, Assistent…" />
                </div>
                <div>
                  <FieldLabel>Begroeting</FieldLabel>
                  <TextInput value="Hallo! Hoe kan ik je helpen?" onChange={() => {}} placeholder="Openingszin van de agent" />
                </div>
              </div>
              <div>
                <FieldLabel optional>Persoonlijkheidsbeschrijving</FieldLabel>
                <TextArea
                  value=""
                  onChange={() => {}}
                  placeholder="Beschrijf het karakter: empathisch, direct, gestructureerd…"
                  rows={2}
                />
              </div>
            </div>
          </section>

          <div className="pb-8" />
        </div>
      </div>
    </div>
  )
}
