# Ombouwplan design system

> Audit 2026-10-22 op `origin/master` (c09d356). Doel: één bron per dimensie, centraal te tweaken,
> zonder dat web, native en widget uit elkaar lopen — en **zonder zichtbare verandering** tenzij
> een fase dat expliciet zegt.

## Wat er nu misgaat (de drie bevindingen die dit plan oplost)

1. **De radius-ladder betekent twee dingen.** `packages/ui-tokens/src/radius.ts` zegt `lg = 12px`.
   `tailwind.config.ts` definieert géén `borderRadius`, dus het web gebruikt Tailwinds standaard,
   waar `rounded-lg = 8px`. De hele ladder is één stap verschoven. `rounded-lg` staat 414× in het
   dashboard. Gevolg: "lg" betekent iets anders afhankelijk van welk bestand je open hebt.
2. **De guard draait niet.** `apps/dashboard/package.json` heeft `"lint"` met
   `check-design-system.mjs`, maar `.github/workflows/ci.yml` roept `npm run lint` nergens aan.
   Op master staan daardoor 5 openstaande overtredingen.
3. **Afgeleide waarden worden overgetypt, niet gegenereerd.** De type-ladder staat met de hand in
   `typography.ts` (px) én `tailwind.config.ts` (rem). Schaduw en motion staan alleen in
   `index.css` / `tailwind.config.ts` en helemaal niet in tokens. `.docs-site` in `index.css`
   herhaalt merkkleuren als letterlijke RGB.

**De regel die alles oplost: elke afgeleide vorm van een token wordt gegenereerd, nooit overgetypt.**

## Spelregels voor dit plan

- Eén fase = één commit = één PR. Fases zijn op volgorde bedoeld; fase 0 eerst.
- Geen visuele verandering, behalve waar een fase het expliciet benoemt. Fase 1 en 2 zijn
  bewust waarde-behoudend.
- Na elke fase groen:
  ```
  npm run lint -w bokito-dashboard
  npx tsc --noEmit -p apps/dashboard && npx tsc --noEmit -p packages/ui
  npm test -w @bokito/ui-tokens && npm test -w @bokito/ui && npm test -w bokito-dashboard
  npm run build:dashboard
  ```
- Raak `BOKITO_KNOWLEDGE.md` niet aan in deze PR's; dat is een los document.

---

## Fase 0 — Vangnet eerst

Zonder dit merk je een regressie pas op productie.

### 0a. Zet de guard in CI

- [ ] In `.github/workflows/ci.yml`, in de dashboard-job, na de typecheck:
      `- name: Lint dashboard` / `run: npm run lint -w bokito-dashboard`
- [ ] Dat dekt in één klap `check-boundaries.mjs`, `check-design-system.mjs` en `check-copy.mjs`.

### 0b. Ruim de 5 bestaande overtredingen op

`node apps/dashboard/scripts/check-design-system.mjs --list` geeft precies deze:

| Regel | Plek |
|---|---|
| `arbitrary-text-size` | `components/inbox/ChatBubble.tsx:242` — `text-[15.5px]` |
| `native-select` | `components/integrations/ModuleInstallControls.tsx:295` en `:310` |
| `hand-rolled-card` | `components/project-canvas/CanvasKindBody.tsx:92` |
| `hand-rolled-card` | `components/project-canvas/CanvasWindow.tsx:245` |

- [ ] `text-[15.5px]` → `text-lg` (15px) tenzij die 0,5px aantoonbaar nodig is; dan
      `design-system-ignore` met reden op die regel.
- [ ] De twee `<select>` → `<Select>` uit `components/ui/select`.
- [ ] De twee kaarten → `<Card>` of `className="panel"`.
- [ ] De ratchet-items die op c09d356 boven baseline staan (de audit noemde
      `NotificationSettings` als `raw-button`; dat is `raw-input`):
      `raw-button` in `OrgStructureMap.tsx` (1), `CanvasWindow.tsx` (1),
      `AgentIdentityDialog.tsx` (1), `WorkflowPage.tsx` (1), plus
      `ChatText.tsx` (1) from the copy-window commit;
      `raw-input` in `FlowRecipe.tsx` (2), `ModuleInstallControls.tsx` (1),
      `NotificationSettings.tsx` (3);
      `hex-color` in `OrgDetailPanel.tsx` (1, `#3b82f6`, geen bestaand token).
      Baseline bijwerken voor die acht, niet de UI. `--update-baseline` over de
      hele file niet gebruiken: dat zou tellingen die al onder baseline zitten
      ook laten zakken.

### 0c. Bouw de CSS-diff-harness

Dit is het bewijs dat fase 1 en 2 niets veranderen.

- [ ] Script `apps/dashboard/scripts/css-snapshot.mjs`: draait `vite build`, pakt
      `dist/assets/index-*.css`, strippt de contenthash uit de bestandsnaam, en schrijft de
      inhoud naar een opgegeven pad.
- [ ] Gebruik: snapshot vóór de wijziging, snapshot erna, `diff` moet leeg zijn.
- [ ] Niet in CI opnemen; dit is gereedschap voor deze ombouw.

---

## Fase 1 — De radius-ladder waar maken (geen pixel verandert)

De truc: we nemen **Tailwinds namen en waarden** als de ene ladder, en verzetten de native
call sites één stap omhoog, zodat ze op exact dezelfde pixels uitkomen.

### De mapping (waarde-behoudend)

| Nu in `radius.ts` | px | Wordt | px |
|---|---|---|---|
| `radius.sm` | 6 | `radius.md` | 6 |
| `radius.md` | 8 | `radius.lg` | 8 |
| `radius.lg` | 12 | `radius.xl` | 12 |
| `radius.xl` | 16 | `radius['2xl']` | 16 |
| `radius.pill` | 999 | `radius.full` | 9999 |

- [ ] Herschrijf `packages/ui-tokens/src/radius.ts` naar de Tailwind-ladder:
      `none: 0, sm: 2, DEFAULT: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, full: 9999`.
- [ ] Migreer de 35 call sites volgens de tabel hierboven. Ze zitten in:
      `packages/ui/src/{Surface,Badge,IconButton,EmptyState}.tsx`,
      `packages/ui/src/list/NavRow.tsx`, `packages/ui/src/thread/ComposerBar.tsx`,
      `packages/ui/src/compose/{IntentGrid,TargetCarousel}.tsx`,
      en ~12 bestanden onder `apps/mobile/`.
- [ ] Behoud `pill` als `@deprecated` alias van `full` als dat de migratie makkelijker maakt,
      en verwijder hem in dezelfde PR zodra de call sites om zijn.

**Verificatie:** elke gewijzigde regel moet dezelfde px opleveren als ervoor. Loop de diff na met
de tabel; er mag geen enkele waarde van kolom 2 naar een andere px in kolom 4 gaan.
`npx tsc --noEmit -p packages/ui` en `npm run typecheck -w bokito-mobile` moeten groen zijn.

---

## Fase 2 — Eén generator, drie artefacten

`packages/ui-tokens` wordt de enige plek waar een waarde staat. Alles eromheen wordt output.

- [ ] Hernoem `scripts/emit-css.mjs` naar `scripts/emit.mjs` en laat het drie bestanden schrijven:

  1. `apps/dashboard/src/styles/tokens.generated.css` — ongewijzigd gedrag (CSS-variabelen,
     beide thema's).
  2. `packages/ui-tokens/tailwind-preset.generated.cjs` — **nieuw**. Bevat `colors`,
     `fontSize`, `borderRadius` en `fontFamily`, afgeleid van dezelfde bron.
  3. `packages/ui-tokens/src/theme.generated.ts` — **nieuw**, voor React Native, zodat
     `packages/ui/src/theme.tsx` niet langer losse modules importeert.

- [ ] In `apps/dashboard/tailwind.config.ts`: vervang de handgeschreven `colors`-, `fontSize`- en
      `fontFamily`-blokken door `presets: [require('@bokito/ui-tokens/tailwind-preset.generated.cjs')]`.
      **Laat staan** in de config: `content`, `maxWidth`, `width`, `boxShadow`, `opacity`,
      `keyframes`, `animation`, `textColor` — die gaan in fase 4 of blijven app-specifiek.

**Verificatie:** dit is een no-op voor het web. Draai de harness uit fase 0c vóór en na;
`diff` moet **leeg** zijn. Is hij dat niet, dan wijkt de preset af van wat er met de hand stond,
en dat is precies de drift die we zoeken — los het op in de generator, niet in de config.

---

## Fase 3 — Drift onmogelijk maken

- [ ] Vervang de tweede test in `packages/ui-tokens/src/tokens.test.ts` ("matches the generated
      dashboard stylesheet", die nu vijf letterlijke regels checkt) door een **regenereer-en-diff**:
      draai de generator naar een tijdelijke map en vergelijk alle drie de artefacten byte voor
      byte met wat er in de repo staat. Faalt de test, dan is de boodschap: "draai `npm run emit -w @bokito/ui-tokens`".
- [ ] Laat de eerste test (die pint dat bg `#121213` is en accent `20 166 116` in light) staan:
      die bewaakt bewuste merkwaarden, niet de generatie.
- [ ] CI draait dit al via `npm test -w @bokito/ui-tokens`.

Vanaf hier kan niemand meer een token toevoegen zonder dat alle afgeleiden meelopen.

---

## Fase 4 — Schaduw en motion in tokens

Deze twee dimensies staan nu alleen in `index.css` en `tailwind.config.ts`, en zijn dus niet
centraal te tweaken.

- [ ] Nieuw `packages/ui-tokens/src/elevation.ts`: `card`, `cardHover`, `overlay`,
      `insetHighlight`, `chipActive`, `btn` — per thema, net als kleuren.
- [ ] Nieuw `packages/ui-tokens/src/motion.ts`: de duur- en easing-waarden die nu in
      `tailwind.config.ts` onder `animation` staan (180/220/240/280/340ms en
      `cubic-bezier(0.16, 1, 0.3, 1)`). De keyframes zelf blijven in de Tailwind-config;
      alleen duur en easing worden tokens.
- [ ] Generator schrijft ze mee als CSS-variabelen en in de preset.
- [ ] `index.css` verwijst daarna naar de gegenereerde variabelen in plaats van ze zelf te zetten.

**Verificatie:** opnieuw de CSS-diff-harness. Leeg.

---

## Fase 5 — Letterlijke waarden opruimen

- [ ] `index.css`, de `.docs-site`-blokken (regels ~2668, ~2689, ~2707): die herhalen
      `50 191 142` / `20 166 116` drie keer. Laat de generator een
      `--color-accent-platform` (en de bijbehorende hover/dark/fg/ink) emitten en verwijs
      ernaar: `--color-accent: var(--color-accent-platform);`.
      **Behoud het gedrag**: deze blokken bestaan om te voorkomen dat een tenant-`brand_color`
      de docs-CTA's verkleurt. Dat moet zo blijven.
- [ ] `apps/chat-widget/src/widget-main.ts`: 55 hardcoded hex-kleuren, terwijl
      `theme-tokens.ts` ernaast netjes uit `@bokito/ui-tokens` importeert. Haal ze door
      `theme-tokens.ts`.
- [ ] Breid daarna de boundary-checker uit: laat `packages/ui/scripts/check-boundaries.mjs`
      ook over `apps/chat-widget/src` lopen voor de `hex`-regel, zodat het niet terugkomt.

---

## Fase 6 — Aflossen in plaats van alleen vasthouden

De ratchet voorkomt groei maar plant geen krimp. Huidige schuld in
`apps/dashboard/scripts/design-system-baseline.json`:

| Regel | Bestanden | Treffers |
|---|---|---|
| `raw-button` | 134 | 357 |
| `hex-color` | 26 | 158 |
| `raw-input` | 28 | 54 |
| `arbitrary-radius` | 7 | 17 |

- [ ] Begin bij `arbitrary-radius` (17 treffers, 7 bestanden) — klein en nu direct te koppelen
      aan de ladder uit fase 1.
- [ ] Dan `hex-color`: de top-4 zijn datatabellen (`integration-brand.ts` 22,
      `default-signature.ts` 19, `org-flow-layout.ts` 18, `integrations-data.ts` 15). Dat zijn
      merkkleuren van derden, geen UI-kleuren. Overweeg die vier bestanden een eigen
      uitzondering te geven in de guard ("vendor brand data"), zodat het getal eerlijk wordt
      en de resterende hex echte schuld is.
- [ ] `raw-button` en `raw-input` meeliften op werk dat je toch in een bestand doet; niet als
      losse opruimactie.

---

## Fase 7 — Richtingskeuze: wat is `packages/ui`?

**Dit is geen mechanische stap. Lorenzo beslist, niet Cursor.**

Feit: `apps/dashboard` importeert **nul** bestanden uit `@bokito/ui`. Alleen `apps/mobile`
gebruikt het (10 bestanden). Toch heet het "shared UI", heeft het een boundary-checker en
draait het in CI. Gevolg: `Badge` is op het web `rounded-lg` (8px, en het commentaar zegt
expliciet "never a pill"), en op native `radius.pill`. Zelfde naam, tegenovergestelde vorm.

Twee uitwegen:

- **A. Echt delen.** Web-varianten toevoegen met het `.web.tsx`-patroon dat `Icon.web.tsx` al
  gebruikt, en de dashboard-catalogus daar stap voor stap op laten landen. Hoge kosten,
  maar dan is één component ook écht één component.
- **B. Eerlijk hernoemen.** `packages/ui` wordt `packages/mobile-ui`. De gedeelde laag is dan
  alleen `ui-tokens` plus `shared`. Lage kosten, en de belofte klopt weer.

Zolang deze keuze openstaat, blijft elke component twee keer bestaan zonder dat iets dat bewaakt.
Kies B als je niet binnen een kwartaal aan A begint.

---

## Volgorde en verwachte opbrengst

| Fase | Inspanning | Wat het oplevert |
|---|---|---|
| 0 | klein | De guard werkt weer; regressies worden gezien |
| 1 | middel | "lg" betekent overal hetzelfde, zonder pixelverandering |
| 2 | middel | Tailwind kan niet meer afwijken van de tokens |
| 3 | klein | Drift wordt onmogelijk in plaats van onwaarschijnlijk |
| 4 | middel | Schaduw en motion worden centraal tweakbaar |
| 5 | klein | Geen gekopieerde merkkleuren meer |
| 6 | doorlopend | Oude schuld krimpt aantoonbaar |
| 7 | beslissing | Einde aan twee componentsets zonder bewaking |

Fase 0 tot en met 3 samen maken het systeem "centraal tweakbaar zonder afwijken". Dat is de kern
van de opdracht; 4 tot 7 zijn afmaken en opruimen.
