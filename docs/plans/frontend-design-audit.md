# Frontend design-audit: consistentie, hiërarchie, AI-gevoel

> 2026-10-22. Live gemeten op dev.app.bokito.ai (16 schermen, computed styles per element,
> 1440px) en parallel nagelopen in de code op `origin/master` (ca420b8).
> Vervolg op `design-system-ombouw.md`: dat plan repareert de *plumbing* (tokens, generator,
> guard). Dit document gaat over wat de gebruiker *ziet*.

## Oordeel

**De techniek onder het design system is bovengemiddeld. De visuele taal is nog geen systeem.**

Er is een catalogus, een guard met ratchet, een slimme merkkleur-engine (OKLCH + WCAG) en een
DESIGN_SYSTEM.md met goede principes. Maar het scherm vertelt een ander verhaal: een dicht,
grijs beheerpaneel op 11,5px, met 84 soorten knoppen, drie manieren om een pagina te beginnen,
tien avatar-componenten en geen herkenbare AI-signatuur. Het voelt als een krachtige ops-console
voor ingewijden, niet als een modern AI-product voor een ondernemer.

Het goede nieuws: bijna alles hieronder is centraal te repareren, omdat de catalogus en de tokens
er al zijn. Het probleem is niet ontbrekend gereedschap, maar dat de schermen het niet gebruiken
en dat een paar basiskeuzes (lettergrootte, contrast, AI-identiteit) nooit hard gemaakt zijn.

---

## 1. Leesbaarheid: het hele product draait op 11,5px, en de meestgebruikte tekstkleur zakt voor contrast

**Gemeten (live, alle tekstnodes over 16 schermen):**

| Grootte | Aantal | Rol volgens DESIGN_SYSTEM.md |
|---|---|---|
| 11,5px (`text-xs`) | 985 | "secundair" |
| 12,5px (`text-sm`) | 474 | |
| 10,5px (`text-2xs`) | 375 | |
| 13,5px (`text-base`) | **28** | "body" |
| 16px | 114 | niet op de ladder: browser-default lekt door (knoppen zonder tekstklasse) |
| 11, 12, 13, 14, 14,3px | 99 | niet op de ladder |

In de code hetzelfde beeld: `text-xs` 1327×, `text-sm` 759×, `text-2xs` 311×, `text-base` 54×.
De gedocumenteerde body-grootte wordt dus vrijwel niet gebruikt; de echte body is 11,5px.

**Contrast:** `text-text-muted` is de meestgebruikte tekstkleur (1322×, meer dan primary en
secondary samen). Berekend tegen de tokens:

| | op `bg` | op `bg-surface` | op `bg-elevated` |
|---|---|---|---|
| dark `textMuted` | 4,35 | 4,08 | 3,87 |
| light `textMuted` | 3,81 | 4,20 | 4,09 |

WCAG AA vraagt 4,5 voor gewone tekst. Elke combinatie zakt. En er staan nog 30 plekken met
extra transparantie bovenop (`text-text-muted/70`, `/60`, `/50`). Ironisch: de merkkleur-engine
bewaakt contrast nauwgezet, de neutrale grijzen niet.

**Effect:** dit is de grootste enkele oorzaak dat het product "druk en grauw" voelt in plaats van
"rustig en modern". Moderne AI-producten (Claude, ChatGPT, Linear, Notion) draaien op 14–15px body
met duidelijk contrast en meer witruimte.

## 2. Knoppen: 84 varianten, en de schaal mist de maat die iedereen nodig heeft

**Gemeten:** 84 visueel verschillende knopsoorten (hoogte × radius × lettergrootte × achtergrond ×
rand) over 16 schermen. Op de inbox alleen: **22**, op de agenda 18.

Hoogtes live: 32px (356×), 28px (130×), 36px (39×), 24 (35×), 26 (26×), 22, 20, 18.

**Oorzaak in de code (`components/ui/button.tsx`):**
- Schaal: `sm` 32px, `md` 36px (default), `lg` 40px, `icon` 32px, `iconSm` 28px.
- Gebruik: `size="sm"` 386×, default `md` maar 101×. **De default is niet wat het product gebruikt.**
- Er is geen 28px-knop met tekst, dus wordt die met de hand gemaakt: 41× `className="h-7"`,
  14× `h-6`, 20× `h-8` op `<Button>`, plus 44× `px-` en 26× `text-xs` overrides.
- 372 kale `<button>` naast 545 `<Button>`. Die kale knoppen zijn ook de bron van de 16px-tekst.

## 3. Pagina's beginnen elk op hun eigen manier

**Gemeten (eerste kop per scherm):**

| Scherm | Kop | Grootte | Positie (links, boven) |
|---|---|---|---|
| Werk | H1 "Werk" | 17px | 24, 20 |
| Mappen | H1 "Mappen van Bokito" | 17px | 264, 20 |
| Map-detail | H1 "Algemeen" | 16px | 315, 71 |
| Afdeling | H1 "Accounting" | 17px | 80, 20 |
| Agents | H1 "Agents" | 17px | 24, 66 |
| Instellingen | H1 | 17px | 268, 16 |
| Leren | H1 **"projects"** (ruwe slug) | 17px | 154, 29 |
| Inbox | geen H1 | | |
| Agenda | geen H1 (H2 datum 13,5px) | | |
| Workforce | geen kop | | |

**Oorzaak:** drie concurrerende patronen. `ContentHeader` (h1 in content, 18 bestanden),
`PageIntro` (zegt in zijn eigen comment "Never renders an `<h1>` — the page title lives in the
topbar", 3 bestanden), en handgemaakte koppen (`DepartmentPage`, `StartCards`, `HelpCenter`).
Daarnaast toont de topbar óók de titel: op mobiel staat "Werk" in de topbar en direct eronder
nog eens "Werk" als H1.

De typografische rollen bestaan (`.title-page`, `.title-section`, `.title-card`, `.title-dialog`,
`.title-eyebrow`) maar worden respectievelijk 6, 3, 1, ~1 en 4 keer gebruikt. Pagina's zetten
hun koppen zelf: ~10 verschillende combinaties van `text-lg/xl/2xl` × gewicht × tracking.

## 4. Oppervlakken: tien randsterktes en veertig soorten kaarten

**Randen in de code:**

| Klasse | Aantal |
|---|---|
| `border-border/60` | 360 |
| `border-border/50` | 104 |
| `border-border` | 99 |
| `border-border/40` | 82 |
| `border-border/70` | 49 |
| `border-border-light` | 43 |
| `/80`, `/55`, `/30`, `/20` | 15 |

Het token `border` is niet de rand die het product gebruikt; `/60` is de feitelijke default.
Achtergronden idem: ~14 tinten via opacity (`bg-bg-hover/60`, `/70`, `/80`, `/40`, `/50`, …).

**Kaarten:** live 40 verschillende kaartsoorten (radius × padding × achtergrond × rand). In de code
twee parallelle API's voor hetzelfde: `<Card>` (65×) en de CSS-klasse `panel` (182×), plus
`<InsetPanel>` (8×). Kaartpadding: `p-4`, `px-4 py-3`, `p-5`, `px-3 py-2.5`, `p-3`, `p-6`.

**Effect:** veel haarlijnen in veel sterktes is precies wat een interface "oud en druk" maakt.
Moderne interfaces scheiden met 2–3 vlakniveaus en weinig randen.

## 5. Identiteit en AI-gevoel: geen herkenbare AI-signatuur

**Tien avatar-componenten voor drie begrippen** (mens, agent, team):
`UserAvatar` 27, `AgentMark` 31, `AiAvatar` 21, `TeamFacepile` 10, `ContactAvatar` 6,
`PersonAvatar` 5, `TeamAvatar` 4, `AvatarStack` 4, `BotOrbAvatar` 3, `AvatarDisc` 3,
`ParticipantMark` **0** (dood, maar staat in de catalogus).

**Drie concurrerende AI-uitdrukkingen:**
- De `ai`-kleur (violet) is als token "de AI-kleur", maar wordt 90× gebruikt tegen 628× `accent`.
  In de UI zie je hem nauwelijks.
- Elke agent heeft een eigen kleur en figuur (oranje druppel, teal, rode aap), met eigen
  gekleurde kaartwas op de Agents-pagina.
- Een orb-systeem: `bot-orb` 105×, `agent-glow` 9×, `ambient-spotlights`, `app-atmosphere`,
  `DotGridBackground` 8×.

En DESIGN_SYSTEM.md zegt: **"No glows. AI is marked by color (`ai`, `ai-ink`) and a hairline."**
De documentatie en de code spreken elkaar tegen, en jouw doel ("gaaf modern AI-gevoel") staat
haaks op de huidige principetekst. Dat moet eerst besloten worden, anders blijft het schuiven.

**Altijd aanwezig:** rechtsonder staat op elk scherm een zwevende toast ("Wat staat er open?") plus
een agent-orb. Op mobiel twee zwevende figuren. Dat concurreert met de echte content en met de
primaire actie.

## 6. Navigatie: dezelfde boom op meerdere plekken

- De mappenboom staat in de sub-rail van **Mappen**, in de rail van **Agenda**, én als kaarten
  op de Mappen-pagina.
- Afdelingen staan in de hoofdnavigatie én in de inbox-rail.
- De inbox is vijf kolommen breed (hoofdnav, inbox-rail, lijst, gesprek, agentpaneel); de lijst
  kapt titels af.
- De topbar heeft zes elementen naast de zoekbalk: Platform support, werkruimte, "Ops",
  Aan de slag, Hulp, meldingen.
- Elke sectie heeft een eigen sub-rail met een eigen structuur (Instellingen gebruikt zelfs
  twee rijen tabbladen met groepslabels erboven).

## 7. Iconen: geen schaal

`size={…}` op iconen: 14 (233×), 12 (186×), 13 (162×), 11 (98×), 16 (88×), 15, 20, 18, 10, 28.
Daarnaast klassen `h-3`, `h-3.5`, `h-4`, `h-5`, `h-6`. `strokeWidth`: tien waarden van 1,5 tot 3.
Live gemeten: 12px is het meestgebruikte icoon (304×) — klein en dun, past bij de 11,5px-tekst.

## 8. Lege staten en losse eindjes

- `<EmptyState>` 43×, tegenover ~144 losse "Nog geen…"-teksten in code en vertalingen.
- 16 handgemaakte `fixed inset-0`-overlays naast `<Dialog>`.
- Gemengde taal: de afdeling Accounting heeft een Engelse beschrijving in een Nederlandse UI.
- Mobiel: in de topbar loopt de werkruimtenaam over het zoekicoon heen.
- `/learn/projects` toont de ruwe slug "projects" als paginatitel.

---

## Richting: wat "modern, rustig, herkenbaar AI" hier concreet betekent

| Dimensie | Nu | Doel |
|---|---|---|
| Body-tekst | 11,5px | **14px** (`text-base` wordt echt de body) |
| Kleinste UI-tekst | 10,5px | 12px; 10,5px alleen voor tellers/badges |
| Gedempte tekst | contrast 3,8–4,4 | ≥ 4,5 in beide thema's |
| Knophoogtes | 8+ | 3: `xs` 28, `sm` 32, `md` 36 |
| Randen | 10 sterktes | 2: `hairline` en `strong` |
| Vlakken | ~14 tinten | 3 niveaus: `canvas`, `surface`, `raised` |
| Kaarten | `Card` + `panel` + 40 varianten | één `Card` met 2 paddings (`compact`, `default`) |
| Paginakop | 3 patronen + topbar-titel | één `PageHeader`: titel, één zin, één primaire actie |
| Iconen | 10 maten, 10 lijndiktes | 3 maten (14, 16, 20), één lijndikte (1,75) |
| Avatars | 10 componenten | 1 `Avatar` met `kind="person" \| "agent" \| "team"` |
| AI-signatuur | violet token + agentkleuren + orbs | één signatuur, overal gelijk (zie hieronder) |

**De AI-signatuur — voorstel.** Kies één visuele taal voor "dit is een agent" en gebruik die
overal waar een agent spreekt, werkt of iets voorstelt:
- **Kleur:** het bestaande `ai`-token is de enige agentkleur in de chrome. Agents mogen een eigen
  tint in hun avatar houden (afgeleid zoals `brandPalette` dat doet), maar niet in kaarten,
  knoppen of achtergronden.
- **Beweging:** één "agent werkt"-animatie (bijvoorbeeld de bestaande shimmer), dezelfde in
  lijst, gesprek, bord en topbar. Geen losse glows per scherm.
- **Vorm:** agentberichten en -voorstellen krijgen één herkenbare container (de "flat surface met
  2px `ai`-linkerrand" uit de docs is een goed begin, maar maak hem consistent).
- **Werk DESIGN_SYSTEM.md bij** zodat de principes zeggen wat je wilt. "No glows" mag blijven
  als je voor rust kiest, maar dan moeten de orbs weg; of de signatuur wordt zacht animerend, en
  dan moet de tekst mee.

---

## Uitvoering (voor Cursor, na `design-system-ombouw.md` fase 0–3)

Elke fase hieronder is een **bewuste zichtbare verandering**, anders dan in het ombouwplan.
Per fase: eerst de token- of componentwijziging, dan een guard-regel zodat het niet terugkomt.

### Fase A — Leesbaarheid en contrast
- [ ] `palette.mjs`: `textMuted` ophogen tot ≥ 4,5 op `bg`, `bg-surface` en `bg-elevated` in beide
      thema's. Voeg een test toe in `tokens.test.ts` die die contrasten berekent en afdwingt.
- [ ] Type-ladder één stap omhoog voor content: `text-base` wordt 14px, `text-sm` 12,5–13px. Voer dit
      in via de generator (ombouwplan fase 2), niet per pagina.
- [ ] Guard-regel: `text-2xs` alleen in de catalogus (badges, tellers), niet in pagina's.
- [ ] Guard-regel (ratchet): `text-text-muted/[0-9]+` — geen extra transparantie op gedempte tekst.

### Fase B — Eén control-schaal
- [ ] `button.tsx`: `size` wordt `xs` (28) / `sm` (32) / `md` (36), default `sm`. `iconSm`/`icon`
      volgen dezelfde hoogtes.
- [ ] Vervang de 55 `className="h-6|h-7|h-8"`-overrides op `<Button>` door de juiste `size`.
- [ ] Guard-regel: `<Button` met `h-[0-9]` in className is een fout.
- [ ] Zelfde schaal voor `Input`, `Select`, `SearchField` (nu 28/32/36 door elkaar).

### Fase C — Eén paginaskelet
- [ ] Nieuw `components/layout/PageHeader.tsx` (titel, optionele omschrijving, primaire actie,
      overige acties in een menu). Vervangt `ContentHeader` en `PageIntro`.
- [ ] Beslis: titel in de topbar óf in de pagina, niet beide. Advies: in de pagina; de topbar
      toont alleen breadcrumb.
- [ ] Migreer alle schermen uit de tabel in §3; elke pagina begint op dezelfde positie.
- [ ] Fix `/learn/projects` (titel uit de slug).
- [ ] Guard-regel: `<h1` buiten `PageHeader` en de auth-/docs-schermen is een fout.

### Fase D — Oppervlakken
- [ ] Tokens: `border` wordt de huidige `/60`-waarde (zodat de default klopt), plus
      `border-strong`. Vlakken: `canvas`, `surface`, `raised`.
- [ ] Guard-regel (ratchet): `border-border/[0-9]+` en `bg-bg-*/[0-9]+`.
- [ ] Kies `Card` of `panel`, niet beide. Advies: `<Card padding="compact|default">`; `panel`
      wordt een alias en verdwijnt.

### Fase E — Identiteit en AI-signatuur
- [ ] Eerst beslissen (Lorenzo): de AI-signatuur en de tekst in DESIGN_SYSTEM.md.
- [ ] Eén `Avatar` met `kind`; de tien componenten worden er wrappers van en verdwijnen daarna.
      Verwijder `ParticipantMark` (0 gebruik).
- [ ] Eén "agent werkt"-animatie in de catalogus; vervang losse glows/orbs.
- [ ] De permanente toast + orb rechtsonder: alleen tonen als er echt iets op je wacht.

### Fase F — Iconen
- [ ] `components/ui/Icon.tsx` als wrapper om Lucide met `size="sm|md|lg"` (14/16/20) en vaste
      `strokeWidth` 1,75.
- [ ] Guard-regel (ratchet): `size={…}` en `strokeWidth={…}` direct op Lucide-iconen.

### Fase G — Navigatie en lege staten (raakt het herontwerp)
- [ ] Eén plek voor de mappenboom en één plek voor afdelingen.
- [ ] Topbar terug naar zoeken + werkruimte + meldingen + account.
- [ ] Losse "Nog geen…"-blokken → `<EmptyState>` met één zin en één actie.

Deze fase overlapt met het herontwerp op het canvas ("Opnieuw ingedeeld"). Doe hem niet los,
maar als onderdeel van die keuze.

---

## Volgorde

1. Ombouwplan fase 0–3 (plumbing, geen zichtbare verandering).
2. **A** (leesbaarheid) en **B** (controls): grootste zichtbare winst, laag risico.
3. **C** (paginaskelet) en **D** (oppervlakken): het product gaat "één geheel" voelen.
4. **E** (AI-signatuur): pas na het besluit; dit bepaalt het "AI-gevoel".
5. **F** en **G**.
