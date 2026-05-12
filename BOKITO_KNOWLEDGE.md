# Bokito Platform – Product Knowledge Base

> **Levend document.** Elke keer dat nieuwe informatie wordt geleerd over hoe het Bokito platform werkt — qua features, workflows, SOPs, configuraties of business rules — wordt dit bestand bijgewerkt.

### Repo-scope (bokitoAiV2)

Deze repository bevat alleen `apps/dashboard` (portal) en `apps/chat-widget`. Deploy naar Xano static hosting gebeurt met rootscript `deploy.ps1`: `npm run build:static` (Vite; zonder `tsc` zolang de repo geen schone typecheck heeft), merge van `apps/chat-widget` naar `dist/chat-widget/`, zip van `dist/`, upload via Metadata API `POST .../static_host/{host}/build`, activatie via `POST .../static_host/{host}/build/{build_id}/env` met JSON `{"env":"dev"|"prod"}` (geen UTF-8 BOM in de body). Omgevingvariabelen: o.a. `XANO_METADATA_API_KEY`, `XANO_META_BASE_URL`, `XANO_DASHBOARD_STATIC_HOST_NAME` (host-slug zoals in de Xano-UI, bijv. `bokitoapp`), en `XANO_WEBSITEWORKSPACE_ID` tenzij de portal-host in een andere workspace staat — dan `XANO_DASHBOARD_WORKSPACE_ID` zetten. Fallback workspace: `XANO_WIDGET_WORKSPACE_ID`. Regels in `.env` overschrijven altijd eerder gezete Process-variabelen zodat een gewijzigde host-naam direct wordt opgepikt. Schakel `-BothEnvs` in om dezelfde build op dev en prod te activeren. Mobiele app, marketingwebsite en overige apps staan niet in deze map.

**Custom domain (Cloudflare) en Xano prod-URL:** Het actieve portal-build op static host `bokitoapp` wordt op Xano uitgeserveerd onder hostnamen als `bokitoapp-prod-{instance}.f2.xano.io` (prod) en `bokitoapp-dev-{instance}.f2.xano.io` (dev). Een oudere hostname `widget-prod-{instance}.f2.xano.io` kan nog steeds het **vorige** portal-artifact (bijv. `Last-Modified` van een eerdere deploy) serveren en komt **byte-voor-byte** overeen met `https://app.bokito.ai` als die custom domain in Cloudflare nog naar `widget-prod-*` wijst i.p.v. naar `bokitoapp-prod-*`. Controle: vergelijk `curl -sI https://app.bokito.ai` met `curl -sI https://bokitoapp-prod-….f2.xano.io` (zelfde `ETag` / `Last-Modified` = zelfde origin). Na DNS/CNAME-correctie eventueel Cloudflare cache purge voor `app.bokito.ai` en `/*`. Snelle UI-check: het productie-JS-bundle (`/assets/index-*.js` vanaf `/login`) bevat `build:` en `APP_VERSION` zodra de nieuwe portal actief is; ontbreken die literal strings, dan draait de browser nog op een oud artifact (vaak verkeerde CNAME/Worker-upstream). API-gestuurde CNAME-wijziging: `scripts/update-cloudflare-app-cname.ps1` met `CLOUDFLARE_API_TOKEN` (Zone.DNS Edit).

**Wildcard DNS voor tenants:** Cloudflare-zone `bokito.ai` heeft een proxied wildcard A-record `* -> 192.0.2.1` (placeholder TEST-NET-1; upstream is irrelevant want de Workers Route `*.bokito.ai/*` op `bokito-tenant-router` onderschept). Zonder dit record geeft een tenant-subdomein als `bokito.bokito.ai` een browser-`DNS_PROBE_FINISHED_NXDOMAIN`, want auth-DNS geeft geen synthetisch antwoord voor onbekende namen; de Worker route activeert pas zodra DNS naar Cloudflare wijst. Verificatie: `curl -sI --resolve bokito.bokito.ai:443:188.114.97.0 https://bokito.bokito.ai/` retourneert HTTP 200 met `X-Tenant-Slug: bokito`.

**Tenant-host API routing in `bokito-tenant-router`:** zelfde model als `bokito-app-passthrough` — `/api/{group}/...` op de tenant-host wordt geproxied naar `BOKITO_API_ORIGIN` (default `https://xrex-nmji-j9ur.f2.xano.io`) als `/api:{group}/...`, alle andere paden naar `BOKITO_STATIC_ORIGIN` met `Host` gepreserveerd. Zonder API-routing antwoordt de static (GCS) op POSTs met XML 400 `InvalidArgument: POST object expects Content-Type multipart/form-data` en blijft `authRefresh` op de tenant-host kapot. Browser-cookies met `Domain=.bokito.ai` (waaronder `bokito_refresh_token`) gaan automatisch mee naar `<slug>.bokito.ai/api/...` en worden door de worker met de overige headers doorgestuurd naar Xano. Source: `cloudflare-workers/bokito-tenant-router/src/index.js`; deploy via `wrangler@3 deploy`.

**Cross-host session-handoff voor productie:** Xano `api:auth` heeft géén `/refresh` endpoint (`isMissingRefreshEndpointError` in `AuthContext` triggert `bokito_skip_server_auth_refresh`). Sessions worden daarom tussen control plane (`app.bokito.ai`) en tenant-hosts (`<slug>.bokito.ai`) overgedragen via een one-time URL-fragment `__bokito_at__=<accessToken>` (zie `appendDevLocalhostCrossHostAccessHash` / `consumeDevLocalhostAccessHashFromLocation` in `lib/host-routing.ts`). De DEV-restrictie is opgeheven: ook in productie wordt de hash toegevoegd zodra source en target binnen dezelfde root-domain (`*.bokito.ai` of `*.localhost`) liggen en de origins verschillen. Tenant-origin leest de hash bij hydrate, schrijft het token in eigen `sessionStorage` en wist het fragment met `history.replaceState`. Aanroepen vanuit de Workspaces-card (`pages/Workspaces.tsx`) en de Login-redirect (`pages/Login.tsx`) gebruiken dezelfde helper.

**Cloudflare Worker route (live):** in zone `bokito.ai` staat een Workers Route `*.bokito.ai/*` gekoppeld aan worker `bokito-tenant-router`. Dit vangt ook `app.bokito.ai`. Als DNS-record `app` al naar `bokitoapp-prod-*` wijst maar `https://app.bokito.ai` nog dezelfde `Last-Modified` / `x-goog-generation` heeft als `widget-prod-*`, dan overschrijft deze worker het DNS-origin nog (hardcoded upstream of verkeerde fetch-URL). **Scheidingstest:** HEAD naar `https://bokitoapp-prod-<instance>.f2.xano.io/` met request header `Host: app.bokito.ai` moet het **nieuwe** artifact tonen (zelfde fingerprints als rechtstreeks `bokitoapp-prod`); wijkt `https://app.bokito.ai` daarvan af, dan is de oorzaak de Worker (of een tweede route), niet de Xano custom-domain mapping. **Oplossingen:** (1) In `bokito-tenant-router` alle `widget-prod-*` upstreams voor het control-plane naar `bokitoapp-prod-*` zetten en deployen. (2) Of een **specifiekere** route `app.bokito.ai/*` met worker `bokito-app-passthrough` (pattern is specifieker dan `*.bokito.ai/*`, dus die wint). In deze repo staat de bedoelde workercode in `cloudflare-workers/bokito-app-passthrough/src/index.js`: proxy naar `BOKITO_STATIC_ORIGIN` (of default `bokitoapp-prod-…`) met `Host` gelijk aan de inkomende hostname (`app.bokito.ai`). **Na het aanmaken van de route:** als `curl -sI https://app.bokito.ai/` `Content-Type: text/plain` geeft en geen `ETag`/`x-goog-generation` van de static host, draait `bokito-app-passthrough` nog de Cloudflare default-template (Hello World, body is o.a. de 12 tekens `Hello World!`); in de browser oogt dat als een bijna lege pagina. Deploy dan de worker uit `cloudflare-workers/bokito-app-passthrough` (Dashboard → Edit code → Deploy, of `scripts/deploy-cloudflare-app-passthrough.ps1` met `CLOUDFLARE_API_TOKEN` in `.env`). Blijft het mis na deploy, gebruik `npx wrangler deploy --var BOKITO_STATIC_ORIGIN:https://bokitoapp-prod-….f2.xano.io` (zie worker-README). Daarna moet HEAD op `/` weer overeenkomen met `bokitoapp-prod-*`.

**Zichtbare build-versie in UI:** Login toont onderaan `build: <versie>` en het user-menu toont onder `Sign out` dezelfde regel. `deploy.ps1` zet tijdens build automatisch `VITE_APP_VERSION` op de huidige buildnaam (bijv. `portal-version-tag-...`) zodat je direct kunt zien welke deploy actief is.

---

## 1. Platform Overzicht

Bokito is een AI-platform waarmee bedrijven (voornamelijk SMBs) AI-agents kunnen inzetten voor dagelijkse operaties. Het platform bestaat uit vier applicaties:

| App | Type | Primaire gebruiker |
|---|---|---|
| **Dashboard (portal)** | React webapp | Admin / operations manager |
| **Mobiele app** | Expo (React Native) | Eindgebruiker / medewerker |
| **Chat widget** | Vanilla JS embed | Websitebezoeker / klant |
| **Website** | Statische marketing site | Potentiële klant |

Op de marketing website (`apps/website`) tonen de hoofdnavigatie (Navbar) tijdelijk geen links naar `/pricing` en `/kennisbank`; die pagina’s blijven bereikbaar via directe URL.

Tech stack: React + TypeScript + Vite + Tailwind (dashboard), Expo + React Native (mobile), Vanilla JS (widget). Backend: Xano (API, database, agents, MCP server).

**Chat-widget lokaal:** In `apps/chat-widget` draai `npm install` en `npm run dev` (Vite op `http://127.0.0.1:8787`, opent de systeembrowser). Widgetcode is lokaal; livechat-requests gaan naar Xano (`api_url` / query op [`chat-standalone.html`](apps/chat-widget/chat-standalone.html)). De ingebouwde **Simple Browser**-tab in Cursor/VS Code toont bij localhost vaak een wit scherm; gebruik Chrome/Edge of het venster dat Vite opent. Zie [`apps/chat-widget/README.md`](apps/chat-widget/README.md).

**Broncode (GitHub):** monorepo onder [github.com/BokitoAI/Bokito-AI](https://github.com/BokitoAI/Bokito-AI) (`origin`).

---

## 2. Dashboard – Pagina's & Features

### 2.1 Login (`/login`)
- E-mail + wachtwoord login via Xano `POST /auth/login`
- Dashboard auth gebruikt een same-origin auth-contract op `/api/auth/*` (`login`, `refresh`, `me`, `logout`) met cookie-gebaseerde sessieflow
- Dashboard auth-client gebruikt een fallbackpad naar directe Xano auth-endpoints (`/api:auth/*`) wanneer de same-origin auth-proxy niet beschikbaar is (bijv. 404/502 of netwerkfout), zodat login niet blokkeert op proxy-availability.
- Refresh token hoort in een `HttpOnly` cookie; access token blijft alleen in runtime memory (niet in `localStorage`)
- Bij laden probeert de portal eerst `POST /api/auth/refresh` en daarna `GET /api/auth/me` om de sessie te herstellen
- `GET /auth/me` levert tenantcontext in een stabiel object: `tenant = { id, slug, name }` en kan optioneel een logo-URL bevatten (bijv. `logo`, `logo_url` of gelijkwaardig op `tenant`, `account` of `organisation`)
- Frontend normaliseert auth-velden naar 1 intern model (`user.tenant`) zodat tenantdata herbruikbaar is in meerdere modules; `user.tenant.logo` is de eerste beschikbare logo-URL uit die objecten, anders `null`
- De tenantkaart linksboven in de dashboard-sidebar gebruikt de ingelogde tenant uit `user.tenant` (logo, naam + slug); zonder logo-URL valt de UI terug op `/bokito-logo.svg`
- `ProtectedRoute` bewaakt alle routes en stuurt ongeauthenticeerde gebruikers naar `/login?return_to=...`; na login gaat de gebruiker terug naar dezelfde interne URL (met open-redirect validatie)
- Cross-host login returns zijn alleen geldig voor bekende control-plane of tenant-hosts; bare `localhost` is geen tenant-host en wordt genegeerd als `return_to` om app.localhost/login-lussen te voorkomen
- **Microsoft browser-login (OAuth) buiten deze repo:** de portal-login in `apps/dashboard` is alleen e-mail/wachtwoord. Zie je een Microsoft-fout `invalid_request` … `redirect_uri` is not valid, dan komt de `redirect_uri` in de authorize-URL **letterlijk** overeen met wat je in Entra onder **Web redirect URIs** zet (geen varianten). Voorbeeld: staat alleen `https://api.bokito.ai/api/auth/callback/microsoft` geregistreerd, maar de client stuurt `.../callback/azure-ad`, dan faalt de flow; voeg die tweede URI toe **of** pas de client aan naar de geregistreerde URI. Dit staat los van mailbox/Graph-OAuth op Xano (`MICROSOFT_REDIRECT_URI` → `api:integrations` OAuth-callback); elke app registration heeft een eigen client-id en redirect-lijst.

---

### 2.2 Dashboard Home (`/`)
- Welkomstbericht voor de ingelogde gebruiker
- **4 KPI-kaarten**: Gesprekken, Actieve gebruikers, Gem. responstijd, Tokens gebruikt (elk met trend %)
- **ActivityFeed**: scrollbare lijst van recente platform-events (agent tool calls, nieuwe gesprekken, gebruikersacties, systeemmeldingen) met avatar, actie, doel en relatieve timestamp
- **QuickActions**: 4 snelkoppelingen — Nieuw gesprek, Agent beheren, Analytics bekijken, Organisatie instellen

---

### 2.3 Cloud Agents (`/cloud-agent`)
Beheer van Xano-hosted agents die op de achtergrond draaien.

- **Toggle-view**: kaartweergave of lijstweergave
- **AgentCard / AgentRow**: naam, model, status (actief/gepauzeerd/deploying), regio, laatste deploy, 24h request count, P50 latency, tools, systeemprompt preview
- **AgentDetailModal**: volledig detail modal — alle metrics, embed URL, tools, volledige systeemprompt
- **"Nieuwe cloud agent" knop** (in ontwikkeling)

Bekende mock agents: Bokito Support (claude-sonnet-4), Sales Assistant (claude-sonnet-4), Internal Ops (claude-3-5-haiku), Website v3 Draft (claude-opus-4)

---

### 2.4 Agent Canvas (`/agent-canvas`)
Visuele workflow builder voor het ontwerpen van agent-pipelines.

- **Toolbar**: node-types toevoegen (Agent, Schedule, Webhook, Kennisbank, Workflow), zoom in/uit, reset
- **Canvas**: token-gedreven dot-grid achtergrond die meeschakelt met dark/light mode, pan (drag) en zoom (scroll, 0.3x–2.5x), nodes zijn versleepbaar
- **Node types**: `agent`, `cron`, `webhook`, `knowledge`, `repo`, `slack`, `crm`, `email` — elk met icoon, accentkleur en statusdot
- **Edges**: SVG bezier-verbindingen met subtielere dash-flow en lagere glow/contrast voor een rustiger beeld; kleurgecodeerd per verbindingstype
- **Node hover tooltip**: compactere, token-gedreven tooltip + actieknoppen (Run, Config, Logs) voor betere leesbaarheid in light en dark
- **EventLog** (rechts, 224px): live events feed met token-gedreven achtergronden en tekstkleuren (geen hardcoded dark-only kleuren)
- **ScheduleTimeline** (onderbalk): 24-uurs tijdlijn met geplande agent-runs als gekleurde dots, "NU"-indicator en theme-aware styling

---

### 2.5 Webchat Configuratie (`/webchat`)
Volledig configureerbare chat widget, live preview inbegrepen.

**Configuratiepanelen (links):**
- **Uiterlijk**: botnaam, tagline, avatar (initialen + kleurpicker), accent/bubbel/achtergrondkleur, font, widgetbreedte (300-480px slider)
- **Begroeting**: welkomstbericht, inputplaceholder, typing-indicator toggle, geschiedenis-toggle, startvragen (max 5, toevoegen/verwijderen)
- **Launcher**: positie (bottom-right/left met visuele preview), label-toggle, auto-open toggle, labeltekst
- **Systeem**: model selector (gpt-4o, gpt-4o-mini, gpt-4-turbo, claude-3-5-sonnet, claude-3-haiku), temperatuur slider (0-1, labels: Precies tot Creatief), taal (NL/EN/Auto), systeemprompt textarea
- **Embed code**: script-tag + iFrame snippet, beide met kopieerknop. Attributen: `data-agent-slug`, `data-bot-name`, `data-primary-color`, `data-position`

**Live preview (rechts):** Volledig interactief widget-preview dat real-time meebeweegt met alle instellingen.

---

### 2.5.1 Instellingen (`/settings`)
- Hoofdingang via **Instellingen** onderaan de zijbalk; bevat de voormalige zijbalkgroepen **Integraties** en **Mijn organisatie** als subnavigatie links op de pagina.
- `/settings` redirect naar `/settings/integrations`.
- Subnav-blokken: **Integraties** (Verbonden tools → marketplace; API-sleutels en Webhooks nog disabled) en **Mijn organisatie** (Configuratie → bedrijfsinstellingen; Team management en Kennisbank nog disabled).
- Oude URLs `/integrations` en `/company-config` redirecten naar de nieuwe paden.

---

### 2.6 Integraties – Marketplace (`/settings/integrations`)
Marketplace voor externe koppelingen.

- **Zoekbalk** (live filter)
- **Statustabs**: Alle / Verbonden / Beschikbaar
- **Categoriefilter** (linkerzijbalk met aantallen)
- **Integration card**: gekleurd logo-tegel, naam, categorie, beschrijving, statusbadge (Verbonden / Binnenkort), verbonden-datum, verbinden/verbreken-knop
- "Populair"-badge op populaire niet-verbonden integraties

---

### 2.7 Databronnen (`/datasources`)
De Databronnen-pagina is docs-first en focust op documentatiebronnen voor agents.

**Bovenste sectie: Documentatiebronnen beheren**
- URL-input + knop **"URL toevoegen"** voor nieuwe docsources (momenteel UI-only; scraper-koppeling volgt)
- Helpertekst maakt expliciet dat ingest/scraping later backend-functionaliteit krijgt
- Vernieuwen-knop haalt tenant-scoped docs opnieuw op

**Onderste sectie: horizontale docs-cards**
- Cards tonen: boek-icoon, docnaam, bron-URL, last synced datum/tijd
- Per card wordt zichtbaar gemaakt hoeveel pagina's en secties er onder die bron vallen
- Groene knop **"Active for agents"** is visueel aanwezig maar heeft nog geen mutatiefunctionaliteit

**Tenant-scoped dataflow**
- Frontend haalt docs op via auth API-contract `GET /docs` (zelfde auth base als dashboard)
- Tenantcontext wordt door backend/JWT bepaald en centraal opgehaald via `GET /auth/me`
- Datasources gebruikt `user.tenant` uit `AuthContext` als single source of truth voor tenant labels en fallbacklogica
- De paginatitel toont `AI Bronnen van {tenantnaam}` met `user.tenant.name` (of slug/`je organisatie` als fallback); links staat het tenantlogo (`user.tenant.logo`) met fallback naar `/bokito-logo.svg`
- Empty/error/loading states zijn aanwezig op de pagina

**Fallbackbeleid**
- De datasources pagina gebruikt geen lokale tenant-fallback voor docsweergave; de UI toont uitsluitend resultaten uit de tenant-scoped API.

**Definitieve docs API (tenant-isolatie + RBAC)**
- De Authentication API group bevat tenant-scoped docs endpoints met `auth = "user"`:
  - `GET /docs`
  - `GET /docs/{doc_id}`
  - `POST /docs`
  - `PATCH /docs/{doc_id}`
  - `DELETE /docs/{doc_id}` (soft delete via `status = archived`)
  - `GET /docs/{doc_id}/pages`
  - `GET /docs/{doc_id}/sections`
- Tenant filtering gebeurt in backend op basis van ingelogde user (`user.account_id`) + account→organisation mapping
- Write-endpoints zijn RBAC-gated: alleen `admin` mag create/update/archive, read blijft voor geauthenticeerde users binnen dezelfde tenant
- Frontend gebruikt geen lokale docs-fallback meer voor weergave van tenantdocs

**Seeddata tenant `bourgondienadvies` (organisatie Bourgondiënadvies)**
- Vier doc-bronnen in `doc` met pages/sections in `doc_page`, `doc_section`: [RJNet](https://www.rjnet.nl/), [NBA HRA](https://www.nba.nl/wet--en-regelgeving/hra/), [Belastingdienst](https://www.belastingdienst.nl/), [Bourgondiënadvies diensten](https://bourgondienadvies.nl/diensten/)
- `doc_section.embedding` blijft null voor seed records (klaar voor latere embedding-pipeline)

---

### 2.8 Communicatie (`/communication`)
Slack-achtige teaminterne chat.

- **ChannelSidebar** (links): Favorieten, Kanalen (Inbox/Klantvragen/Jaarrekening/Loonadministratie), Direct berichten met klantnamen, ongelezen-badges, zoekknop
- **ChannelSidebar** (links): mailbox-achtige secties **Mappen**, **Labels** en **Klanten** met bijpassende iconen en mailbox-zoekveld
- **MessageArea** (midden): mailbox-achtige 2-koloms opzet met links een inbox-lijst (afzender, onderwerp, preview, unread-dot, labels) en rechts een geselecteerde mail-preview met body en quick actions (reply/reply-all/archive)
- Mail-preview ondersteunt een inline **AI suggesties**-blok boven de mailinhoud met hiërarchische tekstwolkjes (`info`, `proposal`, `task`)
- Suggestiewolkjes kunnen optionele metadata tonen (bijv. boekingsreferentie of taakcontext) en in de `proposal`-variant actieknoppen tonen zoals **Genereren** en **Reageren** (UI-only)
- Voor spoedmails ondersteunt de `task`-variant een visuele prioriteitsindicatie in dezelfde previewkolom
- Middenheader bevat mailbox-filters (**Alle**, **Ongelezen**, **Urgent**) voor snelle triage
- **InfoPanel** (rechts): tabloos overzicht gekoppeld aan het geselecteerde bericht met drie vaste blokken: **Contact info afzender**, **Notities** en **Eerdere berichten** van dezelfde afzender

**Email sample datamodel in frontend (`Message`):**
- Ondersteunt extra velden voor mailboxweergave: `subject`, `preview`, `body`, `fromEmail`, `accountName`, `labels[]`, `unread`
- Ondersteunt optioneel `aiSuggestions[]` met `level`, `text`, `meta` en optionele `actions[]` voor contextuele AI-voorstellen per mail
- Bestaande `content` blijft beschikbaar als fallback

---

### 2.9 Organisatieconfiguratie (`/settings/company-config`)
Scrollbaar instellingenformulier met sticky opslaan-balk.

**Secties:**
1. **Bedrijfscontext**: Naam, sector, website, beschrijving, doelgroep, tone of voice (6 opties), merkwaarden (tag-input), extra agent-instructies
2. **Huisstijl & Branding**:
   - Logo upload (drag & drop, SVG/PNG/WebP)
   - Primaire kleur + achtergrondkleur pickers (live hex)
   - Font selectors (display + body, 9 opties elk) met live preview
   - **StyleScanner**: URL invullen → scan detecteert kleuren en fonts van de website → "Huisstijl overnemen"
3. **Contactinformatie**: Telefoon, support e-mail, openingstijden
4. **Agent persona**: Agentnaam, begroetingsbericht, persoonlijkheidsbeschrijving

---

### 2.10 Sidebar Navigatiestructuur
De portal gebruikt een Featurebase-achtige 2-laagse shell:

- **Primary rail (icon-only, links):**
  - Support (`/support/inbox/all`)
  - Users (`/users/attributes`)
  - Settings (`/settings/profile`)
- **Context sidebar (tekstnavigatie per sectie):**
  - Support: inbox-queues + support setup
  - Users: customer data-sectie (attributes/tags/segments/lead qualification/blocked)
  - Settings: Featurebase-achtige groepen `Personal`, `Products`, `Workspace`, `Data`

In de nieuwe shell zijn dode navigatie-items verwijderd (geen disabled/soon buttons in actieve navigatie).
Support- en settingsroutes zijn gekoppeld aan werkende Bokito-modules (zoals `Communication`, `EmailSettings`, `InboxSettings` en `DatabasePage`) in plaats van blueprint-only pagina's.
- In settings heet **Helpcentra** nu **Kennisbank** en staat deze weer op `binnenkort` (gedimd en niet direct klikbaar).
- **Inbox** en **E-mailinstellingen** zijn functioneel samengevoegd op dezelfde instellingenroute (`/settings/inbox`); legacy e-mailroutes redirecten naar deze gecombineerde pagina.
- In de settings-subnavigatie staat hiervoor nog maar één product-item: **Inbox**; een losse menu-entry voor **E-mailinstellingen** is verwijderd.
- De gecombineerde inbox-instellingen tonen mailboxen in een tabel met provider-logo’s en een lege tabelstatus: **“Nog geen inbox gekoppeld”** wanneer er geen verbindingen zijn.
- De primaire rail verbergt de top-level **Gebruikers** tab tijdelijk; gebruikersbeheer blijft benaderbaar via de data- en settingsnavigatie.
- **Databronnen** is verplaatst van de Data-zijbalk naar de AI-zijbalk en valt in de shell-context onder AI.

---

### 2.11 Dashboard Thema (portal)
- De portal ondersteunt zowel **dark mode** als **light mode**
- De gebruiker wisselt handmatig via een toggle in de topheader
- De gekozen mode wordt bewaard in `localStorage` als `bokito-portal-theme`
- Het thema wordt toegepast via CSS-variabelen (`data-theme` op `document.documentElement`), zodat Tailwind-kleurtokens in beide modi consistent blijven

---

### 2.12 Dashboard Design System (Featurebase-achtige fase)
- De dashboard UI gebruikt een Featurebase-achtige dark-first shell met compacte panelen, zachte borders en dense informatieblokken.
- De huidige make-overfase focust op **Support**, **Users** en **Settings** met werkende routes en zonder mock-cijferdashboards in de hoofdnavigatie.
- De profielpagina onder settings volgt nu een Featurebase-achtige opbouw met secties `Personal information`, `Theme`, `Security` en `Account`.
- Legacy-routes blijven bereikbaar via redirects naar de nieuwe informatiearchitectuur zodat de shell consistent blijft.
- De shell gebruikt nu een zachtere materialistische token-set (lagere contrastovergangen tussen app background, sidebar en surfaces) zodat dark en light mode dichter op de Featurebase visuele hiërarchie zitten.
- De rail toont opnieuw het Bokito-logo (`/bokito-logo.svg`) met theme-aware rendering: visueel wit in dark mode en neutraal grijs in light mode.
- De settings-shell is verder genormaliseerd op compactere maatvoering (smaller topbar, smallere context-sidebar, kleinere control-typografie) voor consistente sectiegroottes.
- `/settings/members` bevat nu een functionele `Members and teams` pagina: members- en invite-overzicht (workspace-scoped via `/workspaces`, `/workspaces/{id}/members`, `/workspaces/{id}/invites`) plus invite-actie via `POST /workspace-invites`.
- Teams op dezelfde pagina zijn workspace-scoped client-state en worden per workspace/tenant lokaal opgeslagen onder key `bokito_members_teams_{workspaceId|tenantSlug}`.
- Shell-indelingsregel: de portal gebruikt geen hard gescheiden topbar/rail-vakken; rail- en contextnavigatie renderen als zwevende panel-items zonder interne scheidingslijnen, en de page-content staat in één afgerond hoofdvlak (Featurebase-achtig).
- Layout-update op user feedback: de linker icon-rail heeft geen eigen paneelvlak meer; alleen rechts staat één gecombineerd shell-vlak met contextmenu (tussenmenu), header en inhoud.
- Header-update op user feedback: niet-werkende headeracties (theme-toggle en notificatieknop) zijn verwijderd; de header bevat nu alleen titel + zoekveld.
- Rail-update op user feedback: `Settings` staat onderaan in het menu direct boven de user-entry; user-initi alen krijgen een vaste achtergrondkleur wanneer er geen profielfoto is.
- User-menu update op user feedback: de linksonder user-entry gebruikt geen hover-uitlogactie meer maar een click-dropdown met Featurebase-achtige opties (`My Profile`, `Notification preferences`, `Light/Dark mode`, `My Organizations`, `Sign out`).
- Light-mode style-richtlijn: menu-items, cards en inputs gebruiken extra subtiele elevatie (inner + outer shadow), duidelijke maar zachte borders en rijkere active/hover states om een materialistischere Featurebase-feel te geven zonder harde contrasten.
- Navigatie-richtlijn op user feedback: context-menu-items tonen iconen zoals Featurebase; `My inbox` toont een persoonlijke avatar-indicator met initials als fallback.
- Header-richtlijn op user feedback: zoekbalk rechtsboven staat alleen op settings-routes en gebruikt een hogere control-height; shelltitels zijn compacter gemaakt.
- Settings IA update: `Custom Domain` en `Multilingual` zijn verwijderd uit de actieve settings-navigatie en hebben geen route meer in de portal.
- Settings IA update: `Emails` is verwijderd uit de actieve settings-navigatie en heeft geen eigen `/settings/email(s)` route meer; email-configuratie loopt via support (`/support/settings/general`).
- Tooltip-richtlijn op user feedback: rail-tooltips gebruiken geen native browser `title` meer maar een custom Featurebase-achtige tooltipstijl (donkere elevated bubble met zachte border en shadow).
- Email settings UX-richtlijn: `EmailSettings` is nu Featurebase-achtig ingedeeld met tabs `Sending`, `Ignored addresses`, `Branding` en `Signatures`; de bestaande OAuth/SMTP-koppelflow blijft onder `Sending`, terwijl `Branding` en `Signatures` als werkende UX-drafts zijn opgezet.
- Notifications UX-richtlijn: `/settings/notifications` heeft nu een Featurebase-achtige matrix met per notificatietype drie kanalen (`Desktop`, `Email`, `Mobile`) via toggles; huidige opslag is lokale UX-draft in `localStorage` (`bokito_notification_settings_v1`).
- Settings IA update: in `Products` zijn `Feedback & Roadmaps` en `Changelog` verwijderd; `Support` is vervangen door `Inbox` en aangevuld met `Email settings` en `Messenger`.
- Settings IA update: `Developers`, `MCP` en `Integrations` zijn voor nu verwijderd uit de actieve settings-navigatie en bijbehorende settings-routes.
- Messenger UX-richtlijn: er is een nieuwe `Messenger` settingspagina (`/settings/messenger` en support alias `/support/customization`) met een eenvoudige Featurebase-achtige opzet (customizationblokken + live previewkolom).
- Workspace context is als globale provider opgenomen in de dashboard root (`WorkspaceProvider` binnen `AuthProvider`) zodat shell en pagina’s dezelfde actieve workspace gebruiken.
- Workspace-selectie bewaart de laatst gekozen workspace in `localStorage` onder `bokito_current_workspace`; initialisatie kiest prioriteit: auth-tenant-id (indien match), daarna opgeslagen workspace-id, daarna de eerste beschikbare workspace.
- De user dropdown in de rail bevat een ingebouwde workspace-switcher met de lijst uit `/workspaces` en markering van de huidige workspace.
- `Members and teams` gebruikt nu de globale `currentWorkspace` uit `WorkspaceContext` in plaats van een lokale “eerste workspace” selectie; members/invites volgen daardoor direct de actieve workspace.
- Er is een dedicated pagina `/workspaces` toegevoegd als centrale start- en beheerpagina voor workspaces (lijst + eenvoudige create-flow).
- De rootroute `/` stuurt gebruikers zonder workspaces automatisch naar `/workspaces`; gebruikers met workspaces landen op `/support/inbox/all`.
- De user dropdown is vereenvoudigd: één duidelijke `Workspaces` navigatie-entry plus een compact blok met `Huidige workspace` en (alleen bij meerdere) `Wissel naar` om dubbeling met `Mijn organisaties` te vermijden.
- Workspace onboarding-flow is nu gesplitst in twee shells: een aparte `WorkspaceHubLayout` (bovenliggende omgeving) voor `/workspaces*` en de bestaande product-shell (`Layout`) voor support/settings/database/workforce.
- De workspace-hub gebruikt een eigen linker navigatie met vier items: `Workspaces`, `Billing`, `Account`, `Support`; `Referrals` is geen onderdeel van deze navigatie.
- De workspace-overview (`/workspaces`) toont Featurebase-achtige workspace cards plus een aparte create-card met plus-actie, en een hulpsectie met resources onder/naast de cards.
- Workspace-cards in `/workspaces` tonen naast slug ook de volledige tenant-URL (`https://<slug>.<domein>`) zodat gebruikers direct zien op welk subdomein de tenant draait.
- Klikken op een workspace-card forceert host-based tenant-openen via subdomein-origin i.p.v. interne route-navigatie; lokaal gebruikt de app `http://<slug>.localhost:<port>/...` zodat tenant-routing ook in dev expliciet via subdomein verloopt.
- Workspace-hub routes (`/workspaces*`) zijn control-plane only: op een tenanthost (`<slug>.bokito.ai` of `<slug>.localhost`) wordt altijd direct cross-host doorgestuurd naar de app-host (`app.bokito.ai` of `app.localhost`).
- De control-plane startpagina is `/` (workspace hub); `/workspaces` is alleen nog een backward-compatible redirect naar `/`.
- Workspace-hub secundaire routes zijn top-level: `/billing`, `/support`, `/account`; legacy paden `/workspaces/billing`, `/workspaces/support`, `/workspaces/account` redirecten naar deze korte routes.
- Workspace zonder subdomein kan niet worden geopend vanuit `/workspaces`; de kaart toont een verplichte subdomeinmelding en leidt door naar `/settings/branding` om het subdomein eerst in te stellen.
- Workspace-creatie in `/workspaces` vereist nu expliciet een subdomeinveld in de create-dialog; zonder geldig subdomein (3-63 chars, `a-z0-9-`) blijft aanmaken geblokkeerd.
- `organisation.livechat_settings.subdomain` is een expliciete schema-child (text, lowercase/trim) en wordt gebruikt als bron voor tenant host-routing in de dashboard-workspaceflow.
- Bestaande organisations in workspace `1` zijn gebackfilled met unieke subdomeinen: `bokito`, `chargecars`, `bakermat-design`, `bourgondienadvies`, `demo-organisation`.
- Multi-tenant autorisatie gebruikt nu een expliciete junction-tabel `tenant_membership` (`user_id`, `tenant_id`, `role`, `status`) i.p.v. een impliciete single-tenant koppeling via alleen `user.organisation_id`.
- `GET /api:auth/me` en legacy `GET /api:DavdZOps/auth/me` retourneren `memberships[]` en `current_tenant`, plus optionele input `tenant_subdomain` om tenant-context expliciet te selecteren. De stack loopt actieve `tenant_membership`-rijen en doet per rij een `organisation` lookup voor subdomein en naam; een `db.query` met join plus multiline `|map:`/backtick-filters veroorzaakte eerder een Xano runtime `fatal` (HTTP 500) en brak daarmee login/hydratie.
- Login- en auth-exchange endpoints zetten nu `bokito_refresh_token` cookies met wildcard domein voor zowel productie (`.bokito.ai`) als lokale ontwikkeling (`.localhost`) zodat sessies over subdomeinen herbruikbaar zijn.
- Redirectcontract blijft `return_to`; targets naar `/login` of `/auth/handoff` worden genegeerd en vallen terug op een veilige startroute om auth-loops te voorkomen.
- Workspace openen vanuit `/workspaces` gaat direct naar de tenant URL (`/support/inbox/all`) zonder frontend handoff-route.
- Frontend gebruikt `app.localhost` als lokale control-plane host en `*.localhost` als tenanthosts via env-config (`VITE_APP_CONTROL_PLANE_HOST_DEV`, `VITE_TENANT_ROOT_DOMAIN_DEV`, `VITE_APP_CONTROL_PLANE_URL`).
- Lokaal is `sessionStorage` niet gedeeld tussen `app.localhost` en `tenant.localhost` (andere origins); een refresh-cookie op `http` + `.localhost` is vaak onbetrouwbaar. In **Vite dev** alleen: na login op de app-host wordt bij cross-host `return_to` een eenmalige URL-hash `__bokito_at__=` meegegeven; de tenant-host leest die bij hydrate, zet het access token in eigen `sessionStorage` en wist de hash met `replaceState` (fragment gaat niet naar de server).

#### Tenant-auth runbook

- `Geen tenanttoegang`: gebruiker is geauthenticeerd maar heeft geen actieve `tenant_membership` voor het subdomein; UI toont expliciet toegang geweigerd i.p.v. login-redirect.
- `Nog steeds loginprompt op tenant`: verifieer dat `GET /auth/me` een membership met matching `tenant_slug` teruggeeft en dat de subdomeincookie (`bokito_refresh_token`) wordt meegestuurd.
- `Lege workspace op tenant-host`: controleer `tenant_membership.status = active` en dat `organisation.livechat_settings.subdomain` exact overeenkomt met de host.
- De hubnavigatie toont accountinformatie van de ingelogde gebruiker linksonder (naam + e-mail + initials) met een directe link naar de `Account` hubpagina, vergelijkbaar met Xano-achtige placement.
- De `Account` hubpagina bevat nu werkende basisinstellingen (profieloverzicht, snelle thema-toggle en uitloggen) in plaats van een placeholder.
- Workspace hub gedrag bij lege `/workspaces` response: frontend probeert een fallback-workspace op basis van `auth/me` tenantdata (`user.tenant`) zodat users met bestaande tenantcontext niet op een lege lijst stranden.
- Workspace overzicht is nu visueel gecentreerd (verticaal + horizontaal) als startpunt, met hulpitems onder de cards i.p.v. rechts ernaast.
- Workspace aanmaken in hub verloopt nu via een volledig klikbare create-card die een popup opent voor naaminvoer; na aanmaken opent de flow direct de setuproute binnen de workspace (`/settings/general`).
- Workspace-id verwerking in frontend accepteert nu zowel numerieke als string/UUID ids voor `/workspaces` responses; matching en localStorage-resolutie gebruiken string-key vergelijking om lege lijsten door type-mismatch te voorkomen.
- Meertaligheid: de dashboardshell ondersteunt nu runtime taalwisseling met `i18next` (`en`/`nl`) inclusief persistente taalkeuze via `localStorage` key `bokito-language`.
- De navigatiestructuur (rail, context-sidebar, header fallbacktitels en support/settings metadata) is vertaald via locale namespaces onder `apps/dashboard/src/locales/{en,nl}/nav.json`.
- De route `/settings/general` gebruikt de `WorkspaceSettings` pagina als algemene instellingenpagina en bevat de actieve taalwisselaar (`Nederlands`/`English`) die direct `i18n.changeLanguage(...)` aanroept.

---

### 2.13 Email-instellingen (`/settings/communication-email`)
- Instellingen bevat een aparte sectie **Communicatie** met submenu-item **Email**
- De pagina gebruikt een lijstgerichte layout; in de header staan **Outlook koppelen** (OAuth) en **SMTP / IMAP toevoegen** (modal)
- **Outlook (productie)**: delegated OAuth via Microsoft Identity Platform en Microsoft Graph. Tokens en sync lopen per **Bokito-account** (`account`-rij); de ingelogde portalgebruiker start de OAuth-flow. De pagina toont de tenantnaam uit `auth/me` bij de koppeling
- Na succesvolle OAuth redirect terug naar deze route met query `?outlook=connected`; fouten komen binnen als `?outlook_error=...`; bekende foutcodes waaronder **`token_exchange`** (token-POST naar Microsoft mislukt: vaak redirect-URI-afwijking, onjuist secret, verlopen of hergebruikte code); optioneel `aad_detail=` (URL-encoded tekst van Microsoft/AAD voor support). De dashboard-OAuth-flow stuurt `return_url` mee naar de pagina waar de gebruiker de koppeling startte (pathname + origin). Bij start kan `prompt=consent` op de authorize-URL worden meegegeven om een refresh token te stimuleren.
- **SMTP / IMAP**: alleen **concept** in de browser (geen Xano-opslag); duidelijke copy op de pagina. Geen Gmail-OAuth in deze release

#### Xano API-groep `Authentication` (`api:DavdZOps`)
- `GET /email/oauth/start` — auth **user**; generieke OAuth start voor `provider=outlook|gmail`, slaat state op en retourneert `{ authorize_url }`.
- `GET /email/outlook/oauth/start` — auth **user**; legt een rij in `outlook_oauth_state` aan en retourneert `{ authorize_url }` voor redirect naar Microsoft. In de stack wordt `auth.id` eerst gecast met `to_int` voor `db.get user` op numerieke `id`, en `expires_at` gezet met `now|add_secs_to_timestamp:900` (15 minuten). Gebruik niet `timestamp_add_days` voor dit doel: die filter ontbreekt op veel Xano-instances en geeft `Unable to locate func entry: timestamp_add_days`. **Als `MICROSOFT_CLIENT_ID` of `MICROSOFT_REDIRECT_URI` in Xano env leeg zijn**, bevat de gegenereerde Microsoft-URL lege queryparams (`client_id=&redirect_uri=`); de endpoint valideert dit met een `precondition` en geeft een duidelijke `inputerror` i.p.v. door te redirecten.
- `GET /email/outlook/oauth/start` — auth **user**; legt een rij in `outlook_oauth_state` aan en retourneert `{ authorize_url }` voor redirect naar Microsoft. In de stack wordt `auth.id` eerst gecast met `to_int` voor `db.get user` op numerieke `id`, en `expires_at` gezet met `now|add_secs_to_timestamp:900` (15 minuten). Gebruik niet `timestamp_add_days` voor dit doel: die filter ontbreekt op veel Xano-instances en geeft `Unable to locate func entry: timestamp_add_days`. **Als `MICROSOFT_CLIENT_ID` of `MICROSOFT_REDIRECT_URI` in Xano env leeg zijn**, bevat de gegenereerde Microsoft-URL lege queryparams (`client_id=&redirect_uri=`); de endpoint valideert dit met een `precondition` en geeft een duidelijke `inputerror` i.p.v. door te redirecten. De endpoint accepteert nu optioneel `return_url` en slaat die per state op (`outlook_oauth_state.return_url`); als `return_url` ontbreekt, gebruikt hij `dashboard_outlook_return_url` (met fallback naar `https://app.bokito.ai/settings/support/general`).
- `GET /email/outlook/oauth/callback` — **publiek** (geen Bearer); wisselt `code` om, haalt Graph `/me` op, schrijft of werkt `email_oauth_connection` bij voor `organisation_id` uit de state, en antwoordt met **HTML** meta-refresh naar `dashboard_outlook_return_url` met `?outlook=connected` of `?outlook_error=...` (fallback: `https://app.bokito.ai/settings/support/general` als env leeg is). Vóór de token-call: controle dat `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` en `MICROSOFT_REDIRECT_URI` (Xano env) niet leeg zijn; anders redirect `?outlook_error=missing_oauth_env`. Token-POST naar Microsoft gebruikt `api.request` met `Content-Type: application/x-www-form-urlencoded` en `params` als key-value (`client_id`, `client_secret`, `grant_type`, `code`, `redirect_uri`), waarden via `to_text`. Lege `MICROSOFT_CLIENT_ID` geeft bij Microsoft vaak **AADSTS900144** (*The request body must contain the following parameter: 'client_id'*). Incident 2026-05-08: de callback kon crashen met `ERROR_CODE_INPUT_ERROR` (*1st operand must be one of these types...*) door een type-onveilige state-lookup (`nonce|to_text == state`) in de `db.query` where; fix is directe vergelijking op de uuid-kolom (`nonce == state`) plus timestamp-veilige `now`-afhandeling, waardoor de flow nu weer HTML-redirects teruggeeft (`invalid_state`, `expired_state`, `no_refresh_token`) in plaats van een 400 JSON crash. De callback gebruikte tijdelijk tenant-subdomain afleiding (`https://<subdomain>.bokito.ai/...`), wat in sommige tenants NXDOMAIN kon geven (bijv. `bokito.bokito.ai`); dit is vervangen door de env-gedreven return URL.
- `GET /email/google/oauth/start` — auth **user**; Gmail OAuth start met `access_type=offline`, `prompt=consent`, state-opslag en optionele `return_url` (zelfde state-tabel als Outlook). De state-rij krijgt `feature = "gmail-email"` voor centrale callback-routing.
- `GET /email/google/oauth/callback` — **publiek**; wisselt autorisatiecode om via `https://oauth2.googleapis.com/token`, leest profiel via `https://www.googleapis.com/oauth2/v3/userinfo`, upsert `email_oauth_connection` met `provider=gmail`, en redirect terug met `oauth_provider=gmail` + `oauth_status` of `oauth_error` + `oauth_detail`.
- `GET /oauth/google/callback` — **publiek**; centrale Google callback-route (Pattern 2). Leest state uit `email_outlook_oauth_state`, inclusief `feature`, en handelt nu Gmail af via dezelfde token/profile flow als de eerdere email-specifieke callback.
- `GET /oauth/microsoft/callback` — **publiek**; centrale Microsoft callback-route (Pattern 2). Leest state uit `email_outlook_oauth_state`, inclusief `feature`, en handelt Outlook email af via dezelfde token/Graph flow als de eerdere email-specifieke callback.
- `GET /email/connections` — auth **user**; lijst koppelingen voor het account van de gebruiker (zonder `refresh_token`). In de function stack: `db.query` met `return = { type: "list" }` **zonder** paging levert de rijen als **array op de variabele zelf**; map die met `array.map ($raw_conn)`, niet `$raw_conn.items` (die sleutel bestaat pas bij paging). Rijen worden gemapt naar veilige velden met `connection_pk` i.p.v. `id` in de output.
- `DELETE /email/connections/{connection_id}` — auth **user**; verwijdert gekoppelde `email_synced_message`-rijen en de OAuth-rij na tenant-check

#### Xano tabellen (workspace Bokito AI app)
- `email_oauth_connection` — per account: Microsoft user id, mailbox, encrypted refresh token veld (text sensitive), `delta_link`, `last_sync_at`, `status` (`active` / `error` / `revoked`)
- `email_outlook_oauth_state` — korte OAuth state (`nonce`, `organisation_id`, `user_id`, `expires_at`, `return_url`, `feature`); `feature` ondersteunt centrale provider-callbacks voor meerdere Google/Microsoft integraties (zoals email, Drive, Calendar) zonder aparte provider redirect URI per feature.
- `email_synced_message` — opgeslagen inbox-berichten per `connection_id` (Graph id, subject, from, preview, optioneel `graph_payload`)

#### Xano scheduled task
- `email/outlook_sync_inboxes` — elke **900** seconden (15 min): Outlook-rijden met `status` actief en `is_enabled` leeg of `true`; refresh token; Graph **delta** op inbox, paginering tot `deltaLink`, upserts in `email_synced_message`; werkt `delta_link` en `last_sync_at` bij; bij fout zet `status` op `error` en vult `last_error`

#### Omgeving / Azure (handmatige setup)
- In **Microsoft Entra ID**: app registration (vaak multi-tenant), delegated permissions: `offline_access`, OpenID profiel, `User.Read`, `Mail.Read`, `Mail.Send`; **Web** redirect URI exact gelijk aan Xano env `MICROSOFT_REDIRECT_URI`. Dat kan de centrale route zijn (`GET /oauth/microsoft/callback` op `api:integrations`) of, als de stack die URL zo opbouwt, de app-groep callback `GET /email/outlook/oauth/callback` op `api:app` (bijv. canonical `https://api.bokito.ai/api:app/email/outlook/oauth/callback`). Verifieer altijd de authorize-URL die de browser krijgt; die `redirect_uri` moet letterlijk in Entra staan op **dezelfde** app registration als `MICROSOFT_CLIENT_ID`.
- Pattern 2 (centrale provider callback): registreer in Google Cloud / Entra exact dezelfde redirect als in Xano env: `GOOGLE_REDIRECT_URI` voor `GET /oauth/google/callback` en `MICROSOFT_REDIRECT_URI` voor `GET /oauth/microsoft/callback` wanneer die centrale route wordt gebruikt (zelfde host + pad als in env). Als productie in plaats daarvan `api:app` + `/email/outlook/oauth/callback` gebruikt, hoort die URI in Entra — niet alleen de portal Azure AD login-URI (`/api/auth/callback/azure-ad`).
- **Supported account types** (App registration → **Authentication** of **Overview**): als gebruikers **persoonlijke Microsoft-accounts** (@outlook.com, @live.com, @hotmail.com) moeten kunnen inloggen, kies een optie die **personal Microsoft accounts** expliciet toestaat (bijv. multitenant + personal). Alleen *Accounts in this organizational directory only* of alleen werk/school zonder consumers geeft na inloggen met een consumer-account de fout **`unauthorized_client` — *The client does not exist or is not enabled for consumers*** (vaak zichtbaar op `login.live.com`). Zakelijke mailboxen: gebruikers inloggen met **werk- of schoolaccount** van de tenant waar de app voor is ingericht.
- Xano **environment variables** (Outlook / Microsoft): `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` (zelfde waarden als in Azure Entra app registration; redirect URI = exacte Xano callback-URL). Daarnaast `dashboard_outlook_return_url` (volledige URL naar de dashboardpagina na OAuth, bv. `http://localhost:5174/settings/email` voor Vite-dev of productie-URL). **Dashboard** roept `GET /email/oauth/start` en gerelateerde routes via **`api:integrations`** aan; als `MICROSOFT_CLIENT_ID` daar leeg is maar wél op een andere groep staat, kan Microsoft reageren met *The provided request must include a 'client_id' input parameter* (authorize-URL bevat dan `client_id=` zonder waarde).
- Xano **environment variables** (Outlook / Microsoft): `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` (zelfde waarden als in Azure Entra app registration; redirect URI = exacte Xano callback-URL). Daarnaast `dashboard_outlook_return_url` (productie return URL) en optioneel `dashboard_outlook_return_url_local` (lokale return URL, bv. `http://localhost:5174/settings/support/general`).

---

## 3. Mobiele App – Schermen & Features

Tech stack: React Native + Expo Router + Gesture Handler + Reanimated. Fonts: Jaro, Montserrat, JetBrainsMono.

### 3.1 Home (`/`) – Twee-pagina pager
Horizontaal veegbaar met paginadots bovenaan.

**Pagina 0: Gesprekken**
- Gradient header met hamburger, "Bokito.ai" logo, zoekbalk (live filter op titel + laatste bericht)
- Gesprekslijst (`FlatList`) — pull-to-refresh, lege staat
- FAB (groen, rechtsonder) → nieuw gesprek aanmaken → navigeert naar `/chat`
- Bij laden: `initSession()` + `loadConversations()`
- `LoginRequiredGate` bij ongeauthenticeerde gebruiker

**Pagina 1: Cloud Agents**
- Gradient header met hamburger + instellingenknop (naar `/settings`)
- Twee tabs: Lijst en Schedule

  *Lijst-tab:*
  - Samenvattingsrij: Totaal / Actief / Slapend
  - Versleepbare volgorde via long-press (`DraggableFlatList`)
  - **AgentRow**: geanimeerde glow-avatar (puls bij actief, maanbadge bij slapend), naam, beschrijving, laatste-run, volgende-run, mini sparkline (24h activiteit), requests, succesrate
  - FAB opent `CreateAgentModal`

  *Schedule-tab:*
  - Verticale 24-uurs tijdlijn (64px per uur), scrolt naar huidig tijdstip
  - Rode "nu"-indicator lijn
  - **DraggableScheduleBlock**: long-press + drag om blokken te verplaatsen (snaps op 15-min grid)

---

### 3.2 Chatscherm (`/chat`)
- Gradient header met terug, gesprekstitel, statusdot, opties
- **Agent mode banner** (oranje): zichtbaar bij overdracht naar menselijke agent
- **Fouttoast**: auto-dismiss na 5s
- **Nieuw gesprek state**: welkomstavatar + begroeting + horizontale suggestiechips
- **Berichtenlijst** (`FlatList`): auto-scroll bij nieuw bericht en keyboard-open
- **Thinking indicator**: geanimeerde dots + `toolSteps` (tool-call stappen zichtbaar tijdens AI-verwerking)
- **ChatInput**: tekstveld + afbeeldingsbijlage (`expo-image-picker`) + verzendknop, uitgeschakeld tijdens verwerking

---

### 3.3 Agent Detail (`/agent`)
- Gradient header met terug + agentpictogram + naam
- **Hero**: 72px avatar (tik opent `IconPickerModal`), puls-glow ring bij actief, maanbadge bij slapend
- **Stats grid**: Requests, Succesrate, Uptime, Gem. responstijd
- **Activiteitsgrafiek**: geanimeerde real-time staafgrafiek (24h data)
- **Details**: Model, Schedule, Laatste actief, Volgende run, Fouten vandaag (amber bij > 0)
- **Tools sectie**: tool-chips
- **Actieknoppen**: Pauzeren/Activeren, Configuratie

---

### 3.4 State & API (Mobiel)
- **ChatContext**: sessie-initialisatie, gesprekken laden/aanmaken/openen/sluiten, berichten, suggesties, bijlage-upload, SSE-streaming, `isThinking`, `toolSteps`, `isAgentMode`, `loginRequired`
- **AgentContext**: icoon-overrides per agent (persistent)
- **ApiClient**: GET, POST, PATCH, SSE-streaming (`openStreamPost`), bijlage-upload (multipart)
- **Authenticatie**: `customer_id` in `AsyncStorage`, session auto-refresh bij 401

---

## 4. Chat Widget – Features

Type: Vanilla JS embeddable widget, geen framework. Geladen via `<script>` tag.

### 4.1 Embed
```html
<script
  src="https://xrex-nmji-j9ur.f2.xano.io/api:livechat/script/main"
  data-agent-slug="demo"
  data-api-url="https://xrex-nmji-j9ur.f2.xano.io"
  defer>
</script>
```
Of via `<iframe>` wijzend naar `/chat/embed?agent=...`

- De widget gebruikt de API-host van `data-api-url` of leidt die af uit de script-URL (stuk voor `/api:livechat`), en normaliseert trailing slashes. Dit voorkomt dat berichten naar een verkeerde host of dubbele URL gaan bij inject-embeds.

### 4.2 Features
- **Launcher**: zwevende knop met "Happy Bokito" monkey-face SVG + knipperanimatie, optionele labeltekst
- **Sleepbare launcher**: bezoeker kan de launcher verslepen langs de onderkant en rechterrand (L-vormig rail incl. hoek). Positie wordt opgeslagen in `localStorage` onder key `bokito_widget_pos` (`{edge:'bottom'|'right', offset:number, savedAt}`). Drempel van 6px onderscheidt klik van drag. Werkt ook op mobiel; window opent op mobiel altijd fullscreen.
- **Slimme open-positie van het chat-window**: `#computeWindowAnchor` kiest horizontale (`left`/`right`) en verticale (`top`/`bottom`) ankerkant op basis van launcher-centrum t.o.v. viewport-midden, en zet bijpassende `transform-origin` zodat de spring-in animatie vanuit de launcher-hoek komt.
- **SSE-streaming**: AI-antwoorden real-time karakter voor karakter gestreamd
- **Bijlagen**: bestanden en afbeeldingen uploaden
- **Voiceinput**: spraakherkenning (benoemd in README)
- **Startervragen / suggestiechips**
- **Chatgeschiedenispersistentie**: via `localStorage`
- **Dark/light mode**: adapteert aan browser `prefers-color-scheme`
- **PII-filter**: verwijdert e-mailadressen, creditcardnummers, 9-cijferige IDs, telefoonnummers uit berichten voor verzending
- **MarkdownRenderer**: verwerkt bold, italic, code, links, lijsten in AI-antwoorden
- **Identiteitstoken (SSO)**: `identityTokenGetter` callback voor ingelogde gebruikers
- **GDPR**: geen cookies zonder toestemming
- **Configuratie via `data-*` attributen**: `data-agent-slug`, `data-bot-name`, `data-primary-color`, `data-position`
- **Multi-tenant auth bootstrap**: widget kan host-auth overnemen via `data-auth-cookie-name`, `data-auth-token` of `window.BokitoConfig.getAuthToken()`, en stuurt dan `host_auth_token` mee naar `session/start`.
- **Auth modes**: `anonymous`, `optional`, `required` worden ondersteund via backend `agent_config.auth_mode` of `data-auth-mode`.
- **Login fallback in widget**: bij verplichte auth zonder geldig token toont de widget een ingebouwd e-mail/wachtwoord formulier (`POST /api:livechat/auth/login`).
- **User preferences sync**: bij beschikbare API gebruikt de widget `GET/PATCH /api:livechat/user/preferences` met localStorage als cache/fallback.
- **Authenticated history first**: de widget probeert eerst `GET /api:livechat/user/conversations` en valt terug naar `customer/conversations`.
- **Tenant MCP context forward**: `mcp_server_ids` + `tenant_context` worden meegestuurd in stream-chat requests wanneer session payload tenant-MCP data bevat.

---

## 5. Document & OCR Module

*(Zichtbaar in navigatie onder Automatisering → Documenten & OCR, nog niet geimplementeerd in frontend)*

**Buckets (Documentcollecties)**
- Een bedrijf kan meerdere buckets aanmaken, elk voor een specifiek documenttype
- Voorbeelden: Bonnetjes, Facturen, Contracten, HR-documenten, Garantiebewijzen
- Documenten worden geupload of gescand (via chat of webapp) en ingedeeld per bucket

**Indexering**
- Na upload: OCR-verwerking (tekst-extractie uit afbeeldingen/PDF's)
- Geextraheerde data wordt geindexeerd en doorzoekbaar gemaakt
- Automatische veldherkenning: datum, bedrag, leverancier, contractpartij, etc.

**Toegangsbeheer per bucket**
- Admin bepaalt wie toegang heeft: specifieke medewerkers, rollen, of publiek
- Toegangsrechten bepalen wat agents mogen ophalen en tonen

**Agent-integratie**
- Agents halen documenten op uit een bucket als onderdeel van een gesprek
- Gebruikers kunnen vragen als: "Wat was het bedrag op de factuur van leverancier X?"
- Elke bucket is een doorzoekbare kennisbron voor de agent

---

## 5b. Web Scraping & Documentatie Datamodel

Xano workspace 1 bevat drie tabellen voor het opslaan van gescrapete webpagina's en documentatie, ten behoeve van AI-zoeken (RAG).

### Tabelstructuur

```
organisation
  └── doc (id: 39)              — documentatiebron / gescrapete site
        └── doc_page (id: 40)   — individuele gescrapete pagina
              └── doc_section (id: 41)  — inhoudschunk + vector embedding
```

### `doc` (tabel-id: 39)
Vertegenwoordigt een documentatiebron op hoog niveau (bijv. een volledige websitedomein).

| Kolom | Type | Omschrijving |
|---|---|---|
| `id` | uuid | Primary key |
| `created_at` | timestamp | Aanmaakdatum |
| `organisation_id` | uuid → organisation | Tenant-isolatie |
| `title` | text | Naam van de documentatiebron |
| `source_url` | text | Root-URL van de gescrapete site |
| `description` | text? | Optionele beschrijving |
| `status` | enum | `active` / `archived` / `scraping` / `error` |
| `last_scraped_at` | timestamp? | Tijdstip laatste succesvolle scrape |
| `metadata` | json? | Scrapeconfiguratie, selectors, etc. |

### `doc_page` (tabel-id: 40)
Een individuele gescrapete pagina binnen een `doc`.

| Kolom | Type | Omschrijving |
|---|---|---|
| `id` | uuid | Primary key |
| `created_at` | timestamp | Aanmaakdatum |
| `organisation_id` | uuid → organisation | Gedenormaliseerd voor snelle tenant-queries |
| `doc_id` | uuid → doc | Parent documentatiebron |
| `url` | text | Volledige URL van de pagina |
| `title` | text? | Paginatitel |
| `status` | enum | `active` / `archived` / `error` |
| `scraped_at` | timestamp? | Tijdstip van scrapen |
| `http_status` | int? | HTTP-statuscode bij scrapen |
| `metadata` | json? | Headers, meta-tags, canonical URL, etc. |

### `doc_section` (tabel-id: 41)
Een inhoudschunk (sectie) van een pagina, met vector embedding voor AI-zoeken.

| Kolom | Type | Omschrijving |
|---|---|---|
| `id` | uuid | Primary key |
| `created_at` | timestamp | Aanmaakdatum |
| `organisation_id` | uuid → organisation | Gedenormaliseerd voor snelle tenant-queries |
| `doc_id` | uuid → doc | Gedenormaliseerd voor queries op bronniveau |
| `doc_page_id` | uuid → doc_page | Parent pagina |
| `heading` | text? | Sectiekopregel (h1/h2/h3 tekst) |
| `content` | text | Volledige tekst van deze chunk |
| `section_index` | int? | Volgorde binnen de pagina |
| `keywords` | text[]? | Trefwoorden (GIN full-text index) |
| `embedding` | vector (1536, private) | AI vector embedding voor semantisch zoeken |
| `is_active` | bool | Of deze sectie doorzoekbaar is |
| `token_count` | int? | Geschat aantal tokens (LLM context) |
| `metadata` | json? | HTML-tag, diepte, anchor, etc. |

### Indexen
- `btree(organisation_id)` op alle drie tabellen — tenant-isolatie
- `btree(doc_id)` op `doc_page` en `doc_section` — queries per bron
- `btree(doc_page_id)` op `doc_section` — queries per pagina
- `btree(url)` op `doc_page` — dedup bij ingest
- `gin(keywords)` op `doc_section` — full-text zoeken
- `gin(xdo jsonb_path_op)` op alle drie — JSON-veldqueries

---

## 6. Geplande / Stub Modules

Zichtbaar in navigatie maar nog niet gebouwd:

| Module | Locatie in nav |
|---|---|
| Assistent | Agents |
| Workflows | Automatisering |
| Triggers | Automatisering |
| Documenten & OCR | Automatisering |
| API-sleutels | Integraties |
| Webhooks | Integraties |
| Team management | Mijn organisatie |
| Kennisbank | Mijn organisatie |
| Analytics (placeholder) | Top-level `/analytics` |

---

## 7. Business Rules & SOPs

- Buckets zijn altijd gekoppeld aan één organisatie; cross-organisatie toegang is niet standaard mogelijk
- OCR-verwerking vindt asynchroon plaats na upload
- Agents kunnen alleen data ophalen uit buckets waarvoor ze expliciet toegang hebben
- Dashboard-data is momenteel grotendeels mock; live API-calls zijn alleen auth (`/auth/login`, `/auth/me`)
- Mobiele app en widget communiceren volledig live via Xano livechat API (`/api:livechat/`)

---

## 8. Technische Architectuur

- **Backend**: Xano (API, database, agents, MCP server, static hosting)
- **Dashboard**: React + TypeScript + Vite + React Router + Tailwind CSS
- **Mobiel**: React Native + Expo Router
- **Widget**: Vanilla JS, geen dependencies, SSE-streaming
- **Auth**: Dashboard gebruikt cookie + memory sessie (`/api/auth/*`), mobiel gebruikt `AsyncStorage`; dashboard `GET /api/auth/me` bevat tenantobject `tenant.id`, `tenant.slug`, `tenant.name` en optioneel logo-URL (genormaliseerd naar `user.tenant.logo`)
- **Tenant canonical key**: `account.slug` (unique) is de vaste tenant identifier voor frontend-logica en feature-scope
- **Workspace 1 tenant-tabellen**: `account` (tabel-id `2`) en `organisation` (tabel-id `6`) bestaan elk één keer en zijn aparte modellen (niet dubbel); `account` bevat account/bedrijfsgegevens, `organisation` bevat tenantconfiguratie zoals livechat- en budgetinstellingen.
- **Workspace 1 tenant-relaties**: het merendeel van domeintabellen verwijst naar `organisation_id` (UUID, tableref `6`), terwijl auth/e-mail nog `account_id` (int, tableref `2`) gebruikt, o.a. `user`, `event_log`, `email_oauth_connection` en `outlook_oauth_state`.
- **Tenant-migratie status (workspace 1)**: `account.organisation_id` en `user.organisation_id` zijn toegevoegd en gevuld voor bestaande records; `event_log.organisation_id` is na een mislukte bulk-backfill weer verwijderd en blijft voorlopig op `account_id` totdat row-id gestuurde backfill wordt gebruikt.
- **Tenant-migratie fase**: de volledige `account`→`organisation` migratie gebeurt momenteel in pre-live; tijdelijke datainconsistentie in migratielogs is acceptabel zolang productie nog niet live staat.
- **Real-time**: Server-Sent Events (SSE) voor streaming AI-antwoorden
- **Xano API base**: `https://xrex-nmji-j9ur.f2.xano.io`
  - Dashboard auth: `/api:auth`
  - Widget/Mobiel livechat: `/api:livechat`
  - Bakermat design configurator: `/api:paVSDSqb`

### Frontend API endpoint-opbouw (dashboard SOP)

- De dashboard frontend bouwt Xano endpoints op via `VITE_XANO_BASE_URL` + `VITE_API_GROUP_*` + endpoint path.
- De centrale opbouw staat in `apps/dashboard/src/lib/api.config.ts`; featurecode hergebruikt deze bases.
- Integratie- en e-mailroutes lopen via canonical `api:integrations`; frontend gebruikt hiervoor `VITE_API_GROUP_INTEGRATIONS` en `INTEGRATIONS_API_BASE`.
- API group variabelen zijn standaard aanwezig in `apps/dashboard/.env.example` en blijven leidend voor nieuwe API-integraties.
- Endpoint paths blijven feature-specifiek en worden lokaal toegevoegd op een gedeelde base.
- `VITE_*` variabelen bevatten geen secrets; Vite verwerkt deze waarden build-time in de frontend bundle.
- Hardcoded volledige API origins in pagina’s/components gelden als afwijking van de standaard en worden bij refactors verwijderd.

### Bjorn Lunden MCP (BLA API)

- **Repo-locatie:** [`xanoscript/`](xanoscript/) — XanoScript voor tabel `bl_clients`, functies `bjorn_lunden/bl_bl_credentials` en `bjorn_lunden/bl_api_request`, **60 MCP-tools** onder `xanoscript/tools/bjorn_lunden/`, en MCP-serverdefinitie [`xanoscript/mcp_servers/bjorn_lunden_mcp.xs`](xanoscript/mcp_servers/bjorn_lunden_mcp.xs).
- **Bron-API:** Bjorn Lunden BLA (`https://apigateway.blinfo.se/bla-api/v1/sp`); auth via header **`User-Key`** (API-key per administratie). OpenAPI-referentie in de repo: [`bourgondienadvies/bl-docs.json`](bourgondienadvies/bl-docs.json).
- **Multi-administratie:** Elke BL-klantadministratie krijgt een rij in `bl_clients` met unieke `client_id` (string), `name`, `bl_api_key`, en optioneel `base_url` (leeg laten is niet aanbevolen; default is de standaard BLA base-URL bij invoer in Xano).
- **Tool-generatie:** [`xanoscript/scripts/generate-bl-tools.mjs`](xanoscript/scripts/generate-bl-tools.mjs) regenereert alle toolbestanden; deploy door de XanoScript VS Code-extensie te gebruiken (push naar workspace).
- **Bulk deploy (workspace 1):** Ontbreekt of is `XANO_METADATA_API_KEY` in `.env` ongeldig, dan kan dezelfde metadata-API (`POST .../api:meta/workspace/1/tool` en `.../mcp_server` met `Content-Type: text/x-xanoscript`) met env **`XANO_BOKITO_AUTH_HEADER`** (dezelfde waarde als Cursor MCP `xano-bokito`) worden aangeroepen. Script: [`xanoscript/scripts/push-bl-tools-bokito-cmd.mjs`](xanoscript/scripts/push-bl-tools-bokito-cmd.mjs) (alle `bjorn_lunden` tools + `bjorn_lunden_mcp.xs`). In Xano staat de MCP-server **Bjorn Lunden MCP** (bijv. id 8) met alle `bl_*` tools geregistreerd.
- **Scope tools:** leveranciers, klanten, inkoop/verkoopfacturen, journaal, documenten, kostenplaats/kostendrager, attestanten, **ftgpar** (`GET /ftgpar?entityId=...`), **settings** (`GET /settings/type/{type}`), grootboek- en artikelbatch, projecten, boekjaar, klantadressen, valuta, offertes/orders, key figures (`/keyfigure/{kpi_path}/{date}`) en rapporten (`/report/{type}/{fromDate}/{toDate}`).

### Livechat: legacy Claude-router vs native Xano-agent (dual pipeline)

Livechat ondersteunt **twee server-side pipelines** naast elkaar. Clients blijven standaard dezelfde URLs aanroepen; Xano kiest intern de pipeline **per agent** (aanbevolen), of je exposeert een **tweede POST-route** en stuurt overrides mee in `agent_config`.

**Aanbevolen (één endpoint, branch in Xano):** `POST /api:livechat/stream-chat` (en zo nodig `stream-chat-continue`) blijft het contract. In de function stack: als `chat_pipeline === "xano_native"`, run de ingebouwde **Xano AI Agent** (zelfde message-persist en SSE-output als legacy); anders ongewijzigde legacy-flow (Claude/router).

**Alternatief (tweede route):** bv. `POST /api:livechat/stream-chat-native` met identiek request body en **hetzelfde SSE-formaat** als `stream-chat`. Zet dan in `agent_config`:

| Veld | Type | Betekenis |
|------|------|-----------|
| `chat_pipeline` | `"legacy"` \| `"xano_native"` | Documentatie/telemetrie; clients gebruiken het vooral informatief. Standaard: `legacy` of weglaten. |
| `xano_agent_id` | string (optioneel) | Verwijzing naar de Xano AI Agent die de native tak moet runnen (id/canonical naar keuze van jullie Xano-model). |
| `stream_chat_path` | string (optioneel) | Path-segment onder `/api:livechat/` voor de eerste SSE POST. Alleen `[a-zA-Z0-9_-]{1,64}`. Default: `stream-chat`. |
| `stream_chat_continue_path` | string (optioneel) | Zelfde regels; default: `stream-chat-continue`. |
| `transcribe_path` | string (optioneel) | Path-segment onder `/api:livechat/` voor spraak-transcriptie (`POST`). Alleen `[a-zA-Z0-9_-]{1,64}`. Default: `transcribe`. |

**`session/start`:** breid het bestaande `agent_config`-object uit met bovenstaande velden (backward compatible: geen velden = legacy + defaults).

**SSE-contract (ongewijzigd):** clients verwachten o.a. `{ "t": "..." }` chunks, `{ "type": "title", ... }`, `{ "type": "page_context_needed", ... }`, `{ "type": "done", "content": "...", "id": ... }`. De **native tak** moet dezelfde events emittersen (of `page_context_needed` **niet** sturen als die stap daar niet bestaat — anders blijft de client wachten op `stream-chat-continue`).

**Incrementele UI-streaming:** Widget en mobiel **renderen elke `t`-chunk live** (widget: `textContent` tijdens de stream, daarna markdown bij `done`; mobiel: `parseSseStream` `onDelta` + tijdelijk AI-bericht met status `processing`, daarna `sent`). Voor zichtbare woord-voor-woord streaming moet de backend **meerdere** `t`-events emitten (Xano agent streaming forwarden of response in segmenten knippen). **Client-side smoothing:** als er géén `t`-events waren en alleen `done` met `content`, knipt de widget de tekst in stukjes en toont die met korte delays (`#sseMaybeSimulateClientChunks`); uitschakelbaar met `data-client-simulate-stream="false"` of query `bk_sse_smooth=0` bij auto-mount. Mobiel: zelfde idee na `parseSseStream` wanneer `hadTokenEvents` false (`splitTextForClientSim` + `onDelta`).

**Repo-clients:** [`apps/chat-widget/bokito-chat.js`](apps/chat-widget/bokito-chat.js) en de mobiele app ([`apps/mobile/src/context/ChatContext.tsx`](apps/mobile/src/context/ChatContext.tsx) + [`parseSseStream` / `livechatStreamPaths`](apps/mobile/src/api/streamChat.ts)) gebruiken `stream_chat_path` / `stream_chat_continue_path` wanneer Xano die zet.

**Xano-implementatiechecklist (handmatig in workspace):**

1. **Agent-tabel of config:** kolom/JSON `chat_pipeline`, optioneel `xano_agent_id` (of vaste agent per slug).
2. **`session/start`:** merge deze waarden in `agent_config`.
3. **`stream-chat`:** `if chat_pipeline == xano_native` → laad conversatie + berichten, append user message, **Run AI Agent** met history, sla assistent-bericht op, stream SSE met **incrementele** `t`-chunks zodra het model tekst produceert, afsluiten met `done`; `else` → bestaande stack.
4. **`stream-chat-continue`:** alleen relevant voor legacy `page_context_needed`; native tak kan dezelfde handler laten of een no-op die direct `done` stuurt als je ooit per ongeluk continue aanroept.
5. **Realtime / tool-stappen (pariteit, optioneel):** de widget luistert naar `tool_started`, `tool_completed`, `tool_error` op het conversation-kanaal ([`#handleRealtimeEvent`](apps/chat-widget/bokito-chat.js)). Als de native agent tools uitvoert, emitteer dezelfde `event_type` + `object` als legacy zodat “thinking steps” zichtbaar blijven; anders blijft alleen de denk-indicator zonder substappen.

**Testen:** gebruik een **aparte `agent_slug`** (bijv. `demo-native`) met `chat_pipeline: "xano_native"` zodat productie-slugs op legacy blijven. Vergelijk gedrag met [`apps/chat-widget/chat-standalone.html`](apps/chat-widget/chat-standalone.html) en de mobiele app.

**Verschil met Bakermat:** Bakermat-chat gebruikt `POST /api:paVSDSqb/chat` en een aparte flow; livechat blijft op `/api:livechat` met het hierboven beschreven SSE-contract.

### Livechat: spraak transcriptie (`transcribe` + faster-whisper)

**faster-whisper draait niet in de Xano-runtime.** De repo bevat een aparte **ASR-worker**: [`apps/asr-service/`](apps/asr-service/) (FastAPI + [faster-whisper](https://github.com/SYSTRAN/faster-whisper)). Xano exposeert `POST /api:livechat/transcribe` (of een override via `agent_config.transcribe_path`) en proxy’t de audio naar die worker met een gedeeld geheim.

**Widget:** [`apps/chat-widget/bokito-chat.js`](apps/chat-widget/bokito-chat.js) en [`apps/chat-widget/js/chat-module.js`](apps/chat-widget/js/chat-module.js) uploaden na bevestigen van de opname een **webm**-blob als multipart (`audio`), met form fields `session_token` en `language` (`nl`), en header `Authorization: Bearer <session_token>`. Als de server geen bruikbare `text` teruggeeft, valt de client terug op de **Web Speech API**-tekst (indien beschikbaar).

**Workspace environment variables (Xano):**

| Variable | Gebruik |
|----------|---------|
| `BOKITO_ASR_URL` | Volledige URL van de worker, eindigend op `/transcribe` (bijv. `https://asr.jouwdomein.nl/transcribe`). |
| `BOKITO_ASR_API_KEY` | Zelfde waarde als `ASR_API_KEY` op de ASR-service. |

**Xano: `POST /api:livechat/transcribe` bouwen (function stack):**

1. Valideer de livechat-sessie op dezelfde manier als bij `POST /api:livechat/attachment` (Bearer-token en/of form field `session_token`).
2. **External API request:** `POST` naar `BOKITO_ASR_URL`, header `X-API-Key: <BOKITO_ASR_API_KEY>`, body **multipart/form-data** met bestandsveld `audio` = het geüploade bestand van de client; optioneel form field `language` doorgeven.
3. Response van de worker is JSON (`text`, `language`, …). Stuur minimaal `{ "text": "<transcript>" }` terug naar de widget.
4. Zet de time-out op de external request hoog genoeg voor model-inferentie (CPU kan tientallen seconden duren).
5. Map 413/4xx van de worker naar passende clientfouten waar nodig.

---

## 8b. Bakermat Design Configurator

Bakermat is een partner-facing React app (`apps/bakermat/`) waarmee klanten van partners hun trailer/stand laten ontwerpen met hun huisstijl via een AI-gestuurde flow.

### Architectuur
- **Frontend**: React + TypeScript + Vite + Tailwind + Framer Motion
- **AI Chat**: Aangestuurd door Xano Agent "Bakermat Design Assistant" (canonical: `xnB1Q5od`, xano-free provider)
- **API**: Xano API group `bakermat` (canonical: `paVSDSqb`) met `POST /chat` endpoint
- **Realtime**: Hergebruikt het bestaande `conversation` realtime channel (`conversation/{sessionId}`) voor push-based berichten
- **Image Generation**: Client-side via OpenAI DALL-E 3 (tijdelijk; wordt later een Xano tool)

### Flow
1. Welkom → Vragen (bedrijf, sector, stijl, kleur) → Trailer selectie → Merk-input (URL + logo) → AI Design chat → Eindontwerp
2. In de AI Design stap: split-screen met 3 image slots (links) en AI chat (rechts)
3. Chat stuurt berichten via `POST /api:paVSDSqb/chat` naar de Xano agent
4. Agent geeft `[GENEREER_ONTWERPEN]` trigger mee wanneer designs gegenereerd moeten worden
5. Frontend parseert de trigger en start client-side image generation

### Xano Backend
- **Agent**: "Bakermat Design Assistant" — xano-free model, Nederlandse system prompt, dynamische context via `$args` (bedrijfsnaam, sector, stijl, kleursfeer, trailer, website)
- **Tool**: `BM_GET_WEAGON_DESIGNS` (leeg, nog te implementeren voor server-side image generation)
- **Endpoint**: `POST /api:paVSDSqb/chat` — ontvangt session_id + messages + context, runt de agent, broadcast via realtime

### Bakermat Operations (BM_ -> custom_db migratie)
- De operationele Bakermat-data (`BM_jobs`, `BM_job_phases`, `BM_products`, `BM_calendar_events`, `BM_customers`) wordt gemigreerd naar de no-code meta-tabellen (`custom_table`, `custom_field`, `custom_record`, `custom_view`) in workspace `1`.
- Voor Bakermat gebruikt `custom_table.organisation_id` de tenant/account-id `4` (`bakermat-design`) als scope voor de custom tabellen.
- Doeltabel-slugs voor de operatie-UI: `bm_jobs`, `bm_job_phases`, `bm_products`, `bm_calendar_events`, `bm_customers`.
- De operationspagina `apps/bakermat/operatie.html` gebruikt nu direct de generieke custom DB API (`/api:vLUpKLJh`) in plaats van de legacy Bakermat CRUD-routes (`/api:paVSDSqb/jobs|products|phases|calendar`).
- De operatie-UI verwacht een geldige dashboard access token in runtime memory; token-resolutie loopt via de centrale auth provider (geen `localStorage` dependency).
- Migratiescript: `scripts/migrate-bakermat-bm-to-custom-db.mjs` ondersteunt idempotente upsert op `bm_legacy_id` plus `--dry-run`.
- Legacy bron-tabellen met prefix `BM_` in workspace `1` zijn verwijderd na migratie; operationele data voor Bakermat staat nu uitsluitend in tenant-scoped custom tabellen (`organisation_id = 4`).

### Static hosting (deploy)
- Vanaf de repo-root: `deploy-xano-static.ps1` zipt een map en uploadt via de Xano Metadata API.
- Parameters: `-BuildPath` (default `.\apps\website\static`), `-BuildName`, `-BuildDescription`, optioneel `-XanoWorkspaceId` en `-XanoStaticHost` (overschrijven van `.env`), en `-ActivateEnvironment` met waarden `prod` (default), `dev`, of `none` (alleen upload, geen activatie).
- Standaard gebruikt het script `XANO_METADATA_API_KEY`, `XANO_META_BASE_URL`, `XANO_WEBSITEWORKSPACE_ID` en `XANO_WEBSITE_STATIC_HOST_NAME` uit de root-`.env`.
- Voorbeeld (andere workspace/static site, zoals **marcocrm** in de UI: workspace `3`, static host `4` in de URL):  
  `.\deploy-xano-static.ps1 -BuildPath .\apps\bakermat\dist -XanoWorkspaceId 3 -XanoStaticHost 4 -ActivateEnvironment dev`

---

## 9. No-Code Database Builder

Het platform biedt tenants een no-code database builder (`/database`) waarmee ze zelf tabellen, velden en records aanmaken en beheren, vergelijkbaar met Airtable.

### Architectuur

Meta-schema benadering met 4 vaste Xano-tabellen:

| Tabel | Xano ID | Doel |
|---|---|---|
| `custom_table` | 45 | Tabeldefinities per organisatie |
| `custom_field` | 46 | Velddefinities per tabel (14 field types) |
| `custom_record` | 47 | Data-rijen met JSON `data` kolom |
| `custom_view` | 48 | Viewconfiguraties per tabel |

### Field Types

text, number, boolean, date, email, url, phone, select, multi_select, file, currency, rating, relation, formula. Configuratie per type opgeslagen in `config` JSON kolom (bijv. select-opties, valutasymbool, rating max).

### Views

- **Grid** — spreadsheet met inline editing, sorteren, paginatie
- **Kanban** — drag & drop board gegroepeerd op select-veld
- **Calendar** — maandweergave op basis van datumveld
- Grid ondersteunt kolom-resize door de headergrens te slepen; kolombreedtes worden per view opgeslagen in `custom_view.config.columnWidths`.
- Tijdens resize worden kolombreedtes debounced naar de server opgeslagen, plus direct op drag-end voor hogere betrouwbaarheid.
- Grid gebruikt een vaste `colgroup` kolombreedtebron zodat het verbreden van 1 kolom andere kolommen niet proportioneel herschaalt.
- Bij verbreden groeit de tabelcanvas naar rechts (`w-max` + horizontale scroll) en kan de gebruiker verder naar rechts scrollen zoals in SmartSuite.
- Utilitykolommen blijven vast: selectie-kolom 36px, index `#` 40px (en actiekolom 40px).

### API

Xano API-groep `custom_db` (id: 9, canonical: `vLUpKLJh`) met volledige CRUD endpoints voor tabellen, velden, records en views. Alle endpoints vereisen JWT-authenticatie en filteren op tenant via `organisation_id`.

- Optioneel: `GET /standard-tables` en `POST /standard-tables/create` voor het eenmalig aanmaken van standaardtabellen (`is_standard`). Ontbreken deze routes (404 / “Unable to locate request”), dan initialiseert de dashboard-databasepagina zonder die bootstrap en zonder herhaalde retries; custom tabellen blijven werken via `custom-tables`.

### Frontend

- Route: `/database` en `/database/:tableSlug`
- Sidebar-item "Database" met `Database` icon
- `DatabaseContext` provider voor state management
- `/database/*` gebruikt een dedicated `DatabaseLayout` zodat de `DatabaseContext` zowel de linker section-sidebar als de inhoudspagina voedt.
- Componenten: `TableListSidebar`, `CreateTableDialog`, `FieldEditor`, `FieldTypeSelector`, `FieldConfigPanel`, `ViewTabs`, `GridView`, `KanbanView`, `CalendarView`, `CellRenderer`, `CellEditor`
- Dependencies: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (kanban drag & drop)
- Klikken op de `{x} velden` knop opent een dedicated modal voor field management in plaats van een inline paneel.
- Field creation gebruikt backend slug-collision beveiliging om duplicate fouten bij meerdere velden te voorkomen.
- Tabellen worden voor `/database` in de linker section-sidebar getoond in 2 groepen: `System tables` (`is_standard = true`) en `Custom tables` (`is_standard != true`).
- Nieuwe tabellen worden aangemaakt via een `+` knop in de group-header van `Custom tables` (niet meer via de bovenste tabel-header).
- Tabelselectie loopt via de linker sidebar en navigeert naar `/database/:tableSlug`; de tabeldata wordt in het rechter inhoudspaneel geladen.
- Reorder van view-tabs is strikt horizontaal; verticale drag-offset wordt genegeerd zodat tabs niet naar beneden kunnen verspringen tijdens slepen.
- De pagina gebruikt een single-header layout (geen dubbele titelbalk onder de tabs).
- Grid ondersteunt inline record-aanmaak via een vaste invoerregel onder de laatste rij, inclusief lege tabel-state direct onder de header.
- Grid heeft multiselect met checkbox-kolom links naast `#`, inclusief "select all" in de tabelheader.
- Inline create-cellen ondersteunen `Enter` om direct op te slaan/toe te voegen zonder op het plus-icoon te klikken.
- De `{x} velden` actie staat in de bovenste tabel-headerregel met de view-tabs (`Grid View`, etc.) en opent een field-management modal.
- Veldkolom-headercellen tonen bij hover rechts een tandwiel-icoon voor directe veldinstellingen (naam, required, type-config, verwijderen).
- In de field-management popup kunnen velden via drag-and-drop worden herordend; de nieuwe volgorde wordt direct server-side opgeslagen via `custom_field.position`.
- Impactvolle verwijderacties in databasebeheer vragen expliciete type-bevestiging: gebruiker moet de naam van het item exact typen voordat verwijderen actief wordt (o.a. tabel verwijderen en veld verwijderen).
- Nieuwe records worden onderaan toegevoegd (ascending op `created_at`) zodat de invoerflow logisch van boven naar beneden blijft.
- Kolom-resize handles in de header zijn standaard visueel verborgen en worden pas zichtbaar bij hover (geen permanente kleine streepjes in de headercellen).
- Bij selectie van een of meerdere records verschijnt onderaan een sticky bulk-toolbox in de footer met acties (deselecteren, geselecteerde records verwijderen).
- Select- en multi-select cel-popups sluiten direct na keuze; popup-interactie is afgeschermd van cel-click bubbling zodat de editor niet onbedoeld heropent.
- Tabelcreatie (`POST /custom-tables`) gebruikt collision-safe slugs (timestamp suffix) om duplicate record errors bij een tweede tabel te voorkomen; frontend heeft extra retry-fallback op duplicate meldingen.

### Seeddata tenant `bourgondienadvies` (custom database)

De Bourgondiënadvies tenant (account_id=6, organisation_id=6) heeft 5 voorgedefinieerde custom tabellen met realistische accountancy-data:

| Tabel | custom_table id | Icon | Records | Beschrijving |
|---|---|---|---|---|
| Klanten | 13 | Users | 6 | Zakelijke relaties (Bakkerij Goudkrust, Timmerbedrijf Vos B.V., Bloemen van Soest, Fietsenwinkel De Pedaal, Slagerij Jansen, Restaurant De Gouden Leeuw) |
| Facturen | 14 | FileText | 10 | Inkomende en uitgaande facturen met bedragen, BTW, status |
| Boekingen | 15 | BookOpen | 8 | Grootboekboekingen Q1 2026 (omzet, huur, loon, afschrijving, inkoop) |
| BTW-aangiften | 16 | Calculator | 8 | Q1 2026 (concept) + Q4 2025 (ingediend/goedgekeurd) per klant |
| Jaarwerk | 17 | Briefcase | 11 | Jaarrekeningen, IB/VPB-aangiften, publicatiestukken boekjaar 2025 |

Field slugs volgen het patroon `field_{tableId}_{veldnaam_slug}` (bijv. `field_13_bedrijfsnaam`, `field_14_status`). Elke tabel heeft een standaard Grid View.

---

## 10. AI-Powered Multichannel Inbox (PRD V1.1)

Uitbreiding van het platform met een volledige multichannel inbox, AI-communicatie assistent en knowledge base. Vergelijkbaar met Intercom/Missive maar geintegreerd in het Bokito no-code platform.

### 10.1 Email Integratie & Kanaal Infrastructuur (PRD sectie 10)
- OAuth2 koppeling voor Microsoft Outlook (Graph API) en Google Gmail (Gmail API)
- Per workspace meerdere mailboxen (support@, sales@, persoonlijk)
- Bidirectionele email sync: inkomend ophalen (polling 60s) + uitgaand verzenden via provider API
- Email threading op basis van In-Reply-To/References headers en thread_id
- Attachment handling: inline images + bijlagen in Xano file storage (max 25MB)
- Token management: AES-256 encrypted, auto-refresh, health indicator (verbonden/fout/verlopen)
- HTML signature management per mailbox
- Mailbox routing rules: auto-assign op basis van afzenderdomein, onderwerp, of mailbox
- Nieuwe tabellen: `mailbox_connection`, `inbox_routing_rule`
- Uitbreiding Bericht-tabel met: mailbox_id, provider_message_id, in_reply_to, cc, bcc, attachments, conversation_status, snoozed_until, assigned_to, labels, ai_summary, sentiment

### 10.2 Inbox UI & Conversatiebeheer (PRD sectie 11)
- Drie-paneel layout: mailboxen/labels (links) | conversatielijst (midden) | conversatiedetail (rechts)
- Conversatiestatus: Open / Snoozed / Gesloten met keyboard shortcuts
- Snooze met timer (1u/3u/morgen/volgende week/custom)
- Toewijzen aan teamlid, labels, canned responses met variabelen
- Rich text composer: reply/forward/internal note tabs, CC/BCC, auto-signature
- Klant-sidebar: contactgegevens, eerdere conversaties, gekoppelde records
- Interne notities (gele achtergrond, alleen zichtbaar voor team)
- Zoeken + bulk acties + volledige keyboard navigatie
- Thread detail venster heeft één vaste fade overlay aan de bovenzijde (gradient naar `--color-bg`, light/dark aware) zodat berichten visueel vervagen wanneer ze naar boven uit beeld scrollen; dag- en tijdpillen blijven crisp bovenop de fade via z-index
- Bij hover op de afzender-favicon in de conversatie verschijnt een popover (Radix Tooltip stijl) met naam, e-mail en telefoonnummer (alleen rijen die gevuld zijn); telefoonnummer komt uit `contact_phone` op de thread record (optioneel, leeg als niet beschikbaar)
- Inbox URL-routing is deelbaar en deep-link bestendig (Linear/Front patroon):
  - Globale view: `/support/inbox/:queue` of `/support/inbox/:queue/t/:threadId`
  - Channel view: `/support/inbox/ch/:channelId/:queue` of `/support/inbox/ch/:channelId/:queue/t/:threadId`
  - `:queue` is een van `all`, `my`, `unassigned`, `pending`, `closed`, `spam`, `out`
  - Geselecteerde thread is afgeleid van de URL (geen React state), dus klikken op een andere folder/mailbox in de sidebar maakt het detail-pane automatisch leeg
  - Bij een stale URL (bv. een gedeelde link naar een thread die intussen `gesloten` is terwijl de URL `/all` zegt) doet de app **eenmalig** een stille `navigate(..., { replace: true })` naar de canonieke queue van de huidige thread state. Deze one-shot redirect is gekoppeld aan de `threadId` uit de URL: zodra die geëvalueerd is wordt dezelfde thread in deze sessie niet opnieuw geredirect, zelfs niet als de status verandert via een patch in het thread-scherm. Geen banner of toast. Mapping:
    - status `closed` → `/closed`
    - status `spam` → `/spam`
    - status `pending` → `/pending`
    - status `open` → `/all`
  - Bij channel-mismatch (URL `/ch/1` maar thread hoort bij connection 2) wordt het channel-segment gedropt en valt de URL terug op de globale queue.
  - Patch / reply / interne notitie vanuit het thread-scherm laat de URL ongemoeid; in plaats daarvan wordt de threads-lijst direct ververst zodat de thread uit de huidige queue verdwijnt als hij niet meer matcht. Detail-pane blijft de thread gewoon tonen totdat de gebruiker zelf wegklikt.
- Contact context panel (rechterzijde van thread detail, modern tools-stijl):
  - Toggle via `PanelRight` icoonknop in de thread-detail header (rechts naast refresh); voorkeur (open/dicht) wordt persistent opgeslagen in `localStorage` onder `inbox.contactPanel.open`
  - Component: `apps/dashboard/src/components/inbox/ContactPanel.tsx`, gerenderd als derde kolom in `Communication.tsx` naast `ThreadList` en `ThreadDetail`
  - Vaste breedte `w-72`, `border-l border-border/50 bg-bg-surface`, scrollable body
  - Bovenin: contact-card met avatar (initials + deterministische kleur uit `getAvatarColor`, plus domain-favicon badge rechtsonder via `getDomainFaviconUrl`), naam, e-mailadres, en quick-action knoppen "Mail" (mailto:) en "Bellen" (tel:)
  - Sectie "Contactgegevens": e-mail en telefoon met klikbare links
  - Sectie "Thread": status (gekleurde dot + label), prioriteit, mailbox (display name uit `useMailboxConnections`), aanmaakdatum (lange notatie nl-NL), laatste bericht (relatieve tijd), toegewezen aan (uit `listInboxMembers`)
  - Placeholder secties "Eerdere threads" en "Taken" met label "Binnenkort" — voorbereid op toekomstige `contact` entiteit (uniek per tenant op e-mail of secundair telefoonnummer) waarin oudere threads, taken en andere context aan een contact gekoppeld worden
  - Geen emoji's; uitsluitend Lucide icons (`Mail`, `Phone`, `Calendar`, `Clock`, `Hash`, `Inbox`, `PanelRight`, `X`, `ChevronRight`)
- Read/unread tracking op thread-niveau (Linear/Intercom/HelpScout patroon):
  - Thread record heeft `has_unread` boolean (team-wide). De inbox lijst toont een accentdot links van de afzender wanneer `has_unread = true`.
  - Bij klikken op een thread in de lijst gaat de dot meteen weg (optimistic via `setThreadReadState(id, false)` in `useThreads`); de detail hook (`useThreadDetail`) doet vervolgens silent een `PATCH /inbox/threads/{id}/mark-read` en zet `detail.thread.hasUnread = false` lokaal. Falen wordt opgeruimd door de 30s poll.
  - Endpoints zijn auth-required en organisatie-scoped:
    - `PATCH /api:integrations/inbox/threads/{thread_id}/mark-read` (id 232)
    - `PATCH /api:integrations/inbox/threads/{thread_id}/mark-unread` (id 233)
- Pin systeem op thread-niveau (per-user, Slack/Notion patroon):
  - Aparte tabel `inbox_thread_pin` (id 79) met unique index op `(user_id, thread_id)`. Pin state is per-user; collega's zien hun eigen pins.
  - Endpoints zijn idempotent en auth-required:
    - `POST /api:integrations/inbox/threads/{thread_id}/pin` (id 234)
    - `DELETE /api:integrations/inbox/threads/{thread_id}/pin` (id 235)
  - `GET /inbox/threads` decoreert elk item met `is_pinned` via een join op `inbox_thread_pin` voor de huidige user en plaatst gepinde items bovenaan de page (binnen de queue-filter; gepinde gesloten thread verschijnt dus alleen in `pinned` of `closed`, niet in `open`). Een nieuwe `view=pinned` toont alle gepinde threads ongeacht status.
  - `GET /inbox/threads/{thread_id}` voegt `is_pinned` toe aan het thread-object zodat het detail-scherm de pin-status kent.
  - Sidebar heeft onder "Alle kanalen" een nieuwe entry "Gepind" (Lucide `Pin` icon).
- Thread indicator dropdown menu (links van afzendernaam):
  - Geïmplementeerd in [`apps/dashboard/src/components/inbox/ThreadIndicatorMenu.tsx`](apps/dashboard/src/components/inbox/ThreadIndicatorMenu.tsx) op basis van Radix `DropdownMenu`.
  - Visueel: gepind = roterende `Pin` icon (accent), ongelezen = gevulde accent dot, anders transparante placeholder.
  - Hover op de thread-rij toont een subtiele ring rond de indicator (`group-hover/thread:ring-1`) zodat duidelijk is dat de indicator klikbaar is. Klik opent dropdown met contextuele items: "Markeer als gelezen / ongelezen" + "Pinnen / Losmaken".
  - Klik op de indicator selecteert NIET de thread (`stopPropagation`); klik elders op de rij doet dat wel. Optimistic updates met rollback worden afgehandeld in `Communication.tsx` (`handleListMarkRead`, `handleListMarkUnread`, `handleListTogglePin`).

### 10.3 AI Communicatie Assistent (PRD sectie 12)
- Semi-autonome modus: confidence > drempel (0.85 default) = auto-reply, anders suggestie
- AI-suggesties als paars blok boven composer met Gebruik/Bewerk/Negeer knoppen
- AI-acties: taak aanmaken, klantrecord updaten, info opzoeken, label toewijzen
- Conversatie-samenvatting (auto bij >5 berichten)
- Sentiment-analyse: Positief/Neutraal/Negatief/Urgent per bericht
- Slimme categorisering en routering
- AI-instellingen per mailbox: tone, taal, knowledge sources, drempel
- Nieuwe tabel: `ai_inbox_config`

### 10.4 Knowledge Base & Document Indexering (PRD sectie 13)
- Document uploads: PDF/DOCX/TXT/MD/CSV, auto-chunked en embedded
- Document collecties koppelbaar aan mailboxen voor gerichte AI-context
- Database-tabellen als kennisbron via Magic Table
- RAG pipeline: conversatiehistorie + klantgegevens + knowledge base (top-K=10) + Magic Tables (top-K=5)
- Citaties in AI-antwoorden met klikbare voetnoten naar brondocument/record
- Nieuwe tabellen: `kb_document`, `kb_collection`

### 10.5 Benodigde Credentials & Environment Variables

| Variable | Status | Waarde/Omschrijving |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ✅ aanwezig in Xano | Google Cloud Console OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ aanwezig in Xano | Google Cloud Console OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | ✅ aanwezig in Xano | `https://xrex-nmji-j9ur.f2.xano.io/api:_kH3DnKo/oauth/google/callback` |
| `MICROSOFT_CLIENT_ID` | ⏳ nog regelen | Azure AD App Registration Client ID (wacht op tenant) |
| `MICROSOFT_CLIENT_SECRET` | ⏳ nog regelen | Azure AD App Registration Client Secret |
| `MICROSOFT_REDIRECT_URI` | ⏳ nog regelen | `https://xrex-nmji-j9ur.f2.xano.io/api:_kH3DnKo/oauth/microsoft/callback` |
| `OPENAI_API_KEY` | ✅ reeds aanwezig | Embeddings + AI-suggesties (Batch 11 + 12) |

Google OAuth is klaar voor Batch 9. Microsoft OAuth nog te regelen via Azure (wacht op M365 developer tenant of gratis Azure-account).

### 10.6 Implementatiestatus april 2026 (dashboard + Xano)

- Xano `Authentication` API-groep bevat nu inbox endpoints voor:
  - `GET /email/messages`
  - `GET /email/messages/{message_id}`
  - `PATCH /email/messages/{message_id}`
  - `PATCH /email/messages/{message_id}/snooze`
  - `POST /email/send`
  - `GET/PUT /email/connections/{connection_id}/signature`
  - `GET/PUT /email/connections/{connection_id}/ai-config`
  - `GET/POST/PATCH/DELETE /email/routing-rules` varianten
- Xano inbox AI endpoints zijn toegevoegd:
  - `POST /email/messages/{message_id}/ai-suggest`
  - `POST /email/messages/{message_id}/ai-summarize`
  - `POST /email/messages/{message_id}/ai-sentiment`
  - `POST /email/messages/{message_id}/ai-categorize`
- Xano knowledge base endpoints zijn toegevoegd:
  - `GET/POST /kb/collections`
  - `GET/POST /kb/collections/{collection_id}/documents`
  - `DELETE /kb/documents/{document_id}`
  - `GET /kb/search` (basis retrieval voor RAG context)
- Xano tabellen zijn uitgebreid/aangemaakt:
  - `email_oauth_connection`: provider ondersteunt `outlook` en `gmail`, plus `signature_html` en `ai_config`; kolommen `is_enabled` en `is_primary` sturen sync en primaire mailbox per organisatie
  - `email_synced_message`: velden voor threading/status/labels/AI (`thread_id`, `conversation_status`, `assigned_to_user_id`, `labels`, `ai_summary`, `sentiment`, enz.)
  - Nieuwe tabellen: `inbox_routing_rule`, `kb_collection`, `kb_document`
- Dashboard `/communication` is gekoppeld aan live email data:
  - real mailbox-selectie via gekoppelde verbindingen
  - berichtenlijst en detail via `/email/messages`
  - workflow acties: lezen/ongelezen, sluiten/heropenen, snooze, labels, toewijzen
  - composer met reply/forward/note tabs en verzenden via `/email/send`
  - AI blok met suggestie + samenvatting/sentiment/categorisering en bronverwijzingen uit `kb/search`
- Dashboard `/settings/inbox` gebruikt nu live data:
  - mailboxverbindingen uit `/email/connections` (inclusief `is_enabled` en `is_primary` in het antwoord van de API waar ondersteund)
  - **`PUT /email/connections/{connection_id}/mailbox-settings`** (body `is_enabled`, `is_primary`): sync aan/uit; uitschakelen zet primair automatisch uit; nieuwe primaire mailbox wist primair bij andere verbindingen in dezelfde organisatie
  - signature editor gekoppeld aan `/email/connections/{id}/signature`
  - routing rules manager gekoppeld aan `/email/routing-rules`
  - AI mailboxconfig gekoppeld aan `/email/connections/{id}/ai-config`
  - knowledge base beheer (collecties/documenten) gekoppeld aan `/kb/*`

---

## 11. Cursor Agent Orchestra

Het platform gebruikt een geautomatiseerde build pipeline (Cursor Agent Orchestra) voor het bouwen van features uit de PRD. De orchestrator draait volledig in Xano en bestuurt Cursor Cloud Agents via de Cursor API.

- Pipeline state machine in Xano: PENDING → BUILDING → BUILD_DONE → TESTING → TEST_DONE → REVIEWING → REVIEW_DONE → DONE
- 3 agent-rollen: Builder (bouwt features), Tester (test TypeScript + build), Architect (beoordeelt architecturele fit)
- Webhook-driven: Cursor stuurt status-updates naar Xano die automatisch de volgende stap triggert
- 12 feature batches totaal (8 origineel + 4 inbox-uitbreiding)
- Monitor task: elke 5 minuten controle op vastgelopen agents (terminal state + advance)
- MCP server: `cursor_orchestra` voor pipeline control

### 11.1 MCP-gedreven autonomie (primaire methode)

**Architectuurkeuze (2 april 2026):** Agents communiceren nu rechtstreeks met Xano via MCP-tools in plaats van uitsluitend via externe webhooks. Dit elimineert webhook-delivery-problemen en race conditions.

**Hoe het werkt:**
1. Xano lanceert een Builder/Tester/Architect agent via de Cursor Cloud API.
2. De agent-prompt bevat altijd een "When You Are Finished" sectie die de agent instrueert een MCP-tool aan te roepen.
3. De agent roept de betreffende MCP-tool aan op de `cursor_orchestra` MCP server, waarop Xano direct de DB-status bijwerkt en `orchestra/advance` uitvoert.
4. De volgende agent wordt hierdoor automatisch gestart.

**Drie signal-tools op MCP server `cursor_orchestra` (id: 6):**
- `orchestra_signal_build_done` (tool id: 13) — Builder roept dit aan met `feature_id`, optioneel `pr_url` en `summary`. Zet status → `build_done`, triggert advance → Tester agent.
- `orchestra_signal_test_done` (tool id: 14) — Tester roept dit aan met `feature_id`, `verdict` (`pass`/`fail`), optioneel `issues` en `summary`. Zet status → `test_done`, triggert advance → Architect (pass) of fix loop (fail).
- `orchestra_signal_review_done` (tool id: 15) — Architect roept dit aan met `feature_id`, `verdict` (`approved`/`rejected`), optioneel `issues` en `summary`. Zet status → `review_done`, triggert advance → feature DONE of fix loop.

Alle drie tools zijn **idempotent**: als de feature al buiten de verwachte status is, retourneren ze `{ok: true, action: "already_transitioned"}` zonder fout of state-corruptie.

**MCP server registratie:** De `cursor_orchestra` MCP server is geregistreerd in cursor.com/agents als HTTP endpoint (bearer auth). Agents die door de orchestra worden gelanceerd ontvangen automatisch toegang.

### 11.2 Webhook + polling als vangnet

Naast de MCP-primaire methode blijft het webhook-systeem actief als fallback voor edge-cases.

- Webhook `POST /webhook/cursor` is **idempotent**: transitie alleen als feature in verwachte fase zit. Dubbele webhooks worden gelogd en genegeerd.
- Scheduled task `orchestra_monitor` draait elke 5 minuten en detecteert vastgelopen agents (>30 min in dezelfde fase zonder voortgang).
- Poller script `scripts/orchestra-cursor-poller.ps1` stuurt synthetische webhooks voor agents met status `FINISHED`/`ERROR`/`EXPIRED`.
- Handmatig: `POST .../pipeline/advance-now` met `{"pipeline_id": 1, "secret": "bokito-advance-now"}` om `orchestra/advance` geforceerd opnieuw te laten lopen.

---

## 12. Agentic Orchestration Platform (PRD V1)

Het platform wordt uitgebreid met een autonome agentic orchestration laag bovenop de bestaande CRM/NoCode/Inbox modules. Volledige PRD: `temp/PRD_V1_Agentic_Orchestration_Platform.md`.

### 12.1 Architectuur — Vier Lagen

| Laag | Beschrijving |
|---|---|
| **User Layer** | Personal Assistant per gebruiker (mobile, web, widget). Vertaalt NL-instructies naar taken. |
| **Orchestrator Layer** | Eén orchestrator per workspace. Strategie, routing, conflictresolutie, resource-allocatie. |
| **Domain Agent Layer** | Persistente agents per business domein (Sales, Support, Operations, Product, custom). |
| **Worker Layer** | Child agents (persistent, gespecialiseerd) en sub-agents (ephemeral, parallel, taak-gebonden). |

### 12.2 Agent Types

- **Personal Assistant**: 1 per user, interface naar het agentsysteem
- **Orchestrator**: 1 per workspace, top van de hiërarchie
- **Domain Agent**: persistent, bezit een business domein (Sales, Support, Operations, Product)
- **Child Agent**: persistent worker onder een domain agent, specialistisch
- **Sub-Agent**: ephemeral, gespawned voor parallelle taken, vernietigd na afronding

### 12.3 Agent Lifecycle

`draft` → `active` → `sleeping` ↔ `awake` → `deactivated` → `deleted`

### 12.4 Task System

- Task lifecycle: `created` → `queued` → `assigned` → `in_progress` → `blocked`/`completed`/`failed`/`cancelled`
- Task types: immediate, scheduled, recurring, blocking, delegated, reactive
- Delegation chain met max diepte (default 5)
- Execution modes: parallel, sequential, best_of_n
- Koppeling met CRM Taak tabel via `crm_task_id`

### 12.5 Agent Communication Protocol (8 message types)

1. **Ask Question and Await Input** — blocking vraag naar superior
2. **Ask Question and Continue** — non-blocking vraag, upgradable
3. **Check Open Questions** — controle voor idle/sleep
4. **Answer Question** — beantwoord vraag van subordinate
5. **Update Question** — wijzig vraag of blocking status
6. **Delegate Task** — async taak delegeren, spawnt sub-agents
7. **Plan Self Task** — plan wake-up op toekomstig tijdstip
8. **Plan Task for User or Agent** — plan taak voor ander agent of gebruiker

### 12.6 Trigger & Wake System

Trigger types: question, command, delegate, report, webhook, schedule, data_change, inbox_event, answer. Agents slapen tot een trigger ze wekt. Cooldown en deduplicatie voorkomen rapid-fire.

### 12.7 Data Model (nieuwe Xano tabellen)

| Tabel | Doel |
|---|---|
| `agent` | Agent definities (type, role, parent, capabilities, system prompt) |
| `agent_task` | Taak instances (lifecycle, delegatie-chain, resultaten) |
| `agent_message` | Inter-agent communicatie (vragen, antwoorden, delegaties) |
| `agent_trigger` | Trigger configuraties (wake conditions, cron, webhook) |
| `agent_memory` | Langetermijngeheugen met vector embeddings |
| `agent_log` | Immutable execution log (tool calls, tokens, kosten) |
| `agent_orchestrator_config` | Per-workspace orchestrator instellingen |

### 12.8 Integratie met bestaande modules

- CRM tabellen (Klant, Bericht, Taak) als read/write data voor agents
- Inbox als bidirectioneel kanaal (lezen, reply drafts, assign, label)
- Knowledge Base + Magic Tables als RAG context
- MCP tools als gedeelde tool registry
- REST API + webhooks als externe communicatie
- Permissies (RBAC) uitgebreid met agent-scoped rechten

### 12.9 Security & Limits

- Agent permissies zijn subset van creator's permissies
- Per-agent tool restrictions (tabel, mailbox, knowledge source scope)
- Token budgets: daily (500k default), monthly (10M default), per-task (50k)
- Max concurrent agents: 10 (default)
- Human-in-the-loop gates voor destructieve acties (delete, send email, schema wijziging)
- Alle acties gelogd in immutable `agent_log`

### 12.11 Feature Request + AI Roadmap Orchestrator (implementatie)

Het platform heeft nu een eerste werkende backlog/roadmap module waarmee workspace users feature requests, bugs en wijzigingsverzoeken kunnen indienen. Deze module wordt gebruikt om dezelfde flow te dogfooden die later aan klanten wordt verkocht.

**Nieuwe Xano tabellen:**
- `backlog_item` (id: 54): feature request records met type, priority, status, complexity, category, PRD mapping, queue position, sprint label, tags/dependencies en soft delete velden.
- `backlog_comment` (id: 55): discussies en AI-triage notities per backlog item.
- `backlog_config` (id: 56): per-organisatie backlog instellingen (`auto_triage`, `prd_context`, `default_model`, `sprint_labels`).

**Nieuwe API groep:**
- API groep `backlog` (id: 11, canonical: `K4L0GFXy`) met JWT-auth (`auth = "user"`), tenant scoping op `user.account_id` en endpoints:
  - `GET /backlog/items`
  - `POST /backlog/items`
  - `GET /backlog/items/{id}`
  - `PATCH /backlog/items/{id}`
  - `DELETE /backlog/items/{id}` (soft delete)
  - `GET /backlog/items/{id}/comments`
  - `POST /backlog/items/{id}/comments`
  - `POST /backlog/triage/{id}`
  - `PATCH /backlog/roadmap/reorder`
  - `GET /backlog/config`
  - `PATCH /backlog/config`

**AI triage functie:**
- Nieuwe functie `backlog/ai_triage` (id: 29).
- Gebruikt OpenAI Chat Completions (`$env.OPENAI_API_KEY`) met JSON-output om `type`, `priority`, `complexity`, `category`, `prd_section` en `ai_summary` te bepalen.
- Heeft fallback heuristiek wanneer AI response faalt of malformed is, zodat triage altijd doorgaat.
- Schrijft AI-resultaat terug naar `backlog_item` en voegt een `is_ai=true` comment toe in `backlog_comment`.

**Dashboard UI:**
- De eerdere route `apps/dashboard/src/pages/Roadmap.tsx` op `/roadmap` is verwijderd uit het dashboard.
- De sidebar bevat geen `Roadmap` navigatie-entry meer.
- UI bevat drie views:
  - Submit Request (feature/alteration/bug intake)
  - Backlog lijst (selecteren, re-triage, delete)
  - Roadmap board (status-kolommen met queue reorder acties)

**Tenant dogfooding (Bokito AI):**
- `backlog_config` is ge-seed voor organisatie/account `bokito-ai` (`organisation_id = 3`).
- De 12 bestaande `orchestra_feature` batches zijn gemigreerd naar `backlog_item` als initiële roadmap records.

---

### 12.12 Autonome Dirigent Agent (portal feature first)

Het platform heeft nu een eerste autonome dirigent-laag die als productfeature in de portal beheerd wordt en de bestaande orchestra-flow self-healing ondersteunt.

**Nieuwe Xano tabellen:**
- `agent_orchestrator_config` (id: 57): per organisatie policy (`enabled`, `autonomy_level`, `check_interval_sec`, `max_retry_per_feature`, `allow_verdict_override`, `sleep_mode`, `last_wake_at`, `next_wake_at`).
- `agent_task` (id: 58): geplande en uitgevoerde dirigent-cycli (`wake_check`, `scheduled_check`, `recovery_action`) met status/audit.
- `agent_log` (id: 59): immutable audittrail van autonome acties.
- `agent_trigger` (id: 60): trigger-queue voor eventgedreven wakes.

**Uitbreiding bestaande orchestration tabellen:**
- `orchestra_feature` uitgebreid met `last_auto_action`, `auto_action_count`, `last_auto_action_at`, `auto_lock_until`.
- `orchestra_pipeline` uitgebreid met `autonomous_mode`, `last_auto_check_at`, `next_auto_check_at`.

**Nieuwe functies en scheduler:**
- Functies: `agent/log_event`, `agent/dirigent_scan_pipeline`, `agent/dirigent_plan_actions`, `agent/dirigent_execute_actions`, `agent/dirigent_sleep_schedule`, `agent/dirigent_wake`.
- Scheduled task: `dirigent_scheduler` (elke 120s) verwerkt onbewerkte triggers, due scheduled checks en safety wakes.
- De dirigent kan autonome acties uitvoeren zoals pipeline advance, state normalisatie en verdict-overrides (op basis van policy).

**Portal beheerlaag:**
- Nieuwe API group `orchestrator_control` (id: 12, canonical: `BWK_e0qC`) met user-auth endpoints:
  - `GET/PATCH /workforce/config`
  - `GET /workforce/status`
  - `POST /workforce/force-wake`
  - `POST /workforce/force-rescan`
  - `POST /workforce/pause`
- Nieuwe dashboardpagina `apps/dashboard/src/pages/OrchestratorControl.tsx` op route **`/workforce`** (oude pad `/orchestrator` redirect naar `/workforce`).
- Workforce is de primaire sidebar-entry voor orchestratie; het oude Workforce legacy submenu is verwijderd.

**Dogfooding activatie (Bokito tenant):**
- `agent_orchestrator_config` ge-seed voor `organisation_id = 3` met `enabled = true`, `autonomy_level = full`, `allow_verdict_override = true`, `check_interval_sec = 120`.
- `orchestra_pipeline` id `1` staat op `autonomous_mode = true`.

---

### 12.13 Orchestrator Agent Canvas (hiërarchische agentweergave in portal)

De orchestrator-pagina gebruikt een hiërarchische full-canvas visualisatie die de agentstructuur toont als verticale keten (Assistent → Manager → rij met **Productowner** en **Legal verantwoordelijke** naast elkaar). De fan-out en het **Builder/Tester/Auditor**-grid staan in de **linkerkolom** onder Productowner (lijn sluit aan op PO); Legal staat rechts op dezelfde rij als Productowner zonder child-agents. **Legal, Tester, Auditor en sub-builders** gebruiken hetzelfde **Lucide Bot**-icoon als de andere agentkaarten (geen weegschaal-SVG meer). Legal heeft geen child-agents in de UI; status (Active/Paused) volgt dezelfde orchestrator-runstate als Productowner.

**Dashboard UI:**
- `apps/dashboard/src/pages/OrchestratorControl.tsx` toont standaard direct de full-canvas weergave zonder linker boventabs (`Control` / `Agent Canvas`).
- De control-instellingen openen via de `Control` knop rechtsboven in de canvas en sluiten via `Terug naar canvas`.
- Er is een extra `Assistent` configuratieview binnen `/workforce`, bereikbaar via de `Assistent` knop rechtsboven in de canvas.
- De assistentconfig in `/workforce` gebruikt een editor-layout met inklapbare panelen (`Uiterlijk`, `Begroeting`, `Launcher`, `Systeem`, `Embed`), een agent-achtige headerkaart, en een vaste ondertoolbar met `Run`, `Config`, `Logs`, `Reset`, `Opslaan`.
- De assistentconfig wordt lokaal opgeslagen onder `orchestrator_assistant_config` en bevat o.a. naam, model, taal, temperature, wake template en visual/launcher/system prompt instellingen.
- De canvasweergave op `/workforce` gebruikt de volledige beschikbare paginahoogte en rendert alles binnen één canvaskaart.
- `Feature Queue` staat als smalle linker side-menu in de canvas; `Activity History` staat als smalle rechter side-menu in de canvas (onder de realtime/wake knoppen).
- De titel linksboven in de canvas gebruikt tenantcontext en toont `{tenant name} Workforce` boven de `Feature Queue`.
- De verbindingsstatusbadge (`Live`/`Polling`) staat links naast de workforce-titel; rechts bij de knopgroep staat geen tweede statusbadge.
- In de `Feature Queue` side-menu staat geen directe `Feature request` knop naar een losse roadmappagina.
- De `Feature Queue` op `/workforce` kan handmatig op PRD-restpunten worden gezet: runtime queue-items worden dan vervangen door een vaste lijst met open PRD-punten, opgesplitst in `te_implementeren`, `te_testen` en `te_auditen`.
- Triggeren van de `Productowner` in de workforce-canvas gebruikt een specifieke sequentieprompt: eerst queue ophalen, daarna per feature 1-voor-1 delegeren naar `Builder` (implementatie), `Tester` (verificatie) en `Auditor` (audit), met terugkoppellus bij fail/blockers.
- Bij `Trigger` op een agentkaart opent de UI een modal met een vrij instructieveld voor die specifieke agent; bij leeg invoeren valt het systeem terug op de standaard rolinstructie.
- Runtime-status op `/workforce` markeert een agent pas als echt `Actief` wanneer er een executing activity **met sessie-check-in** is (`activity.session_id` of `agent.current_session_id`). Bij alleen `trigger-agent` zonder sessie-check-in toont de UI `Check-in wachtend` met statusregel `Wacht op check-in vanuit Cursor Cloud Agent`.
- Onderaan de canvas staat een workforce-achtige `Timeline` met horizontale duursegmenten op de tijd-as.
- De `Timeline` gebruikt nu een interactief tijdvenster (ingezoomde default) in plaats van altijd de volledige dagbreedte.
- Bij laden wordt de huidige tijd (`Nu`) in het midden van de timeline viewport gezet.
- Gebruikers kunnen horizontaal over de timeline draggen/pannen (grab/grabbing) om door de tijd te navigeren; pointer-capture cleanup op `pointerup`/`pointercancel`/`lostpointercapture` voorkomt vastlopende dragstates.
- Segmenten worden geclipt op de viewportgrenzen; lopende items renderen als `actual_start -> now`.
- Uurmarkeringen worden dynamisch berekend op basis van het huidige viewportvenster.
- De `Timeline` toont een verticale `Nu`-markering over de tijd-as, zodat de huidige tijd direct zichtbaar is t.o.v. geplande en lopende items.
- In `Timeline` staan de uur-labels onderaan, zodat de swimlanes bovenin meer verticale ruimte krijgen.
- Hover op een timelinesegment toont uitgebreide timingdetails: `Planned start/end`, `Actual start/end`, status en berekende duur.
- Hover op een timelinesegment benadrukt de bijbehorende agentkaart in de hiërarchie (accent ring); koppeling loopt via `activity.agent_id` naar de agent `id`. De markering verdwijnt bij pointer-leave op het segment en bij start van timeline-pannen (drag).
- Kleurcodering in `Timeline`: planned/queued = paars, current/in_progress = groen, done/completed = gedimd groen, failed = rood.
- Het centrale agent-hierarchieblok zit in een **max-breedte container** (`max-w-3xl`) met **verticale scroll** in het middenvak; vertakte verbindingen zijn **één SVG-pad per niveau** (`TreeForkTwo` manager→PO/Legal, `TreeForkThree` PO→builder/tester/auditor) plus ronde **`TreeStem`**-segmenten, zodat lijnen visueel aansluiten en meeschalen met `w-[min(100%,…)]` i.p.v. losse absolute `div`-lijntjes met vaste pixelbreedtes. De rij met drie workerkaarten **wrapt** (`flex-wrap`) op smalle breedtes.
- Rechtsboven in de canvas staat een `Control` knop die direct terugschakelt naar de `Control` tab op `/workforce`.
- `Activity History` is een scrollbare feed met een verticale gradient-lijn door het midden van een vaste rail (`w-5`); stippen zitten gecentreerd op die lijn en krijgen kleur/ring op basis van logniveau (`error`/`warn`/`info`). Kopregels met patroon `Rol: titel` tonen een compacte rol-badge plus titel; andere regels blijven één regel. Rijen hebben lichte hover-achtergrond; de paneelkop toont een `Activity`-icoon en een teller-badge.
- De hoofd-canvas op `/workforce` rendert edge-to-edge binnen de parent (zonder linker/rechter ruimte), zonder rounded corners en met een fijn mini-dot raster als achtergrond.
- De losse `Last updated` regel onder de canvas is verwijderd om onnodige verticale ruimte onderaan te voorkomen.
- Bovenaan is er een expliciete verticale connectorlijn van `You` naar de `Assistent` node.
- Connectorlijnen in de workforce-tree worden berekend op basis van **exacte kaartcentra** (boven en onder): de vertakkingspunten sluiten altijd aan op het midden van de parent- en child-kaarten, ook bij verschillende cardbreedtes (manager/productowner/legal vs builder/tester/auditor).
- Agentnodes hebben workforce-achtige hover-acties (Run/Wake, Config, Logs), dikkere omlijning en het `AGENT BOT ICON` als node-icoon.
- Agentstatus wordt visueel getoond met kleur + statusdot; badges op kaarten tonen alleen statussen met semantische labels (`Active`, `Delegated`, `Paused`, `Error`).
- Agentcards in de canvas gebruiken een grotere, vrijstaande avatar (zonder icoon-achtervlak), gecentreerde tekst en smallere cardbreedte voor een compactere hiërarchie; de rolregel wordt alleen getoond wanneer die afwijkt van de agentnaam (geen dubbele `Manager` + `Manager`).
- Voor actieve agentnodes toont de activiteitstekst onder de naam een draaiende loader-indicator, zodat zichtbaar is dat de agent live bezig is met de huidige taak.
- De vaste `Wake` knop rechtsboven in de canvas is vervangen door een statusafhankelijke actieknop: `Pause` wanneer de workforce actief is en `Wake` wanneer de workforce gepauzeerd is.
- De canvas toont geen aparte workforce-runstate badge meer in de header; runstate blijft zichtbaar op agentniveau (bijvoorbeeld `Paused` subtitle op relevante nodes).
- De workforce-canvas draait altijd periodieke API refresh als vangnet (sneller interval bij geen websocket-verbinding), zodat status/timeline/history blijven updaten wanneer realtime socket tijdelijk instabiel is.
- Hiërarchie-styling: Assistent = accent + chatwolk-icoon; **actieve** builder = success-groen (rand, dot, icoon, titel, subtitel, loader); **gedelegeerd** = accent (paars); **fout** = error-rood. **`inactive` en `paused`**: rand `border-border` en icoon + titel + rol + subtitel in een neutrale, goed leesbare grijstint (`text-text-muted`) zodat kaarten duidelijk grijs blijven zonder fletse/doorzichtige indruk. Manager/Productowner met delegated tonen vaste ondertitel **Delegated task** waar van toepassing; actieve agents tonen een loader naast de activity-regel wanneer er wél een actieve taak is.
- De child-agents van Productowner (`Builder`, `Tester`, `Auditor`) blijven op dezelfde horizontale rang (`flex-nowrap`); op smallere viewport ontstaat horizontale overflow i.p.v. verticaal stapelen.
- De header-badge toont verbindingsmodus als `Live` (websocket actief) of `Polling` (fallback refresh actief).

**Frontend graph/realtime modules:**
- `apps/dashboard/src/components/orchestrator/AgentCanvasMermaid.tsx` rendert de hiërarchische canvas op basis van workforce statusdata en realtime events.
- `apps/dashboard/src/lib/workforce-graph.ts` levert state mapping van API-status en event-delta's naar UI-agentstatussen.
- `apps/dashboard/src/lib/workforce-realtime.ts` beheert Xano realtime websocket connectie op channel-niveau met reconnect/backoff.
- Als de socket sluit **zonder** ooit `open` te hebben bereikt (typisch: `/realtime` handshake issue), zet de client tijdelijk een korte cooldown in `sessionStorage` (`bokito_workforce_realtime_unavailable`) en probeert daarna automatisch opnieuw met reconnect/backoff. Er is dus geen permanente tab-lock meer na een enkele mislukte handshake. Optioneel: in `.env.local` zetten `VITE_DISABLE_WORKFORCE_REALTIME=true` of `VITE_DISABLE_ORCHESTRATOR_REALTIME=true` (legacy) om realtime volledig over te slaan.
- Realtime diagnose (3 april 2026): directe probe naar `wss://xrex-nmji-j9ur.f2.xano.io/realtime?channel=workforce/{organisation_id}` vanaf de devmachine geeft geen websocket-upgrade (`non-101 status`); de HTTP-variant op `/realtime` levert de Xano frontend-HTML i.p.v. een websocket handshake. In deze situatie blijft de Workforce UI in `Polling` fallback.

**Fallback gedrag:**
- Als `graph-snapshot` endpoint nog niet beschikbaar is, bouwt de frontend een baseline graph uit `GET /workforce/status` (pipeline + recente taken).
- Als `graph-resync` niet beschikbaar is, gebruikt de frontend `POST /workforce/force-rescan` als fallback resync-trigger.

**Realtime channel convention:**
- De Workforce canvas luistert op tenantniveau naar Xano Realtime channel `workforce/{organisation_id}` (een stabiele websocket per tenantweergave).
- Runtime APIs en MCP runtime-tools publiceren updates op `workforce/{organisation_id}` met payloads voor `agent_updated`, `activity_updated`, `task_updated` en `message_created`.
- In Xano Realtime kanaalconfiguratie staat channel `workforce` met `Enable Nested Channels` ingeschakeld, zodat clients op `workforce/{organisation_id}` kunnen subscriben.

**Workforce realtime debugging (frontend):**
- De realtime client ondersteunt diagnostiek-events (`connect_attempt`, `close`, `error`, `cooldown`, `fallback_without_token`, `give_up`) die in de Workforce header als debugregel getoond worden wanneer de status niet `Live` is.
- De websocket-URL is overschrijfbaar via `.env` (`VITE_WORKFORCE_REALTIME_WS_URL` of `VITE_WORKFORCE_REALTIME_PATH`; legacy aliases `VITE_ORCHESTRATOR_REALTIME_WS_URL`/`VITE_ORCHESTRATOR_REALTIME_PATH` blijven ondersteund).
- Extra optie: `.env` `VITE_WORKFORCE_REALTIME_CANONICAL` (of legacy `VITE_ORCHESTRATOR_REALTIME_CANONICAL`) bouwt automatisch websocket pad `.../rt/{canonical}` (Xano SDK-transport).
- Bij een mislukte handshake vóór `open` probeert de client éénmalig opnieuw zonder `token` queryparam om auth-problemen te onderscheiden van transport/proxy-problemen; daarna valt hij terug op de bestaande cooldown/backoff.
- Auth-context ondersteunt nu een apart realtime-token uit login/refresh responses (`realtimeAuthToken`, `realtime_auth_token` of `realtime_token`) en bewaart dit als `bokito_realtime_auth_token`; Workforce gebruikt dit token voor websocket-auth en valt terug op het reguliere access token als geen realtime-token beschikbaar is.
- In de Workforce header staat een `Realtime test` knop die meerdere websocket-URL-varianten (canonical/path/legacy met en zonder token) kort probeert en de resultaten (`OPEN`, `ERROR`, `CLOSED (code)`, `TIMEOUT`) in een compact diagnostiekpaneel toont.
- Login-debug op 3 april 2026 (accounttest): `POST /api:DavdZOps/auth/login` retourneert momenteel alleen `authToken` en `user_id` (geen realtime-token velden). Voor deze workspace werkt realtime-transport via `wss://<instance>/rt/{canonical}` met JWT als WebSocket subprotocol; de oude `/realtime?...&token=...` queryvorm geeft non-101 / browser close code `1006`.
- Login-incident op 4 april 2026 (portal): in sommige flows faalt de vervolgcalls voor profiel (`GET /auth/me`) met backendmelding `Value is not a valid integer.` terwijl credentials correct zijn. Frontend gebruikt daarom een fallback-profiel op basis van login payload zodat gebruikers toch kunnen inloggen.
- Workforce statussemantiek (3 april 2026): een agent telt alleen als `Actief` wanneer er een live cloud agent sessie is (`current_session_id` of `current_activity_id`). Als backendstatus `active` is zonder live sessie toont de UI `Activeren`; overige niet-foutstaten tonen `Uitgeschakeld`.
- Statusuitbreiding: parent-agents zonder eigen live sessie kunnen status `Awaiting` tonen wanneer een direct child-agent `Actief` of `Activeren` is; subtitle gebruikt patroon `Awaiting {child agent}`.
- Visual state update: `Activeren` rendert lichtgroen (geen blauw) met pulse op de statusdot om overgang naar live sessie visueel te markeren.
- UI-safety bij stale runtimedata: `executing` timeline-items van agents die niet `Actief` zijn worden in de feature queue als `planned` getoond; voor `Gepauzeerd/Uitgeschakeld` wordt oude `current_activity_summary` niet als actieve runtime-samenvatting gebruikt.

### 12.7 Agent Runtime Model (rebuild)
- Het orchestration datamodel is opnieuw opgebouwd rond runtime actor-entities: `agent`, `agent_session`, `activity`, `task`, `message`, `agent_log`, `tool`, `agent_tool`, `event`.
- Het model gebruikt nu een tenant-configureerbare `role` tabel; agenten verwijzen naar rollen via `agent.role_id` (de oude enum-kolom `agent.role` is verwijderd).
- Het platform gebruikt nu `agent_session` voor sessies per cloud agent run en `activity` als primaire bron voor live status + timeline-items.
- `agent.current_activity_summary` is de live statusregel onder agentnamen op de canvas; deze wordt bijgewerkt door MCP tools.
- Voor tenant `Bokito AI` zijn rollen en agenten opnieuw gestructureerd als boom: `Manager` (root), daaronder `Productowner` en `Legal verantwoordelijke`, en onder `Productowner` de uitvoerende agenten `Builder`, `Tester`, `Auditor`.
- Nieuwe API-group `agent_runtime` levert runtime data voor de canvas: `GET /agents`, `GET /agents/{agent_id}/sessions`, `GET /agents/{agent_id}/activities`, `GET /timeline`.
- `GET /agents` verrijkt agentresultaten met `role_name` en `role_slug` via join op de `role` tabel.
- Nieuwe endpoint `PATCH /agents/{agent_id}/status` werkt agentstatus (`idle|active|sleeping|error|paused`) bij en publiceert direct een realtime `agent_updated` event op `workforce/{organisation_id}`.
- Voor runtime-tabellen met optionele FK-velden (`task`, `message`, `activity`, `agent_log`) moeten optionele UUID-kolommen als nullable staan; anders falen inserts met `SQL 22P02 INVALID TEXT REPRESENTATION` zodra een optioneel veld leeg/default is.
- Demo-seed voor workforce observability gebruikt combinatie van `task` + `message` + `activity` + `agent_log`: een geplande taak op +10 minuten (type `scheduled`), actieve manager-activity en geplande builder-activity zodat timeline zowel verleden, live als toekomst toont.
- Nieuwe MCP server `agent_orchestra` exposeert tools voor session/activity/task/messaging/lifecycle (`start_session`, `end_session`, `create_activity`, `update_activity_status`, `complete_activity`, `create_task`, `assign_task`, `update_task`, `complete_task`, `delegate_task`, `send_message`, `wake_agent`, `sleep_self`, `schedule_wake`).
- `create_task` ondersteunt `planned_end` en bewaart planning-context (`planned_start`/`planned_end`) voor downstream timeline-interpretatie.
- `create_activity` functioneert als check-in voor uitvoerende werkfase: zet `started_at` (actual start), markeert gekoppelde task als `in_progress` en activeert de agentstatus.
- `complete_activity` functioneert als checkout: zet `ended_at` (actual end), sluit optioneel de sessie af, zet gekoppelde task op eindstatus, rapporteert optioneel upstream via `message` en zet de agent terug naar `standby`.
- MCP runtime-tools publiceren realtime events op channel `workforce/{organisation_id}` met event types zoals `agent_updated`, `activity_updated`, `task_updated`, `message_created`.
- Runtime agentstatus is gemigreerd naar `standby|active|sleeping|error`; legacy `paused` en `idle` zijn vervangen door `standby` voor de workforce flow.
- `POST /workforce/force-wake` is vereenvoudigd naar manager wake-policy: de endpoint activeert de manager en publiceert een `agent_updated` event, zonder delegated task/activity creatie.
- Endpoint `POST /workforce/trigger-agent` start directe uitvoering op een doelagent door eerst een echte Cursor Cloud run te starten via `POST https://api.cursor.com/v0/agents` (met repository/ref/model/webhook uit agent-config en env), daarna pas `agent_session` + `task` + `activity` te maken en `agent.current_session_id/current_activity_id` te koppelen.
- `POST /workforce/trigger-agent` verrijkt de launch prompt nu met een verplichte runtime-SOP: eerst check-in via `cloud_agent_tools` (`CA Get Context`, `CA Set Active`), daarna uitvoeren, en bij afronding MCP-signaling met `workforce_get_agent_activities` + `workforce_complete_activity` (indien `bokito-workforce` tools beschikbaar zijn).
- `POST /workforce/trigger-agent` ondersteunt weer webhook-launchmodus wanneer `CURSOR_WORKFORCE_WEBHOOK_URL` of `ORCHESTRA_WEBHOOK_URL` beschikbaar is; bij ontbrekende webhookconfig blijft een no-webhook fallback actief zodat launches niet blokkeren.
- Nieuwe endpoint `POST /workforce/focus-update` werkt live focusstatus bij voor actieve activiteiten: update van `activity.status_detail`, `agent.current_activity_summary`, realtime events (`activity_updated`, `agent_updated`) en persistente `agent_log` records.
- Focus-heartbeat policy: bij `source = heartbeat` en een update-gap groter dan 20 seconden markeert het backend-log de update als `heartbeat_warning` (`level = warn`) zodat Activity History en Agent Log voortgangsvertraging zichtbaar maken.
- De lokale MCP server `bokito-workforce-mcp` exposeert nu tool `workforce_update_focus` voor agents om focuswissels en 20s-heartbeats expliciet te signaleren tijdens uitvoering.
- Triggerprompt-optimalisatie (workforce runtime): de launch prompt stuurt agents nu eerst naar check-in + directe `workforce_update_focus` (`Initializing`), vereist focus-switch updates en 20s-heartbeats, en bevat expliciete guardrails voor niet-coding requests (direct antwoord, geen brede repo-scan, geen ongevraagde file/commit/PR-acties).
- Endpoint `POST /workforce/complete-activity` rondt uitvoering af met sessie-checkout: zet activity naar terminale uitkomst, zet gekoppelde task terminal, sluit `agent_session` (status + `ended_at` + `summary`) wanneer aanwezig, zet agent terug naar `standby`, en wist `current_session_id/current_activity_id`.
- Endpoint `POST /workforce/maintenance-run` voert stale cleanup + retries uit (default stale > 15 min): markeert stale executing activity als failed, plant retry met backoff (30s/120s) zolang `retry_attempt < max_attempts`, en zet agent terug naar `standby`.
- `GET /workforce/status` is vereenvoudigd naar runtime-bronnen (`task`, `agent_log`, managerstatus) en retourneert stabiel `pipelines`, `recent_tasks` en `recent_logs` zonder legacy referenties.
- `GET /timeline` en `GET /agents/{agent_id}/activities` in API group `agent_runtime` gebruiken nu directe `activity`-query zonder verplichte `agent_session`-join, zodat geplande delegaties zonder sessie direct zichtbaar blijven in timeline en delegated-status.
- Er is een lokale stdio MCP package `packages/bokito-workforce-mcp` die workforce-operaties op Xano uitvoert via `api:BWK_e0qC` (orchestrator) en `api:_NUMR_yJ` (runtime). De server gebruikt env-token auth (`BOKITO_WORKFORCE_MCP_TOKEN` of alternatieven) en is tenant-scope per token, zodat productie multi-tenant wordt ingericht met aparte token/config per tenant.

---

## 13. Toekomstige Functionaliteiten (Roadmap)

- Marketplace voor kant-en-klare agent templates
- Stem-interface voor de conversational agent
- Autonome multi-step workflows
- Diepere integraties (Slack, Teams, Google Workspace)
- AI-samenwerking tussen meerdere agents
- Alle stub-modules volledig implementeren
- WhatsApp Business kanaal voor inbox
- Live chat widget integratie met inbox
- Agentic orchestration platform implementatie (PRD V1)

---

## 14. API Groepsstructuur (mei 2026)

Xano workspace `Bokito AI app` gebruikt nu een geconsolideerde API-groepsindeling met semantische canonicals.

- `api:app`: centrale applicatiegroep voor members/accounts, custom-db, backlog en workspace endpoints (geen auth-routes).
- `api:integrations`: integratiegroep voor email/OAuth/inbox-integratie endpoints.
- `api:auth`: dedicated authgroep voor alleen authenticatie- en profielgerelateerde endpoints.
- `api:DavdZOps`: tijdelijke legacy compat-groep toegevoegd voor oudere portal bundles die nog hardcoded naar `https://xrex-nmji-j9ur.f2.xano.io/api:DavdZOps/...` wijzen.
- `api:workforce`: centrale workforcegroep voor orchestra/workforce-control/agent-runtime endpoints.
- `api:livechat`: livechat en widget-endpoints.
- `api:logs`: event logs.
- `api:bakermat`: Bakermat configurator en bijbehorende endpoints.

Dashboard frontend-richtlijn:

- API-routes worden dynamisch opgebouwd via `VITE_XANO_BASE_URL` + group canonical + endpoint path.
- Group canonicals zijn env-gedreven via:
  - `VITE_API_GROUP_APP`
  - `VITE_API_GROUP_AUTH`
  - `VITE_API_GROUP_INTEGRATIONS`
  - `VITE_API_GROUP_WORKFORCE`
  - `VITE_API_GROUP_LIVECHAT`
  - `VITE_API_GROUP_LOGS`
  - `VITE_API_GROUP_BAKERMAT`
- Publieke docs-URL gebruikt `VITE_PUBLIC_API_URL` i.p.v. hardcoded hoststrings.
- Auth BFF-proxy (`/api/auth/*`) rewrite gebruikt `VITE_API_GROUP_AUTH` als canonical fallback.
- Legacy compat voor oude production bundle: `api:DavdZOps` bevat nu alias endpoints `POST /auth/login`, `GET /auth/me`, `POST /auth/handoff/create`, `POST /auth/handoff/exchange` zodat login blijft werken zolang de oude frontendbundle nog actief is.
- Voor legacy email/inbox-compat in dezelfde oude bundle bevat `api:DavdZOps` nu ook `GET /email/connections`, `DELETE /email/connections/{connection_id}`, `GET /email/oauth/start`, `GET /email/outlook/oauth/start` en `GET /email/google/oauth/start` (met centrale `api:integrations` callbacks voor provider redirects).
- `GET /email/oauth/start` (provider `outlook` of `gmail`) bouwt de provider authorize-URL met `redirect_uri` uit Xano env (`MICROSOFT_REDIRECT_URI` resp. `GOOGLE_REDIRECT_URI`), RFC 3986-encoded; state-rij bevat `feature` (`outlook-email` / `gmail-email`). Zelfde env-waarden moeten exact overeenkomen met de geregistreerde redirect URI in Entra / Google Cloud.
- `GET email/outlook/oauth/start` en `GET email/google/oauth/start` gebruiken dezelfde env-redirects (plus preconditions dat de env gezet is); token exchange in `GET /oauth/microsoft/callback` en `GET /oauth/google/callback` gebruikt dezelfde env-waarde in de token-POST `redirect_uri` als bij de authorize-stap.
- Profielfoto-upload gebruikt de authgroep endpoint `POST /users/me/avatar` (met fallback naar `POST /avatar` voor backward compatibility binnen `api:auth`).
- Avatar upload-endpoints gebruiken `input file avatar` + `storage.create_image` en patchen daarna `user.avatar`; directe patch van ruwe input zonder opslag geeft in de praktijk lege avatar-objecten terug (`path: ""`, `size: 0`).
- Workspace-branding gebruikt appgroep endpoints:
  - `GET /workspaces` retourneert workspace `id`, `name`, `slug`, `logo`, `favicon`, `brand_color`.
  - `POST /workspaces/{workspace_id}` voor naam/subdomein/kleur updates (`subdomain` is verplicht).
  - `POST /workspaces/{workspace_id}/branding` voor gecombineerde branding update inclusief optionele `file logo` en `file favicon` (`subdomain` is verplicht).
- De pagina `/settings/branding` doet nu een echte API-save naar `/workspaces/{workspace_id}/branding` (multipart) voor naam/subdomein/kleur/logo/favicon, en refresht daarna `workspaces` + `auth/me` context.
- Tenant branding ondersteunt een aparte favicon uploadflow (los van logo) met preview en opslag in `organisation.livechat_settings.favicon`.
- Praktijkbeperking: Xano `storage.create_image` accepteert niet alle image-extensies (o.a. ruwe SVG kan falen met `Invalid file extension`); dashboard branding upload ondersteunt nu SVG door deze client-side om te zetten naar PNG vóór upload, met behoud van PNG/JPG/JPEG/GIF/WebP ondersteuning.
- Workspace media-URL's (`logo`, `favicon`) worden frontend-side genormaliseerd naar absolute URL's op basis van `XANO_BASE_URL` wanneer Xano alleen een relatief `path` terugstuurt, zodat previews consistent renderen in settings.
- Subdomeinbeleid: `subdomain` is tenantbreed verplicht en uniek. Backend valideert formaat (`[a-z0-9-]`, 3-63 chars, niet starten/eindigen met `-`) en blokkeert duplicaten.
- Hostmodel: dashboard draait tenant-first op `<subdomain>.bokito.ai` met centrale login op `app.bokito.ai`.
- Unauthenticated requests op tenant-host worden via `ProtectedRoute` doorgestuurd naar `https://app.bokito.ai/login?return_to=<absolute-tenant-url>`.
- Na succesvolle login op `app.bokito.ai` navigeert de portal terug naar `return_to` (zelfde root domein), zodat de sessie direct op tenant-host verdergaat.
- WorkspaceContext lockt op tenant-host op de workspace waarvan `slug == host subdomain`; cross-tenant switch op een tenant-host wordt genegeerd.
- Livechat `POST /api:livechat/session/start` ondersteunt `tenant_subdomain`; bij aanwezigheid valideert backend dat de agent echt bij die tenant-subdomein hoort, anders volgt `Tenant not found for this subdomain`.

*Laatste update: 10 mei 2026 — OAuth centrale callbacks en unified `email/oauth/start` gebruiken `MICROSOFT_REDIRECT_URI` / `GOOGLE_REDIRECT_URI` voor authorize en token exchange; API-groepen geconsolideerd naar `app/auth/workforce/livechat/logs/bakermat`.*

---

## 15. Xano tabel-audit (8 mei 2026)

Workspace `1` (`Bokito AI app`) bevat meerdere datadomeinen naast elkaar: portal/auth, livechat, workforce, custom database, backlog en integraties.

### Waarschijnlijk actief en leidend

- Auth/tenant: `user`, `organisation`, `auth_handoff`, `system_event_log`.
- Livechat: `conversation`, `message`, `customer`, `attachment`, `bot_agent`, `bot_agent_tool`, `tool_registry`.
- Workforce: `agent`, `agent_session`, `activity`, `st_task`, `agent_log`, `user_role`.
- Custom DB builder: `custom_table`, `custom_field`, `custom_record`, `custom_view`.
- Backlog: `backlog_item`, `backlog_comment`, `backlog_config`.
- Scraped docs/KB pipeline: `doc`, `doc_page`, `doc_section`.

### Gevonden overlap of legacy-kandidaten

- `agent_conversation` + `agent_message` lijken legacy naast `conversation` + `message` (eerste set leeg, tweede set gevuld).
- `tool` + `agent_tool` lijken legacy naast `tool_registry` + `bot_agent_tool` (eerste set leeg, tweede set gevuld).
- `knowledge_base` lijkt legacy naast `doc/doc_page/doc_section` (knowledge_base leeg, docs-tabellen gevuld).
- `kb_collection` + `kb_document` zijn aanwezig maar leeg; mogelijk oud upload-pad dat nu niet gebruikt wordt.

### Leeg/laag-gebruik op auditmoment (niet direct verwijderen zonder dependency-check)

- Leeg gezien: `collaboration`, `system_program_file`, `system_event`, `agent_conversation`, `agent_message`, `knowledge_base`, `kb_collection`, `kb_document`, `conversation_memory`, `bot_agent_identity_config`, `tool`, `agent_tool`, `email_oauth_connection`, `email_synced_message`, `user_session`.
- Let op: leeg betekent niet automatisch overbodig (sommige tabellen zijn runtime/transient of feature-flagged).

### Opschoonvolgorde (veilig)

1. **Dependency scan** per kandidaattabel in APIs, functions, tasks, tools en triggers.
2. **Soft-deprecate**: markeer legacy-tabellen intern en stop nieuwe writes.
3. **Observatieperiode** (bijv. 14 dagen) met write-monitoring.
4. Pas daarna pas **hard delete** van tabellen die aantoonbaar geen reads/writes meer hebben.

### Uitgevoerd: overlap cleanup (8 mei 2026)

- Hard verwijderd na dependency-check en lege datasets: `agent_conversation`, `agent_message`, `tool`, `agent_tool`, `knowledge_base`.
- `search_knowledge_base` tool is gemigreerd van `knowledge_base` naar `doc_section` (tenant-scoped via `conversation.organisation_id`) en retourneert nog steeds top-3 relevante passages.
- Canonieke modellen voor chat/tooling blijven: `conversation` + `message` en `tool_registry` + `bot_agent_tool`.
- `system_event` is **niet** verwijderd; dit model blijft functioneel los van audit logging in `system_event_log`.
