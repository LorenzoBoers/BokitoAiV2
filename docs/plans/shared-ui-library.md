# Gedeelde UI voor web en mobiel

Plan om de dashboard-webapp en de Expo-app dezelfde componenten, kleuren, typografie en spacing te laten gebruiken. De repo is al een npm-workspace. Dit plan voegt een UI-bibliotheek toe in die workspace. Het vervangt het dashboard niet door een React Native-app, en het vervangt de mobiele shell niet door een ingepakte website.

Datum: 2026-10-19. Status: in progress. Uitwerking: shared app UI execution plan (packages/ui-tokens, packages/ui, phases A-G).

## Aanbeveling

Schrijf de gedeelde schermen in **React Native-primitieven** (`View`, `Text`, `Pressable`, `FlatList`) in een nieuw pakket `packages/ui`.

- Op de telefoon rendert Metro die componenten native.
- In het dashboard rendert Vite dezelfde componenten via **react-native-web**, alleen op de schermen die meeverhuizen.
- Kleuren, type en spacing komen uit een tweede pakket, `packages/ui-tokens`. Zowel Tailwind (web) als `StyleSheet` (mobiel) lezen die bron.

De shells blijven per platform: Expo Router, tabbar, safe area, toetsenbord, push en bestandskiezer op mobiel; `AppShell`, React Router, Radix, Tailwind en de bestaande pagina's op web.

React Native Web is hier de bibliotheeklaag voor de gedeelde schermen. Het is niet de renderer van Overview, Grid, Govern, Knowledge of Connections.

## 1. Wat er nu staat

### Workspace

Root `package.json` (`bokito-platform`) heeft al npm-workspaces: `apps/*` en `packages/*`. React staat via `overrides` vast op **19.2.0** voor web en mobiel. Dat is de voorwaarde om één componentenboom te delen.

| Pad | Rol | UI |
| --- | --- | --- |
| `apps/dashboard` | Vite + React 19 + Tailwind 3 + Radix | DOM-designsystem in `src/components/ui`, tokens in `src/index.css` en `tailwind.config.ts` |
| `apps/mobile` | Expo 55, React Native 0.83, Expo Router | Eigen `StyleSheet` en `src/theme.ts`. Geen import van `@bokito/shared` |
| `apps/chat-widget` | Vite-embed | Gebruikt `@bokito/shared`, eigen DOM |
| `apps/api` | FastAPI | Geen UI. Blijft de bron van gedrag, labels en regels |
| `packages/shared` | `@bokito/shared` | Types, chat-layout, merk-kleur, stream-hulp. Geen componenten |
| `packages/chat-client` | `@bokito/chat-client` | Clientlogica, geen schermen |

### Web: schermen die als eerste gedeeld worden

De web-shell is `apps/dashboard/src/components/shell` (`AppShell`, `ShellSidebar`, `CommandPalette`). De vier doeloppervlakken zitten daaronder:

| Doel | Huidige plek | Omvang |
| --- | --- | --- |
| Chatthread | `components/inbox/ThreadDetail.tsx`, `ChatBubble.tsx`, `ReplyComposer.tsx`, `ChatText.tsx` | ThreadDetail is een grote pagina: data, beslissingen, mail, AI-afhandeling en composer in één component |
| Nieuwe chat | `pages/NewConversationPage.tsx` | Route `/new` |
| Communicatie-overzicht | `pages/Communication.tsx` + `components/inbox/MessagesHubNav.tsx` + `ThreadList.tsx` | De rail is een map: For you, mappen, flows, kanalen, agents, afdelingen |
| Agenda | `pages/AgendaPage.tsx` + `components/agenda/` | Dag, week, maand en lijst. De pagina is ruim 800 regels en bezit de layout |

Tokens op web (design system, 2026-10) staan als CSS-variabelen in `index.css`. Donkere vlakken zijn warm grijs: achtergrond `#121213`, surface `#19191B`, elevated `#1E1E21`, hover `#26262A`. Lettertypen: Inter en JetBrains Mono. De type-schaal staat in `tailwind.config.ts` (`2xs` 10.5px tot `2xl` 20px). Spacing volgt de Tailwind-schaal. Radius: shell `2xl`/`xl`, kaarten `lg`, invoer en knoppen `md`.

Het dashboard lint (`apps/dashboard/scripts/check-design-system.mjs`) dwingt die catalogus af: geen ruwe statuskleuren, geen native `<select>`, geen losse kaart-strings.

### Mobiel: wat de geportte app nu echt is

`apps/mobile` is Expo, niet een WebView van het dashboard. `react-native-webview` zit er alleen in om HTML in een bericht te tonen.

Routes:

| Route | Bestand | Wat de gebruiker ziet |
| --- | --- | --- |
| Tab Home | `app/(tabs)/home.tsx` | Nieuwe chat: kies een agent of persoon, schrijf, start het gesprek. Acties voor mail, ticket, agenda-item, transcript, notitie, contacten |
| Tab Berichten | `app/(tabs)/conversations.tsx` | Platte lijst, vast op de wachtrij For you, met zoeken |
| Thread | `app/thread/[id].tsx` | Bubbles, dagen, streaming, denkstappen, composer. Ongeveer 770 regels scherm plus `MessageBubble`, `ThreadComposer`, `StreamingBubble` |
| Tab Account | `app/(tabs)/account.tsx` | Sessie en een link die de workspace in de browser opent |
| Login, notificaties | `app/login.tsx`, `app/notifications.tsx` | Shell |

Er is **geen agenda-scherm**. Een notificatie met `trigger_id` wordt een webpad `/agenda` (`src/lib/notification-path.ts`). Accounttekst zegt dat agenda, agents, contacten en instellingen op het volledige workspace blijven.

`src/theme.ts` kopieert een ouder palet (donker `#101319`, sidebar `#14171f`). Dat wijkt af van het dashboardpalet hierboven. Spacing (`4/8/12/16/24`) en radius (`8/10/12/16`) zijn een eigen schaal, niet de Tailwind-schaal van het dashboard. Iconen zijn Ionicons. Het dashboard gebruikt Lucide.

Data op mobiel: eigen `src/lib/api.ts`, TanStack Query, een signaalstream (`useSignalStream`). Het dashboard heeft een parallelle inbox-API. Gedrag hoort op de API te blijven; de bibliotheek krijgt alleen de velden die een rij of bubble tekent.

### Wat al gedeeld is, en wat niet

`packages/shared` deelt berichtvorm en lay-outregels (groeperen van bubbles, merk-kleur). Het deelt geen knop, geen rij, geen kleurtoken die beide apps importeren. Een wijziging in `index.css` verschijnt daardoor niet op de telefoon, en een wijziging in `theme.ts` niet op het web.

## 2. Technologie

### Gekozen stapel

| Laag | Pakket | Techniek |
| --- | --- | --- |
| Tokens | `packages/ui-tokens` | TypeScript-bron met licht/donker, type-schaal, spacing, radius. Bouwt CSS-variabelen voor Tailwind en een `theme` object voor React Native |
| Componenten | `packages/ui` | React Native-componenten. Geen `react-dom`, geen Expo Router, geen `fetch` |
| Web-eiland | Vite-alias in `apps/dashboard` | `react-native` → `react-native-web` alleen voor imports uit `@bokito/ui` |
| Mobiele shell | `apps/mobile` blijft Expo | Importeert `@bokito/ui` direct |
| Logica die al gedeeld is | `packages/shared` | Blijft. De UI-pakketten importeren daar lay-outregels uit, ze kopiëren ze niet |

Eén wijziging in `packages/ui` of `packages/ui-tokens` is daarna de wijziging op beide schermen, zodra web én een mobiele JS-bundel (Expo Update of store-build) live staan. Zie paragraaf 4 voor die releasekoppeling.

### Waarom deze stapel bij de bestaande code past

Beide apps draaien al React 19.2. De mobiele UI is al `View`/`Text`. De gedeelde bubbles en rijen kunnen die primitieven houden. react-native-web zet diezelfde boom op `div`/`span` in het dashboard, zonder de rest van Vite om te bouwen.

Het dashboard is te groot en te DOM-specifiek om in zijn geheel naar React Native Web te trekken. Grid gebruikt Three.js, flows gebruiken xyflow, kennis gebruikt TipTap, grafieken gebruiken Recharts, menu's gebruiken Radix. Die blijven in de web-shell.

Tamagui of NativeWind als enige stylingsysteem zou een tweede compiler naast Tailwind zetten en het bestaande design-system-lint doorkruisen, vóórdat één scherm gedeeld is. Die stap is later mogelijk als de tokenbron stabiel is. Hij is niet de eerste migratie.

Een tokenpakket alleen (kleuren wel gedeeld, componenten twee keer) deelt het uiterlijk van shells, maar een bubble-wijziging blijft twee pulls. Dat haalt het doel niet voor de vier schermen. Tokens zijn fase 0. Componenten zijn fase 1 en verder.

### Grens van een gedeelde component

Een component in `packages/ui` mag:

- tokens en typografie gebruiken
- data tonen die de shell als props geeft (bericht, rij, agendapunt)
- callbacks aanroepen (`onSend`, `onOpenThread`, `onPressEvent`)
- een platformslot invullen dat de shell meegeeft (`renderHtml`, `icon`)

Een component in `packages/ui` mag niet:

- de API aanroepen of een wachtrij bepalen
- navigeren
- een bedrijfsregel dupliceren die de API al afdwingt (AI-afhandeling, ticketfasen, inboxlidmaatschap)
- Radix, Expo Router, of `window` importeren

De shell levert die rand. Voorbeeld voor een thread:

```ts
type ThreadScreenProps = {
  messages: ThreadMessage[]
  composer: { value: string; onChange: (value: string) => void; onSend: () => void }
  renderHtml: (html: string) => React.ReactNode
  onOpenAttachment: (id: string) => void
}
```

Web vult `renderHtml` met de bestaande gesaniteerde HTML. Mobiel vult het met de bestaande WebView. De bubble eromheen is één component.

### Iconen en lettertypen

De bibliotheek krijgt een klein icoon-contract (`icon: 'mail' | 'calendar' | ...`) en elke shell tekent het met haar eigen set tot de set gelijkgetrokken is. Daarna één set in `packages/ui` (Lucide op web, `lucide-react-native` op mobiel, dezelfde namen). Inter en JetBrains Mono worden op mobiel via `expo-font` geladen met dezelfde familie-namen als `--font-sans` en `--font-mono`.

## 3. Migratie in fasen

Elke fase eindigt met het scherm op beide platforms op dezelfde component, met de oude implementatie weg uit dat scherm. Geen tweede bubble "tijdelijk" naast de eerste.

### Fase 0 — Tokens gelijk trekken

Bron van waarheid: de dashboardtokens in `index.css` en de type-schaal in `tailwind.config.ts`. Het mobiele `theme.ts` loopt achter (ander donker palet).

1. Zet kleur, spacing, radius en fontmaten in `packages/ui-tokens`.
2. Laat `index.css` de variabelen uit dat pakket halen (gegenereerd bestand of rechtstreekse import). Tailwind blijft de class-namen (`bg-bg-surface`, `text-sm`) leveren.
3. Laat `apps/mobile/src/theme.ts` die tokens re-exporteren. `ThemeContext` blijft de lichte, donkere en systeemkeuze doen.
4. Voeg een test toe die de hex-waarden van licht en donker vastlegt, zodat een paletwijziging één diff is.

Klaar wanneer een accent- of achtergrondwijziging in `packages/ui-tokens` op een dashboardkaart en op het mobiele login- of lijstscherm dezelfde kleur geeft. De shells gebruiken dan al gedeelde tokens, ook voordat schermen verhuizen.

### Fase 1 — Pakket en één primitief

1. Maak `packages/ui` met Metro- en Vite-configuratie: dashboard alias `react-native` → `react-native-web` beperkt tot dit pakket, zodat de rest van het dashboard gewoon DOM blijft.
2. Verhuis één kleine primitief die beide kanten al hebben, bijvoorbeeld de lege staat (`apps/mobile/src/components/EmptyState.tsx` en het dashboard-`EmptyState`).
3. Zet een fixture-scherm op web en een route op mobiel die alleen die primitief toont.

Klaar wanneer beide apps het pakket in de bundel hebben en de design-system-check ook losse hex in `packages/ui` afkeurt.

### Fase 2 — Chatthread

Meest gebruikte oppervlak. Eerste gedeelde onderdelen, in deze volgorde:

1. Bubble-chrome: `ChatBubble` op web en `MessageBubble` op mobiel. Zelfde groepering via `packages/shared` (`chat-layout`).
2. Dagscheiding en streaming-regel (`StreamingBubble`, `ShimmerText`).
3. Composer-balk: tekstveld, verzenden, stop. Mail-modus, bijlagen en dicteren blijven shell-slots. Web houdt `ReplyComposer` als orchestrator; de balk zelf komt uit `packages/ui`.
4. Het scherm `thread/[id].tsx` en `ThreadDetail.tsx` blijven de data, mutaties en beslissingskaarten doen. Beslissingskaarten zijn dashboard-rijk (Radix, voorstellen). Die verhuizen pas wanneer de bubble stabiel is, als een aparte `DecisionCard` met callbacks.

HTML-mail en bijlagen blijven platform-slots, zoals hierboven.

Klaar wanneer een bubble-wijziging (avatar, tijdstip, AI-chip, groepering) één pull request is en op `/communication/.../t/:id` en op `app/thread/[id]` hetzelfde oogt.

### Fase 3 — Nieuwe chat

Web: `NewConversationPage`. Mobiel: `app/(tabs)/home.tsx`.

Delen:

- kieslijst van chatdoelen (agent of persoon, lead eerst)
- invoer en verzendbalk uit fase 2
- rij met vervolgacties (mail, ticket, agenda-item, notitie)

De shell beslist wat een actie opent. Op mobiel blijft een actie die nog geen native scherm heeft naar het webpad gaan tot fase 5 dat scherm heeft. De rij zelf is gedeeld.

Klaar wanneer Home en `/new` dezelfde doelkiezer en dezelfde composer tonen.

### Fase 4 — Zijmenu en communicatie-overzicht

Dit is het grootste verschil in informatiedichtheid.

Mobiel toont nu één lijst (For you). Web toont `MessagesHubNav`: mappen, flows, kanalen, chats met agents, afdelingen, plus de threadlijst.

Delen in twee stappen:

1. **Rij en lijst.** `ThreadRow` (titel, preview, kanaalmarkering, tijd, ongelezen) vervangt de rij in `conversations.tsx` en in `ThreadList.tsx`. Zoekveld uit dezelfde primitief als fase 1.
2. **Navigatieboom.** Een `InboxNav` die secties als data krijgt (`{ id, label, unread, children }`). De shell bouwt die data. Op web blijft de bestaande boom (mappen, flows, kanalen, afdelingen). Op mobiel levert de shell eerst For you, All en Unassigned, en daarna dezelfde secties in een schuifpaneel. De component kent de sectienamen niet.

Slepen, het oog om een rij te verbergen, en het instellingenvenster van de web-rail blijven in de web-shell. Dat is lay-out van het dashboard, geen gedeelde primitive in de eerste stap.

Klaar wanneer een rij-wijziging op de web-lijst en de mobiele lijst dezelfde is, en de mobiele app de communicatie-secties kan tonen zonder een tweede rij-component.

### Fase 5 — Agenda

De web-agenda bestaat. De mobiele app heeft het scherm niet.

1. Deel eerst het lijst- en dagoverzicht: gebeurtenisrij, tijd, herhaling, lege staat. Dat is de mobiele agenda (`app/agenda.tsx`) en de lijstmodus van `AgendaPage`.
2. Week- en maandraster blijven in de web-shell tot het lijstoverzicht gelijk is. Een raster is lay-out; de chip op een blok komt wel uit `packages/ui`.
3. Koppel de notificatie-route die nu `/agenda` als webpad teruggeeft aan het nieuwe mobiele scherm wanneer het scherm een item kan openen.

Klaar wanneer een agendapunt op de telefoon en in de web-lijst dezelfde rij is, en een tokenwijziging beide kleurt.

### Wat bewust later blijft

Overview, Grid, Knowledge, Flows, Connections, Govern, instellingen en het chat-widget. Het widget kan in een latere fase de bubble uit `packages/ui` via react-native-web nemen; dat is een derde shell, geen voorwaarde voor de vier schermen.

## 4. Deploy, schaal en beheer

### Deploy wordt een gekoppelde UI-release, geen enkele binary

Web en mobiel blijven twee artefacten.

| Artefact | Nu | Na de bibliotheek |
| --- | --- | --- |
| Dashboard | `npm run build:dashboard` (Vite static), naast de API op dezelfde origin | Zelfde build. De bundel bevat `@bokito/ui` via react-native-web. Deploy van het dashboard blijft de web-release |
| API | Eigen proces, schema via Alembic | Ongewijzigd. De bibliotheek importeert de API niet |
| Mobiel | `expo run:android` / iOS, lokaal of store | JS-wijzigingen in `packages/ui` kunnen via **Expo Updates** (`expo-updates` staat al in de app) naar geïnstalleerde apps, zonder store-review, zolang er geen native module bij komt. Nieuwe native modules (lettertype-binary, nieuw device-API) blijven een store-build |

Een visuele wijziging is klaar wanneer beide artefacten die commit bevatten. CI op paden `packages/ui/**` en `packages/ui-tokens/**` draait:

- `npm run build:dashboard`
- `apps/mobile` typecheck
- de token-snapshottest
- de bestaande dashboard design-system-check, uitgebreid naar het UI-pakket

Web kan dezelfde dag live. Mobiel JS kan dezelfde dag via Expo Updates. Dat is de winst: één pull request, twee bekende pijplijnen, geen handmatige kleurenkopie.

Houd de pakketten privé in de workspace (`"*"` zoals `@bokito/shared`). Publiceer ze niet naar npm. Versiebeheer is de git-commit. Een web-deploy en een Expo Update pinnen dezelfde commit, zodat de telefoon en het dashboard niet een token achterlopen.

### Schaal en beheer

- **Eén visuele bron.** Nieuwe kleur of maat gaat door `packages/ui-tokens`. Nieuwe rij of bubble gaat door `packages/ui`. Reviewers kijken naar dat pakket, niet naar twee schermen die toevallig lijken.
- **Shells blijven dun.** Nieuwe platformdingen (Android-back, iOS-keyboard, web-command palette) komen in de app, niet in de bibliotheek. De bibliotheek groeit met presentatie, niet met navigatie.
- **API blijft de ruggengraat.** Lijstfilters, AI-afhandeling en ticketregels blijven in `apps/api`. De shell vraagt de API en geeft velden door. De bibliotheek kan daardoor in Storybook of een fixture draaien zonder backend.
- **Derde shell later.** Het website-widget en een volgende iOS/Android-variant importeren hetzelfde pakket. Een vierde app hoeft alleen een shell en de slots (`renderHtml`, iconen, navigatie).
- **Grenzen in code.** `packages/ui` heeft een import-check: verboden paden zijn `apps/dashboard`, `apps/mobile`, `react-dom`, `expo-router`. `apps/dashboard` mag `@bokito/ui` alleen importeren vanuit de vier schermen en hun directe kinderen, tot een volgende fase dat verruimt. Zo glijdt het dashboard niet per ongeluk om naar react-native-web.
- **Ontwerpafspraak.** Het dashboard-lint (geen ruwe kleuren, catalogus-primitieven) geldt in `packages/ui`. De mobiele schermen die nog niet verhuisd zijn, importeren tokens wel al vanaf fase 0, zodat het palet niet opnieuw uiteenloopt.

### Risico's die de fasen klein houden

- react-native-web en Tailwind op één pagina: het eiland krijgt een eigen wortel (`View` met `flex: 1`) en neemt geen Tailwind-classes aan. De shell eromheen blijft Tailwind. Meng ze niet in één element.
- Toegankelijkheid van menu's blijft Radix in de web-shell. Gedeelde componenten zijn rijen, bubbles en velden, met `accessibilityLabel` op de primitief.
- Bundelgrootte: meet de dashboard-build na fase 1. Alleen de geïmporteerde schermen horen RN Web in de chunk te trekken.
- Twee iconen-sets tot het contract er is. Geen grote icoonmigratie in fase 0.

## Volgorde in het kort

1. Tokens uit het dashboard halen en het verouderde mobiele palet daarop zetten.
2. `packages/ui` laten bouwen op web (react-native-web) en in Expo.
3. Thread-bubbles en composer.
4. Nieuwe chat.
5. Threadrij en daarna de communicatie-navigatie als data.
6. Agendalijst, inclusief het scherm dat de telefoon nog niet heeft.
7. CI die een UI-wijziging aan de dashboard-build en een Expo Update koppelt.

De shells, de API en de pagina's buiten deze vier schermen blijven waar ze zijn.
