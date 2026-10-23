# Desktop-stijl centraal invoeren

> 2026-10-23. Doel: het dashboard krijgt de rustige desktop-stijl van het canvas "Bokito v2 · huisstijl naast elkaar", pagina **Desktop-stijl**. Dat gaat via de tokenbron en de catalogus-componenten, niet via een CSS-laag met overrides.
> Referentie met exacte waarden: `docs/plans/desktop-stijl/referentie-laag.css`. Dat bestand is een prototype dat met `!important` over de gebouwde CSS heen ligt. **Niet importeren.** Gebruik het alleen om de waarden te lezen.

## Uitgangspunten

- **Eén bron.** Kleur, radius en typeladder veranderen in `packages/ui-tokens/src` (`palette.mjs`, `radius.ts`, `typography.ts`, `elevation.ts`). Daarna draait `emit.mjs`, en de drift-test blijft groen.
- **Componenten, geen overrides.** Wat niet in tokens past, verandert in de cva of de klasse van het catalogus-component (`components/ui/*`, `ChatBubble`, `ComposerCard`, `AppShell`, `ShellTopbar`, `index.css` component-laag). Gebruik geen `!important` en geen selectors op Tailwind-klassen van andere componenten.
- **Zichtbaar is de bedoeling.** Anders dan het ombouwplan verschuiven hier wél pixels. Maak per fase een css-snapshot vóór en na (`node scripts/css-snapshot.mjs`) en vat het verschil in één alinea samen in de PR-tekst.
- **Mobiel.** `radius` en `fontSize` gaan ook naar `theme.generated.ts` (Expo). Dat is gewenst. Meld het als een mobiel scherm daardoor breekt; los dat niet stilletjes op door web en native te splitsen.
- **Tenant-merkkleur blijft werken.** `applyBrandColor` overschrijft `--color-accent*`. Er komt alleen een regel bij: het label op de merkkleur haalt minstens 4,5:1. Haalt wit dat niet, dan wordt het donkere inkt.

## Fase 1 · Kleur (palette.mjs)

Vervang de waarden. De triplets staan ook in de referentie, onder `:root` (dark) en `:root[data-theme='light']`.

**Dark** (blijft het standaardthema):

| token | rgb | rol |
|---|---|---|
| bg, bgCanvas | 38 37 35 | inhoud |
| bgRoot, bgSidebar | 29 28 26 | zijbalk één tint donkerder |
| bgSurface, bgInput | 45 44 41 | kaarten, velden |
| bgElevated | 50 48 45 | inzet, menu |
| bgHover | 58 56 52 | hover, selectie |
| border / borderLight | 61 59 55 / 77 74 69 | haarlijn / sterk |
| borderFocus | 95 214 170 | focus |
| textPrimary / Secondary / Muted / Heading | 236 233 226 / 196 191 180 / 172 167 156 / 247 245 240 | |
| accent / Hover / Dark / Fg / Ink | 60 200 149 / 82 212 164 / 42 167 122 / 6 36 26 / 130 225 191 | donkere inkt op groen |
| ai / aiInk / aiFg | 169 139 255 / 205 188 255 / 21 10 48 | |
| statusSuccess / Warning / Error / Info | 82 209 157 / 240 177 74 / 244 135 126 / 132 171 255 | |

**Light:**

| token | rgb |
|---|---|
| bg, bgCanvas | 251 250 246 |
| bgRoot, bgSidebar | 243 241 234 |
| bgSurface, bgInput | 255 255 255 |
| bgElevated | 247 245 239 |
| bgHover | 236 233 225 |
| border / borderLight | 230 226 216 / 214 209 196 |
| borderFocus | 12 125 86 |
| textPrimary / Secondary / Muted / Heading | 41 38 31 / 87 83 74 / 107 102 92 / 26 24 20 |
| accent / Hover / Dark / Fg / Ink | 12 125 86 / 10 109 75 / 8 93 64 / 255 255 255 / 9 104 72 |
| ai / aiInk / aiFg | 106 60 212 / 76 40 153 / 255 255 255 |
| statusSuccess / Warning / Error / Info | 14 118 82 / 154 79 6 / 179 54 43 / 40 86 194 |

**Test** (in `tokens.test.ts`). Bereken in beide thema's:

| Wat | Waarop | Minimum |
|---|---|---|
| `textMuted` | `bg`, `bgSurface`, `bgElevated` en `bgHover` | 4,5:1 |
| `accentFg` | `accent` | 4,5:1 |
| `aiFg` | `ai` | 4,5:1 |
| `accentInk`, `aiInk` en de vier status-kleuren | `bg` en `bgSurface` | 4,5:1 |

De waarden hierboven halen dat allemaal (gecontroleerd). Een nieuwe waarde die zakt, laat de test falen.

**Merkkleur-engine** (`packages/shared`, `brandPalette` / `applyBrandColor`): kies `accentFg` als donkere inkt wanneer wit onder 4,5:1 zakt. Voeg een test toe met de dev-tenantkleur `rgb(20,164,180)`.

## Fase 2 · Typografie (typography.ts + fonts)

1. Voeg `@fontsource/source-serif-4` toe, gewichten 400, 500 en 600, alleen latin. Importeer in `main.tsx` naast Inter.
2. Voeg aan `fontFamily` het volgende toe:
   - `serif: 'Source Serif 4'`;
   - `cssSerif: "'Source Serif 4', Georgia, serif"`;
   - in `tailwindFontFamily`: `serif: 'var(--font-serif)'`;
   - in `index.css`: `--font-serif`.
3. Nieuwe ladder, in `fontSize` (px) en `webFontSize` (rem, gedeeld door 16):

| stap | px / regelhoogte | letterSpacing |
|---|---|---|
| 2xs | 11.5 / 15 | |
| xs | 13 / 19 | |
| sm | 14 / 21 | |
| base | 15 / 23 | |
| lg | 16 / 25 | |
| xl | 19 / 27 | -0.01em |
| 2xl | 24 / 31 | -0.015em |

   De docs-stappen en `display` blijven zoals ze zijn.
4. Titelrollen in `index.css`:

| Rol | Font | Grootte | Overig |
|---|---|---|---|
| `.title-page` | serif 500 | 30/36 | -0.01em |
| `.title-section` | serif 500 | 18/26 | |
| `.title-dialog` | serif 500 | 20/28 | |
| `.title-card` | sans 500 | 14/21 | |
| `.title-eyebrow` | sans 500 | 12.5/18 | muted |

5. Agent-tekst: alleen in de agent-bubbel gebruikt `.chat-text` de serif op 17/28. Eigen berichten en de rest van de UI blijven sans.

## Fase 3 · Vorm (radius.ts + elevation.ts)

1. `radius.ts`:

| Stap | Nieuw | Was |
|---|---|---|
| `sm` | 4 | 2 |
| `DEFAULT` | 8 | 4 |
| `md` | 10 | 6 |
| `lg` | 12 | 8 |
| `xl` | 16 | 12 |
| `2xl` | 20 | 16 |
| `3xl` | 24 | 24 |
| `full` | 9999 | 9999 |

   Dit verschuift bewust pixels. Zet het in de PR-tekst.
2. `elevation.ts` / `index.css`:
   - `--shadow-card`: geen schaduw, in beide thema's.
   - `--shadow-overlay`: dark `0 0 0 1px rgb(255 255 255/.06), 0 18px 48px -18px rgb(0 0 0/.7)`, light `0 0 0 1px rgb(30 25 15/.06), 0 16px 40px -16px rgb(30 25 15/.2)`.
   - Nieuw `--shadow-composer`: `0 0 0 1px rgb(var(--color-border)), 0 4px 18px -6px rgb(0 0 0/.45)` (dark) en `… 0 4px 16px -8px rgb(30 25 15/.14)` (light).
   - `--shadow-btn`: `none`.

## Fase 4 · Shell

| Onderdeel | Bestand | Wat |
|---|---|---|
| Hoofdrail | `AppShell.tsx` | Achtergrond `bg-bg-sidebar`, geen `border-r`. De `border-t` boven het accountblok vervalt. |
| Topbar | `ShellTopbar.tsx` | Hoogte 52px (`h-[52px]` wordt een token `h-topbar` in de preset), geen `border-b`, transparant. |
| Tweede rails (inbox, agenda, instellingen) | split-layouts | Geen `border-r`. De resize-greep is onzichtbaar tot hover. |
| `.nav-row` | `index.css` | Hoogte 34, 14px, padding 0 10, gap 10, radius `md`. Hover vlak `bg-hover/60`, actief vlak `bg-hover` + 500. **Geen verloop.** Icoon 17px in `text-secondary`. |
| `.nav-folder` | `index.css` | Hoogte 28, 12.5px, `text-muted`, 500. |

## Fase 5 · Catalogus-componenten

| Component | Wijziging |
|---|---|
| `button.tsx` | Maten: `xs` 28 (nieuw, `h-7 px-2.5 text-xs`), `sm` 32 (`h-8 px-3 text-sm`), `md` 36 (`h-9 px-3.5 text-sm`), `lg` 40. **Default wordt `sm`.** `icon` 32, `iconSm` 28. Geen `btn-elevated`-glans. Daarna de 55 `className="h-6/h-7/h-8"`-overrides op `<Button>` omzetten naar `size`, en de guard-regel aanzetten. |
| `input.tsx`, `textarea.tsx`, `search-field.tsx` | 36 hoog, `rounded-md`, `bg-bg-input`, rand `border-border-light`. Focus: rand `border-border-focus` plus ring van 3px op 20%. |
| `select.tsx` | `field`: zelfde als input. `chip` wordt 28 hoog in plaats van 24. Content: `rounded-lg`, `shadow-overlay`, items 32 hoog `rounded-md`. Zelfde voor `dropdown-menu.tsx`. |
| `card.tsx` + `.panel` | `rounded-xl`, volle `border-border`, geen schaduw, padding default 16 / compact 12. `.panel` krijgt exact dezelfde regels. |
| `badge.tsx` | `rounded-full`, 22 hoog (md), tint /12 blijft. |
| `dialog.tsx` | `rounded-xl`, `shadow-overlay`, titel `.title-dialog`. |
| `ChatBubble.tsx` | Eigen bericht: `bg-bg-hover`, `text-text-primary`, radius 18, geen schaduw. Haal de `[&_*]:text-accent-fg`-varianten weg. Agent: geen achtergrond, geen schaduw, geen verloop-rand (`.chat-bubble-agent::before` weg), tekst serif. |
| `ComposerCard.tsx` | Radius 22, `bg-bg-surface`, geen zichtbare rand, `shadow-composer`, padding 14/16/10, textarea 16/24. |

## Fase 6 · Rust

- **Glows weg.** `agent-glow`, `ambient-spotlights`, `app-atmosphere` en `.bot-orb__aura` gaan uit. DESIGN_SYSTEM.md zegt al "No glows", dus code en document kloppen daarna. De orb zelf blijft.
- **Randen.** Codemod `border-border/(20|30|40|50|55|60|70|80)` naar `border-border`. Guard-regel als ratchet: nieuwe opacity-randen falen.
- **Gedempte tekst.** Codemod `text-text-muted/NN` naar `text-text-muted`. Guard-regel.
- **Iconen.** Lijndikte 1,75 als default. Doe dat met een `Icon`-wrapper of `svg.lucide{stroke-width:1.75}` in de base-laag. Kies één van de twee en noem de keuze.

## Fase 7 · Documentatie

- Werk `apps/dashboard/docs/DESIGN_SYSTEM.md` bij: tokens-tabel, radius, typeladder, serif-regel ("koppen en agent-tekst") en componentmaten.
- Werk de baseline van de design-guard bij voor alleen de nieuwe regels.

## Fase 8 · Consistentie-sweep: van catalogus-stijl naar één systeem

Fase 1–7 geven alles wat via de catalogus loopt de nieuwe stijl. Wat met de hand is gebouwd, blijft oud en valt daarna juist méér op. Fase 8 haalt die afwijkingen naar de catalogus en zet er per onderdeel een guard-regel op, zodat ze niet terugkomen.

**Werkwijze per stap**
1. Draai `node scripts/check-design-system.mjs --list` (of de telling bij de stap) en noteer het aantal vóór.
2. Voer de migratie uit: eerst een codemod waar het mechanisch kan, daarna de rest met de hand.
3. Zet de guard-regel aan. Nieuwe regels komen in `scripts/check-design-system.mjs`.
   - **RULES** falen bij elke treffer.
   - **RATCHET_RULES** falen alleen als een bestand groeit. Gebruik dat zolang de migratie nog niet af is, en zet de regel om naar RULES zodra de telling op 0 staat.
4. Draai `--update-baseline` alleen als de telling gedaald is.
5. Commit per stap, met "vóór → na" in de commit-tekst.

**Gedeelde regels**
- Een uitzondering mag alleen met `// design-system-ignore: <reden>` op die regel. Het totaal aantal ignores staat in de PR-tekst.
- Tel alles buiten `src/components/ui/`. De catalogus zelf mag de primitieven gebruiken.
- Tellingen hieronder zijn van de werkkopie op 23 oktober (na `dfafbf5e`).

### 8.1 · Laden: één spinner

- **Nu:** `<Loader2` 68× in 42 bestanden, `<Spinner` 0×.
- **Migratie (codemod):** `<Loader2 size={n} className="animate-spin …" />` wordt `<Spinner size=… className="…" />`, waarbij `animate-spin` uit de className verdwijnt. Maatkaart:

  | `size={n}` | wordt |
  |---|---|
  | ≤ 12 | `sm` |
  | 13–16 | `md` |
  | 18–22 | `lg` |
  | ≥ 24 | `xl` |

- **Volledige blokken:** waar een `Loader2` een heel blok vult (gecentreerd met tekst), wordt het `<LoadingBlock variant="center" label=…/>`.
- **Guard (RULES):**
  ```js
  { id: 'raw-spinner', pattern: /<Loader2\b|\banimate-spin\b/, message: 'Use <Spinner> or <LoadingBlock>.', catalogOk: true }
  ```
- **Klaar:** 0 treffers buiten de catalogus.

### 8.2 · Iconen: drie maten, één lijndikte

- **Nu:** 921× `size={n}` op iconen, met de maten 8 t/m 64. Meest gebruikt zijn 14 (242), 12 (182), 13 (159), 11 (91) en 16 (76). Daarnaast 52× `strokeWidth={…}`.
- **Schaal:**
  - **Interface:** 14 (in tekst, rijen en knoppen), 16 (navigatie, kopjes, standaard-icoonknop), 20 (tegels, grote knoppen).
  - **Display:** 24, 32 en 40, alleen in lege staten, tegels en hero's.
- **Codemod:** alleen op componenten die per bestand uit `lucide-react` komen.

  | Was | Wordt |
  |---|---|
  | 8–13 | 14 |
  | 15–17 | 16 |
  | 18–22 | 20 |
  | 24–28 | 24 |
  | 32–36 | 32 |
  | 40+ | 40 |

  `strokeWidth={…}` op Lucide-iconen gaat eruit; de default uit fase 6 (1,75) geldt. `strokeWidth` op eigen `<path>`, `<line>` en dergelijke (diagrammen in `org/*`, `FlowSchemaEditor`) blijft staan.
- **Guard (RULES):** een nieuwe check in het script, naar het voorbeeld van `MARK_SIZE`.
  - Lees per bestand de geïmporteerde namen uit `from 'lucide-react'`.
  - Vlag `<Naam … size={n}>` met `n` buiten `{14,16,20,24,32,40}`.
  - Vlag `strokeWidth=` op die namen.
  - Melding: `'Icon size is 14, 16 or 20 (24/32/40 for display); stroke comes from the base layer.'`
- **Klaar:** 0 treffers. Steek visueel de inbox-threadlijst en de agenda na; daar waren de iconen het kleinst.

### 8.3 · Vlakken: twee hover-niveaus

- **Nu:** `bg-bg-hover/NN` 154× in 64 bestanden, met ~14 verschillende sterktes.
- **Regel:** er zijn nog maar twee niveaus.
  - **Zacht** (hover, rustig vlak): `bg-bg-hover/50`.
  - **Vol** (geselecteerd, ingedrukt, actief): `bg-bg-hover`.
- **Codemod:** `/10`–`/50` wordt `/50`, `/55`–`/90` wordt vol. Ook `hover:`, `data-[state=open]:`, `group-hover:` en andere varianten.
- **Guard (RULES):**
  ```js
  { id: 'hover-tint', pattern: /\bbg-bg-hover\/(?!50\b)\d+/, message: 'Hover surfaces are bg-bg-hover/50 (soft) or bg-bg-hover (selected).', catalogOk: false }
  ```
  Neem dezelfde aanpak voor `bg-bg-elevated/NN` en `bg-bg/NN`. Inventariseer eerst met `--list`; als het onder de 20 blijft, gelijk meenemen.
- **Klaar:** 0 treffers. `border-border/NN` en `text-text-muted/NN` zijn al in fase 6 gedaan; controleer dat hun guards aan staan.

### 8.4 · Kaarten: alleen `<Card>`

- **Nu:** de klasse `panel` 98× in 60 bestanden, naast `<Card>` 67× in 41.
- **Catalogus eerst** (`card.tsx`):
  - `padding?: 'none' | 'compact' | 'default'` (0 / `p-3` / `p-4`), default `'none'` zodat bestaande `<Card>` niets verandert.
  - `asChild` via `@radix-ui/react-slot` (al aanwezig), voor `section`, `a` en `button` als kaart.
  - `interactive` blijft.
- **Codemod** op `className` met het woord `panel`:

  | Was | Wordt |
  |---|---|
  | `panel p-4`, `panel p-5`, `panel p-6` | `<Card padding="default">` (p-5/p-6 worden p-4; meld de bestanden) |
  | `panel p-3`, `panel px-3 py-2.5`, `panel px-4 py-3` | `<Card padding="compact">` |
  | `panel`, `panel overflow-hidden` | `<Card>` (+ `overflow-hidden` in className) |
  | `panel` op een niet-`div` | `<Card asChild>` om het element |
  | overige klassen (`space-y-3`, `flex …`) | blijven in `className` |

- **Daarna:** haal `.panel` weg uit `index.css`, inclusief de light-variant.
- **Guard (RULES):**
  ```js
  { id: 'panel-class', pattern: /(["'`\s])panel(?=["'`\s])/, message: 'Use <Card padding="compact|default">.', catalogOk: false }
  ```
  De bestaande `hand-rolled-card` blijft aan.
- **Klaar:** 0 treffers en `.panel` bestaat niet meer.

### 8.5 · Paginakop: één `PageHeader`, titel niet dubbel

- **Nu:** `ContentHeader`/`PageHeader` 19×, `PageIntro` 3×, en 20× een eigen `<h1>` in 16 bestanden. Inbox, Agenda en Workforce hebben geen h1. De topbar toont de titel ook.
- **Catalogus:**
  1. Hernoem `components/shell/ContentHeader.tsx` naar `components/ui/page-header.tsx` (export `PageHeader`). Laat een re-export staan tot alle imports om zijn.
  2. API: `title`, `subtitle?`, `primaryAction?` (één knop), `actions?` (rest, in een menu op smal scherm), `guide?`, `back?` (pijl + label voor detailpagina's) en `icon?` (een IconTile, voor afdeling en map).
  3. De titel gebruikt altijd `.title-page`, en de kop rendert altijd de `<h1>`.
  4. `PageIntro` gaat op in `PageHeader`. De drie gebruikers (`CategoriesSettings`, `InboxSettings`, `SetupHubPage`) migreren.
- **Topbar:** `ShellTopbar` toont alleen nog de breadcrumb (sectie / pagina in `text-sm text-text-secondary`), niet de paginatitel als kop. Op mobiel toont de topbar de titel en verbergt `PageHeader` de h1 visueel (`sr-only`), zodat er niets dubbel staat.
- **Migratie:**
  1. Elke route onder `AppShell` begint met precies één `<PageHeader>` binnen `PageContent`.
  2. Eigen koppen (`DepartmentPage`, `StartCards`, `HelpCenter`, `WorkstreamDetail` "Terug naar werk", `LearnPage`) gaan over.
  3. Inbox, Agenda en Workforce krijgen een `PageHeader`, of een `sr-only` h1 als de lay-out geen ruimte heeft. Benoem die keuze per scherm.
  4. `/learn/projects` gebruikt een vertaalde titel in plaats van de slug.
- **Guard (RULES):** `<h1` buiten de toegestane bestanden.
  ```js
  { id: 'raw-h1', pattern: /<h1\b/, message: 'Pages start with <PageHeader>; it owns the <h1>.', catalogOk: true,
    allow: /^(components\/auth\/|components\/docs\/|pages\/(Docs|ForgotPassword|ResetPassword|Login|Signup|VerifyEmail|AcceptInvite|PublicTrust|TrustPrivacy)Page?)/ }
  ```
  Voeg aan het script ondersteuning toe voor `allow` (een pad-regex).
- **Klaar:** 0 treffers. Elke hoofdroute toont zijn titel op dezelfde positie, en `PageIntro` bestaat niet meer.

### 8.6 · Gezichten: één `Avatar`

- **Nu:** `UserAvatar` 24, `AgentMark` 27, `AiAvatar` 21, `TeamFacepile` 9, `ContactAvatar` 6, `PersonAvatar` 4, `AvatarStack` 4, `BotOrbAvatar` 2, `TeamAvatar` 1, `ParticipantMark` 0 en `AvatarDisc` 0 (buiten de catalogus).
- **Catalogus:** nieuw `components/ui/avatar.tsx`.
  ```ts
  type AvatarProps =
    | { kind: 'person'; name?: string | null; email?: string | null; imageUrl?: string | null; domain?: string | null; presence?: PresenceStatus }
    | { kind: 'agent'; agent: AgentAvatarSource; mode?: 'live' | 'static'; activity?: AgentPresenceStatus | null }
    | { kind: 'team'; team: TeamAvatarSource; presence?: PresenceStatus }
  & { size?: MarkSize; decorative?: boolean; className?: string }
  ```
  - `person` bundelt `UserAvatar`, `PersonAvatar` en `ContactAvatar`; `domain` neemt de favicon-logica van ContactAvatar over.
  - `agent` bundelt `AgentMark`, `AiAvatar` en `BotOrbAvatar`.
  - `team` vervangt `TeamAvatar`.
  - `AvatarDisc` wordt een intern onderdeel en verdwijnt uit de export.
  - `AvatarStack` en `TeamFacepile` blijven als samengestelde componenten, maar renderen intern `<Avatar>`.
  - `size` gebruikt de bestaande mark-ladder (`lib/mark-scale.ts`).
  - Agents tonen altijd hun orb. Een geaccentueerde ring in `ai` alleen bij `activity="working"`. Mensen hebben nooit een `ai`-ring.
- **Migratie:**
  1. De oude componenten worden eerst dunne wrappers om `Avatar` (één commit, niets visueel).
  2. Daarna een codemod per component naar `<Avatar kind=…>`.
  3. Tot slot gaan de wrappers en `ParticipantMark` weg.
- **Guard (RULES):**
  ```js
  { id: 'legacy-avatar', pattern: /<(UserAvatar|PersonAvatar|ContactAvatar|AgentMark|AiAvatar|BotOrbAvatar|TeamAvatar|AvatarDisc|ParticipantMark)\b/, message: 'Use <Avatar kind="person|agent|team">.', catalogOk: true }
  ```
  Werk `MARK_SIZE` bij naar `<Avatar\b`.
- **Klaar:** 0 treffers. De catalogus exporteert `Avatar`, `AvatarStack` en `TeamFacepile`.

### 8.7 · Knoppen: geen kale `<button>`

- **Nu:** 363× `<button` in 138 bestanden. De top is `ReplyComposer` (15), `BulkActionsBar` (10), `TimelineItem` (10) en `ContactsPage` (10). Daarnaast nog 73× een `h-`-override op `<Button>`, als die in fase 5 niet al naar 0 zijn.
- **Catalogus eerst:** nieuw `components/ui/pressable.tsx`.
  - Een knop zonder knop-uiterlijk, voor klikvlakken als een hele rij, kaart of tegel.
  - `<button type="button">` met `appearance-none`, `text-left`, `w-full`, `rounded-md` en `focus-visible:ring-2 focus-visible:ring-border-focus`, plus `disabled:opacity-50`.
  - Ondersteunt `asChild`.
  - Dit is de enige plek waar een kale `button` mag.
- **Classificeer eerst** (`--list` van `raw-button`, per bestand) en migreer per soort:

  | Soort | Herken je aan | Wordt |
  |---|---|---|
  | A. Icoonknop | alleen een icoon, vaak `h-6/h-7 w-6/w-7` | `<Button variant="ghost" size="iconSm"\|"icon" aria-label=…>` |
  | B. Tekstactie | korte tekst, `text-xs text-text-muted hover:…` | `<Button variant="ghost" size="xs">` of `<TextLink tone="muted">` |
  | C. Klikvlak | `w-full text-left`, hele rij of kaart | `<Pressable>` (of `EntityRow interactive`, zie 8.10) |
  | D. Menu-trigger | opent een dropdown of popover | `<DropdownMenuTrigger asChild><Button …/></DropdownMenuTrigger>` |
  | E. Keuze uit een groep | tabs, filters of toggles naast elkaar | `SegmentedControl`, `FilterChip` of `Tabs` |
  | F. Overig | editor-werkbalk, drag-handles | Benoem ze in de PR; `Button` of `Pressable` met een `design-system-ignore`-reden |

- **Volgorde:** eerst de vijf grootste bestanden, dan per map (inbox, contacts, agenda, flows, settings).
- **Guard:** `raw-button` staat al als ratchet aan. Zodra de telling 0 is, gaat hij naar RULES met `catalogOk: true`. Voeg een RULES-regel toe tegen hoogte-overrides:
  ```js
  { id: 'button-height-override', pattern: /<Button\b[^>]*className=["'`{][^>]*\bh-(5|6|7|8|9|10|11)\b/, message: 'Use size="xs|sm|md|lg|icon|iconSm".', catalogOk: true }
  ```
- **Klaar:** `raw-button` = 0 en staat in RULES. `button-height-override` = 0.

### 8.8 · Overlays en vinkjes

- **Overlays**
  - **Nu:** `fixed inset-0` 12× in 10 bestanden, naast `<Dialog>` 66×.
  - **Migratie:**
    - Een modaal venster wordt `Dialog`.
    - Een paneel vanaf de zijkant wordt `SidePanel` (staat in de catalogus, wordt nu 0× gebruikt).
    - Een sneltoets-help wordt `Dialog`.
    - De tour-overlay (`tour/TourContext.tsx`) blijft, met een ignore-reden.
  - **Guard (RATCHET, daarna RULES):**
    ```js
    { id: 'hand-overlay', pattern: /\bfixed inset-0\b/, message: 'Use <Dialog> or <SidePanel>.' }
    ```
- **Vinkjes**
  - **Nu:** 11× `type="checkbox"` in 10 bestanden.
  - **Catalogus:** nieuw `components/ui/checkbox.tsx`. Een native `<input type="checkbox">` met `appearance-none`, 16×16, `rounded` (8 → 4px bij deze maat), rand `border-border-light`, aangevinkt in `bg-accent` met een check-icoon in `text-accent-fg`, en de focus-ring. Geen nieuwe dependency. Met optionele `label` en `description`.
  - **Migratie:** alle 11.
  - **Guard:** `raw-input` (ratchet) dekt het al; zet hem naar RULES zodra hij op 0 staat.
- **Klaar:** 0 treffers voor `hand-overlay` behalve de tour, en 0 native checkboxes.

### 8.9 · Lege staten: altijd `EmptyState`

- **Nu:** `<EmptyState` 44×, terwijl de NL-locales 133 teksten bevatten die met "Nog geen" beginnen. Die worden meestal als losse `<p className="text-… text-text-muted">` getoond.
- **Inventaris:** nieuw script `scripts/list-empty-copy.mjs`.
  1. Lees `locales/nl/*.json` en neem elke sleutel waarvan de waarde begint met "Nog geen" of "Geen ".
  2. Zoek in `src` waar die sleutel gebruikt wordt (`t('…sleutel')` of `t("…")`).
  3. Markeer een gebruik als "los" als binnen 8 regels erboven geen `<EmptyState` staat.
  4. Print per bestand het aantal losse gebruiken.
- **Migratie:**
  - Een lege lijst of pagina wordt `<EmptyState icon title description? action?>`, met één zin en één actie. Gebruik `tone="plain"` binnen kaarten en `size="sm"` in rails en panelen.
  - Een losse regel midden in een formulier ("Nog geen labels") mag blijven als het echt een veldwaarde is. Markeer die met de ignore-reden.
- **Guard (RATCHET):** het script exporteert een telling per bestand; `check-design-system.mjs` importeert het als ratchet `loose-empty-copy`.
- **Klaar:** de ratchet staat op 0 behalve de gemarkeerde veldwaarden.

### 8.10 · Lijsten: `EntityRow` als basis

- **Nu:** `EntityRow` wordt 2× gebruikt en `EntityList` 0×. Elke lijst bouwt zijn eigen rij.
- **Catalogus eerst:** maak `EntityRow` geschikt als basis voor alle rijen.
  - **Slots:** `leading` (Avatar of IconTile), `title`, `badges`, `description` (één regel, afgekapt), `meta` (rechts boven, bijvoorbeeld tijd), `trailing` (rechts, bijvoorbeeld acties of een chevron).
  - **Props:**
    - `density: 'sm' | 'md'` (rijhoogte 44/56);
    - `selected`;
    - `unread` (titel 600 + dot);
    - `interactive` (renders via `Pressable`);
    - `href` (renders als link);
    - `actions` (verschijnen bij hover of focus).
  - `EntityList` geeft scheidingslijnen (`divide-y divide-border`), een lege staat (`empty` → `EmptyState`) en het laden (`loading` → `LoadingBlock skeleton`).
- **Migratie** (in deze volgorde, elk een eigen commit):
  1. `ContactsPage` (rijen voor contacten en bedrijven);
  2. `MemberManagement` en `TeamPage`;
  3. de lijstweergave van `ConnectionsHub`;
  4. de mappenlijst op Mappen;
  5. `inbox/ThreadListItem` (de zwaarste: eerst laten zien hoe hij op `EntityRow` past, ná akkoord pas omzetten);
  6. de ticketlijst in `flows/FlowTicketBoard` (lijstweergave, niet het bord).
- **Guard:** geen regex-regel (te veel vals alarm). In plaats daarvan komt er een lijst in DESIGN_SYSTEM.md, onder "Lijsten", met alle lijst-componenten en of ze op `EntityRow` staan. Een nieuwe lijst zonder `EntityRow` hoort in code-review terug te komen.
- **Klaar:** de zes lijsten hierboven staan op `EntityRow`, `EntityList` heeft minstens 4 gebruikers, en de visuele check is gedaan.

### 8.11 · Afsluiten

1. Zet elke ratchet die op 0 staat om naar RULES. Werk de baseline bij.
2. Werk `apps/dashboard/docs/DESIGN_SYSTEM.md` bij.
   - **Catalogus:** de nieuwe en verwijderde componenten (`Avatar`, `Pressable`, `Checkbox`, `PageHeader` naar `ui/`, `Card padding`, `EntityRow` slots; weg zijn `PageIntro`, `ParticipantMark`, `.panel` en de losse avatars).
   - **Regels:**
     - icoonmaten 14/16/20 (display 24/32/40);
     - hover alleen /50 of vol;
     - één spinner;
     - elke pagina begint met PageHeader;
     - geen kale `button` behalve via `Pressable`;
     - lege staten altijd via `EmptyState`.
   - **Tabel "Lijsten"** uit 8.10.
3. Geef in de PR-tekst één tabel met per regel "vóór → na" en het aantal ignores met reden.

## Na elke fase

```
npm run test -w @bokito/ui-tokens      # drift + contrast
npm run type-check -w dashboard
npm run lint -w dashboard
npm run build -w dashboard
node apps/dashboard/scripts/css-snapshot.mjs /tmp/na-fase-N.css   # diff tegen vorige
```

Commit per fase, met een zin die zegt wat de gebruiker ziet veranderen.

## Klaar wanneer

- Vandaag, Inbox (met gesprek) en Agents zien er op dev uit als de Desktop-stijl-borden op het canvas, in licht en donker.
- Er is geen `!important` toegevoegd en geen selector op andermans Tailwind-klassen.
- Contrasttests, drift-test, lint en build zijn groen.

## Open punten

### Baseline was rood (werk in uitvoering van een andere agent)

De baseline-commit `cd2a8090` bevat lopend werk dat type-check en lint rood liet. Commit "Baseline groen" repareert alleen het minimum. Let bij het mergen van `wip/werkkopie` op conflicten in deze bestanden:

- `PresenceStatus` kreeg `'unavailable'`, maar niet alle gebruikers volgden. `lib/mentions.ts` gebruikt nu `PresenceStatus`, `hooks/useTeams.ts` rangschikt `unavailable` als `offline`, en `chat-stack/ChatStackCard.tsx` heeft een null-check die het gedrag gelijk laat.
- Mark-scale: `LiveCallComposerBar.tsx` gaat van 28 naar 32, `DepartmentPage.tsx` van 22 naar 24 (2x).
- NL-copy: `nav.json` `workstreamsPage.schema.title` en `product-help/nl/ai/flows.md` gaan van "flow" naar "werk".

### Tijdelijke ignores: call-UI WIP, migreren in 8.7

Deze acht `<button>`s dragen `// design-system-ignore: call-UI WIP, migreert in 8.7`. In 8.7 worden ze als eerste omgezet en de ignores weggehaald.

- `src/components/chat-stack/ChatStackCard.tsx:53`
- `src/components/chat-stack/ChatStackCard.tsx:156`
- `src/components/inbox/CallRecord.tsx:58`
- `src/components/inbox/LiveCallComposerBar.tsx:309`
- `src/components/inbox/LiveCallComposerBar.tsx:322`
- `src/components/inbox/LiveCallComposerBar.tsx:388`
- `src/components/inbox/LiveCallComposerBar.tsx:399`
- `src/components/inbox/ReplyComposer.tsx:1516`

Daarnaast heeft `src/pages/WorkspaceDocs.tsx` (chip "Concept-lessen") een ignore. Het is dezelfde `entityChipClass`-chip als zijn negen buren en gaat in 8.7 met hen mee.

### Fase 1: merkkleur-engine

- **Keuze per thema.** Letterlijk "wit onder 4,5:1 wordt donkere inkt" zou de standaard-mint in het lichte thema donkere tekst geven, tegen het lichte palet in (diepgroen met wit). Daarom geldt:
  - Donker thema: wit alleen als het op de vulling al 4,5:1 haalt, anders donkere inkt.
  - Licht thema: de vulling wordt verdonkerd tot wit 4,5:1 haalt, waar dat 3:1 was. Erg lichte zaden (geel) krijgen donkere inkt, zoals nu.
- `BRAND_DEFAULT_BG` volgt de nieuwe `bg` (dark `38 37 35`, light `251 250 246`). Die waarde staat los in `packages/shared` en is geen import uit `ui-tokens`.
- `applyBrandColor` overschrijft `--color-accent*` en `--color-border-focus` altijd, ook zonder tenant-kleur, want het seed wordt dan `#32BF8E`. De accent-waarden uit `palette.mjs` zie je daardoor alleen waar geen branding geladen is, zoals login en docs. Om de palet-accenten zichtbaar te maken zou het standaard-seed het palet moeten gebruiken. Dat staat niet in het plan.

### Fase 4: shell

- Andere tweede rails met hetzelfde `border-r border-border/60`-patroon vallen buiten de opgesomde drie (inbox, agenda, instellingen) en hebben hun rand nog: `WorkforceLayout`, `ProjectsLayout` (Mappen) en de `aside` in `WorkspaceDocs`. De agenda-rail had al geen rand.
- `h-topbar` komt uit `shellHeight.topbar` in `packages/ui-tokens/src/spacing.ts`. `emit.mjs` schrijft hem als `height.topbar` in de preset.

### Fase 5: catalogus

- De Button-codemod (`h-N` in `className` wordt een `size`) raakt ook twee bestanden die de andere agent nog bewerkt: `FlowSchemaEditor.tsx` en `WorksInSection.tsx`. Alleen het `size`/`className` van `<Button>` is veranderd. Reken daar op een kleine merge-conflict.
- De `padding`-prop van `Card` is niet aangepast. `.panel` heeft nu radius 16 en een effen rand; de padding volgt in 8.4.
- Na fase 5 kloppen de screenshots in `docs/product-help/assets/` niet meer met het scherm (knoppen, bubbels, composer, shell). Opnieuw vastleggen staat niet in het plan; beter na fase 8 in één keer met `capture_product_help_screenshots.py`.

### Tijdelijke copy-allowlist: opruimen na merge

In `apps/dashboard/scripts/copy-tsx-allowlist.txt`, onder `# WIP andere agent, opruimen na merge`, staan twee regels:

- `apps/dashboard/src/components/flows/FlowSchemaEditor.tsx` (hardcoded "Del")
- `apps/dashboard/src/components/projects/WorksInSection.test.tsx` ("grant")
