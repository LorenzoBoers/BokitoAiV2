# Operator UX-walkthrough — uitgebreide bevindingen

**Datum:** 27 september 2026  
**Persona:** nieuwe operator / eigenaar van een AI-gedreven MKB (bijv. accountancy of dienstverlening) die de business wil sturen vanuit communicatie met klanten en agents.  
**Omgeving:** ingelogde sessie op local-dev (`http://127.0.0.1:5173`). Productie (`app.bokito.ai`) toonde login (build `33ba9c1`); geen credentials in deze sessie. Bevindingen gaan over product/UX, tenzij expliciet “demo-data” staat.

**Doel van dit document:** inventaris voor latere keuzes. Geen fixes hier. Prioriteit: **P0** blokkeert de kernjob · **P1** sterke frictie of vertrouwensbreuk · **P2** verwarrend / polish · **P3** nice-to-have.

---

## 1. Wat de gebruiker probeert te doen

De ideale loop in Bokito’s eigen woorden:

1. Klant schrijft (mail / chat / later WhatsApp).
2. Gesprek landt in **Communicatie**.
3. Agent stelt voor of handelt af binnen **Govern**.
4. Mens grijpt in bij uitzonderingen (**Beslissing**, overname, Signaal).
5. Werk blijft zichtbaar in thread + Agenda + Overview.

Alles hieronder is getoetst aan: *“Kan ik vandaag mijn operatie hieruit runnen zonder een producthandleiding te lezen?”*

---

## 2. Wat al goed voelt (bewaren)

Deze dingen werken intuïtief of liggen dicht bij de north star — niet “wegrefactoren” zonder reden.

| Gebied | Waarom het werkt |
|--------|------------------|
| Communicatie als thuis | Klant- en agentchat delen één inbox; dat matcht “alles vanuit het gesprek”. |
| Decision-card | Op de kaart zelf zijn **Goedkeuren / Afwijzen** duidelijk. |
| Wat nu | Dialog “kijkmoment plannen of Signaal openen” is de juiste ops-vraag. |
| Overview “Jij bent nodig” | Juiste productinstinct: eerst wat jij moet doen. |
| Govern-houdingen | Handmatig / Ondersteund / Autonoom zijn begrijpelijk in één blik. |
| Command palette (Ctrl+K) | Rijke shortcuts; helpt als je al weet wat je zoekt. |
| Cursor-CTA op Koppelingen | Juiste framing: “stuur workspace vanuit Cursor”, niet een tweede MCP-product. |
| Token-presets + lege-scope-waarschuwing | Veiligheid bij app-tokens is zichtbaar bij aanmaken. |
| Knowledge empty state | Kalm, met upload/eerste document — geen paniek. |

---

## 3. Kernprobleem: drie “waarheden” over kanalen

### F-01 — P0 — Mailbox / kanaal-status is tegenstrijdig

**Wat je ziet**

| Surface | Claim |
|---------|--------|
| Koppelingen | Google: “1 mailbox”; Outlook Calendar gesynchroniseerd |
| Instellingen → Kanalen | “Nog geen kanalen. Zonder kanaal kan niemand je bereiken.” |
| Setupgids stap 1 | “Koppel een kanaal” nog open |
| Nieuw gesprek → Contact | “Koppel eerst e-mail…” |
| Email-thread (Jan Devries) | Banner: kan geen antwoord versturen; “Mailbox koppelen” |
| AI-antwoorden | “Geen mailbox gekoppeld” voor uitzonderingen, **én** routing-rij `support@bokito.ai` / Email |

**Waarom het pijn doet**  
De kernjob is “klant beantwoorden”. Als vijf schermen iets anders zeggen over of mail werkt, stopt de operator met vertrouwen in het product. Setup blijft “onvoltooid” terwijl Connections “klaar” lijkt — of omgekeerd: je denkt dat je kunt mailen en loopt vast in de composer.

**Gewenste ervaring**  
Eén bron van waarheid: of een mailbox is gekoppeld voor verzenden/ontvangen. Alle surfaces (Setup, Kanalen, Koppelingen, composer-banner, AI-routing) lezen dezelfde status. Als alleen OAuth/calendar gekoppeld is zonder send-ready mailbox: zeg dat expliciet (“Agenda wel, mail nog niet”).

---

### F-02 — P1 — Setup-checklist en “Aan de slag” blijven plakken

Setup toont “2 van 4” met kanaal open terwijl elders al Google zichtbaar is. De blauwe **Aan de slag**-chip blijft in de topbar — ook op de setuppagina zelf.

**Waarom**  
Onboarding voelt nooit “klaar”. Operators die al werken houden een permanente “je bent nog beginner”-badge.

**Gewenst**  
Checklist volgt echte channel/agent/decision/check-in state. Chip verdwijnt of verkleint zodra de kernloop werkt; niet op de setuppagina zelf herhalen.

---

## 4. “Jij moet iets doen” is verspreid over het product

### F-03 — P1 — Beslissingen zijn geen primaire werkmap

Hub-nav vermeldt bewust geen **Beslissingen** (code: filter “Wacht op beslissing” + bel). Tip bij agent-runs zegt nog dat open ja/nee-items “onder Beslissingen” staan — een map die er niet is.

**Waarom**  
Nieuwe gebruiker zoekt “waar keur ik goed?”. Overview, bel, Agents-badge “1”, filter onder Filters, en agent-runs tippen verschillende plekken. De decision-card is goed; de *route ernaartoe* is niet.

**Gewenst**  
Eén duidelijke “Needs you”-ingang (map, Overview-sectie die diep linkt naar dezelfde lijst, of vaste filter-chip in de hub) + copy die niet naar verdwenen nav verwijst.

---

### F-04 — P1 — Deep link `needsDecision` landt in Agent-runs

URL met `filter=needsDecision` opent de agent-runs-context, niet Open + filter. Overview “Jij bent nodig” voelt daardoor los van “één Communicatie-lijst”.

**Gewenst**  
Deep links naar beslissingen openen het gesprek op de decision-card in de inbox-context die de gebruiker verwacht (of een expliciete Decisions-queue), niet stilletjes een andere hub-modus.

---

### F-05 — P1 — Agents heeft wel een badge, Communicatie niet

Platform PO toont “1 wacht op beslissing”; rail-badge op **Agents** = 1. Communicatie (waar je de decision goedkeurt) heeft geen vergelijkbare teller.

**Waarom**  
Badge trekt je naar Agents-configuratie i.p.v. naar de actie in de thread.

**Gewenst**  
Badge (of Overview) wijst naar de plek waar je *handelt*, of beide surfaces delen dezelfde count met dezelfde klikdoel.

---

### F-06 — P2 — Overview “Jij bent nodig” mixt urgente en dode items

Voorbeeld: 23 dagen oude “Deep-link check: approve this?” (dev-script) naast een toegewezen klantvraag. Geen ranking op urgentie/leeftijd.

**Gewenst**  
Sorteer op “wacht het langst / is klantgericht”; verberg of archiveer test/dev-decisions; toon leeftijd prominent.

---

## 5. Communicatie — dagelijkse operator-frictie

### F-07 — P1 — Composer opent op agent-tab i.p.v. Beantwoorden

Op AI-behandelde threads staat de composer op **Front desk** met placeholder “intern — niet naar de klant”. **Gebruik als antwoord** bestaat, maar de default mindset is “praat met de agent”.

**Waarom**  
Risico: interne notitie of agentbericht i.p.v. klantantwoord. Voor een boekhouder die “snel even mailt” is dat een landmine.

**Gewenst**  
Default = Beantwoorden (of geblokkeerde Reply met duidelijke reden). Agent-tab expliciet secundair.

---

### F-08 — P1 — Dubbele “Overnemen van AI”

Zelfde actie in header-acties én in de AI-banner.

**Gewenst**  
Eén primaire overname-CTA; de andere weglaten of verplaatsen naar “Meer”.

---

### F-09 — P1 — Urgent human-request voelt niet als alarm

**Erik Tester**-thread: klant wil “echte medewerker”, “dringend”, factuur/aanmaning. Timeline toont AI-antwoorden (“Tijdelijk antwoord…”), daarna **AI gepauzeerd**, later **AI hervat**. Lijst-item ziet eruit als elk ander Open-gesprek. Geen Signaal. Geen email op het contact (Websitebezoeker). Onderwerp in header afgekapt.

**Waarom**  
Dit is precies het scenario waarin de mens moet springen. Het product heeft de overname gezien (notificatie) maar de inbox schreeuwt het niet. AI die na pause weer hervat zonder duidelijke menselijke afhandeling ondermijnt “human at exceptions”.

**Gewenst**  
Visuele prioriteit voor takeover/paused-for-human; Signal-suggestie (klacht/factuur); AI niet stil hervatten zonder expliciete actie; onderwerp volledig of tooltip; contact-email forceren bij widget-escalatie.

---

### F-10 — P2 — Wat nu vs Uitstellen vs Agenda vs Signaal

**Wat nu** is goed, maar naast prioriteit + Uitstellen + Agenda “Opnieuw kijken” overlappen de mentale modellen: “wanneer kijk ik terug?” vs “wat voor werk is dit?”.

**Gewenst**  
Korte copy of wizard: *terugkijken* = Agenda/kijkmoment; *typed work* = Signaal; *uit inbox* = Uitstellen. Vermijd drie knoppen die hetzelfde lijken.

---

### F-11 — P2 — Tip-banners op elke surface

Elke hoofdpagina opent met “X is … Lees de volledige uitleg”. Handig dag 1; ruis vanaf dag 2. Dismiss per pagina, maar de set keert terug bij navigatie tussen types.

**Gewenst**  
Eén keer workspace-breed, of alleen tot setup klaar is, of alleen via Learn/Help.

---

### F-12 — P2 — Stale Open + dichte AI-systeemcopy

Threads van weken/maanden blijven in Open. Systeemregels (“Eerder concept — terzijde gelegd…”, prioriteit high→normal) maken scannen zwaar. Copy-icoon op bijna elke bubble.

**Gewenst**  
Aging (“al 14d open”), collapse van afgehandelde AI-meta, minder permanente copy-chrome.

---

### F-13 — P2 — Bulk-select onduidelijk

Checkboxes in de lijst ogen geselecteerd/readonly in de accessibility tree; multi-select gedrag is niet duidelijk.

**Gewenst**  
Of werkende multi-select met bulkacties, of checkboxes verbergen tot je in select-modus gaat.

---

## 6. Signalen — belofte vs praktijk

### F-14 — P1 — Signalen voelen optioneel / dood

Op klantthreads (incl. factuur/aanmaning, offerte-btw, website chat): **“Nog geen signalen”**. Overview “Open signalen per type” leeg. Productverhaal zegt dat intake typed work wordt; de UI toont lege Signalen-blokken.

**Waarom**  
Zonder zichtbare suggesties (“AI stelt voor: Klacht — accepteren?”) is Signaal alleen handmatige CRUD. Voor accountancy mist dan de brug van mail → dossierachtig werk.

**Gewenst**  
Minimaal: suggest-to-accept op binnenkomende matches; lege staat met voorbeeld (“Maak van deze aanmaning een Signaal”). Draaiboeken die naar Signaaltypes wijzen, pas nadat er minstens één levend voorbeeld is.

---

### F-15 — P2 — Signaaltypes grotendeels Engels in NL-UI

Namen/descriptions: Complaint, Bug report, Feature request, Spam or abuse — terwijl shell Nederlands is.

**Gewenst**  
NL labels + korte NL uitleg; of tenant-templates per vakgebied (accountancy) i.p.v. generieke engelse seed.

---

## 7. Contacten & identiteit

### F-16 — P1 — Zwerm “Websitebezoeker”, allemaal Goedgekeurd

Contactenlijst vol anonieme bezoekers, status **Goedgekeurd**, vaak zonder e-mail. Merge/capture is de echte job; de lijst helpt niet consolideren.

**Waarom**  
“Goedgekeurd” op een naamloze visitor zegt niets. Operators verwachten: e-mail vastleggen → één persoon → geschiedenis.

**Gewenst**  
Pending tot er een identifier is; merge-suggesties; “Goedgekeurd” alleen als het een bewuste trust-stap is.

---

### F-17 — P2 — Organizations / Bedrijf zwak voor B2B

Bedrijf-kolom leeg in demo. Voor accountancy is de klant vaak een organisatie, niet alleen een persoon.

**Gewenst**  
Bedrijf zichtbaar vanaf eerste mail-domein; link Organization ↔ Contact in WIE-paneel.

---

### F-18 — P2 — Breadcrumb Contacten = “Communicatie”

`/contacts` blijft onder Communicatie in breadcrumbs. Oké als hub-kind, maar de pagina voelt als eigen noun zonder eigen plek in de rail.

---

## 8. Agenda

### F-19 — P1 — Agent-cron overstemt menselijke follow-ups

Tijdlijn vol herhalende **Dagelijkse platformscan** (GEPLAND tot ver in de toekomst). Menselijk “Opnieuw kijken: Haaaiii” (DUE) verdwijnt in de ruis. Statusmix: EN **DUE** vs NL AFGEROND/GEPLAND.

**Waarom**  
Agenda zou “wat moet er gebeuren” zijn. Nu is het vooral de heartbeat van Platform PO.

**Gewenst**  
Default filter: menselijke kijkmomenten + kalender; agent-cron in “Agent-planning” of ingeklapt. Eén taal voor status. Week-view die DUE bovenaan zet.

---

### F-20 — P2 — Outlook “3 afspraken” vs agent-lijst

Sync-banner belooft kalender; de lijst is vooral triggers. Twee agenda’s in één UI zonder heldere scheiding.

---

## 9. Agents, draaiboeken, projecten, kennis

### F-21 — P2 — “8 open” op agent-kaart zonder eenheid

Platform PO: “8 open · 1 wacht op beslissing”. Open *wat*? Threads? Runs?

**Gewenst**  
“8 open gesprekken” / klik opent gefilterde Communicatie.

---

### F-22 — P2 — Dood draaiboek “Test” (0 stappen, gepauzeerd)

Leert niets. Recente runs leeg.

**Gewenst**  
Empty state die een eerste draaiboek koppelt aan een Signaaltype (“bij Klacht doe X”), geen lege Test-shell.

---

### F-23 — P2 — Project voelt als engineer-tooling

Demo-project, “Geen repository”, tokenbudget. Voor MKB-ops is “project = gedeeld doel + agent + gesprekken” genoeg; repo/tokens vooraan verwarren.

---

### F-24 — P2 — Knowledge leeg zonder vakgebied-onboarding

Goede empty state, maar geen “plak je diensten / FAQ / uurtarieven” voor accountancy behalve via assistent.

---

### F-25 — P2 — `/os` canvas niet vindbaar

`/os` redirect naar Agents. Ctrl+K “Ga naar” heeft geen canvas. Node-based OS-verhaal uit docs leeft niet in de UI die de operator ziet.

**Keuze nodig**  
Of canvas terug in navigatie, of productstory/docs aanpassen aan “Agents + Communicatie zonder graph”.

---

### F-26 — P3 — Drie agents zonder duidelijke default voor klanten

Front desk = Klanten, PO/Assistant = Intern — hint staat er, maar eerste blik vraagt “wie is mijn baliemedewerker?”.

---

## 10. Koppelingen, modules, MCP

### F-27 — P1 — Boekhouding geïnstalleerd, 0 pakketkoppelingen

Module “GEÏNSTALLEERD” met Exact/AFAS/…-iconen en **0 koppelingen**. Voor “AI-native accountancy” voelt dit alsof de boeken klaar zijn — dat zijn ze niet.

**Gewenst**  
Geïnstalleerd ≠ verbonden. CTA “Koppel Exact” dominant; 0-state niet als succes badge.

---

### F-28 — P1 — App-rij met raw UUID als titel

`f5bd27af-…` als productnaam oogt kapot/onveilig.

---

### F-29 — P2 — Cursor-install nog steeds “maak token → hoop”

Connections-CTA is goed. Op Developers zie je Cursor/Claude-copy vooral ná token-flow; bestaande token toont weinig “copy MCP config”. “nooit gebruikt” ondanks smoke → last-used onbetrouwbaar.

---

### F-30 — P3 — “NIEUW” op Koppelingen blijft staan

Badge-inflatie; operators leren badges te negeren (incl. Agents “1”).

---

## 11. Settings, Govern, i18n, chrome

### F-31 — P2 — Help-label “help” (lowercase)

Settings-nav én breadcrumb: **help**. Gebroken i18n; oogt slordig naast “Voor ontwikkelaars”.

---

### F-32 — P2 — Dubbele “Endpoint toevoegen” (webhooks)

Lege staat + headerknop = dezelfde actie twee keer.

---

### F-33 — P2 — Govern rijk maar zwaar; Overview verwijst ernaar

Autonomie per houding + per Signaaltype + per toolcategorie is krachtig. Voor dag 1 mist een “aanbevolen voor support/accountancy”. Overview noemt “Voorstellen in Govern” terwijl Govern alleen onder Instellingen zit.

---

### F-34 — P2 — AI-antwoorden: EN-snippers + mailbox-paradox

Routing: “No default agent”, Engelse uitlegzin, `support@bokito.ai` zichtbaar terwijl elders “geen mailbox”. Bevestigt F-01.

---

### F-35 — P1 — Notificaties EN/NL + oude open items

Voorbeelden: “Human takeover requested…”, Engelse decision-body. Items weken “nog open”; gegroepeerd “8 vergelijkbaar”. Bel-tab heet **Beslissingen** terwijl hub die map verwijderde (IA-inconsistentie).

---

### F-36 — P3 — PLATFORM SUPPORT / Ops-banner altijd

Prima voor staff; verwarrend als tenant-eindgebruiker die denkt dat ze “support mode” zijn.

---

### F-37 — P3 — Drie assistent-ingangen

Floating Bokito-FAB + “Vraag assistent” + agent-tabs in composer. Te veel deuren naar “praat met AI”.

---

### F-38 — P2 — Vocabulaire-overload + abstracte rail

Besturing / Werk / AI vs verwachte MKB-buckets (Inbox, Klanten, Werk, Automatisering). Tipbanners leren nouns; de eerste job (“mail beantwoorden”) vraagt eerst kanaal-waarheid (F-01).

---

## 12. Ontbrekende verwachtingen (nieuwe operator)

| # | Prioriteit | Verwachting | Nu |
|---|------------|-------------|-----|
| F-39 | P0 | Eén send-ready kanaalpad | Gesplitste waarheid |
| F-40 | P1 | Duidelijke “needs you”-wachtrij | Verspreid |
| F-41 | P1 | Signalen die vanzelf verschijnen | Meestal leeg |
| F-42 | P1 | WhatsApp als serieuze next step | In marketplace als “Koppelen”, niet in Setup/Kanalen-eerste-flow |
| F-43 | P2 | Bedrijven/CRM voor B2B | Zwak |
| F-44 | P2 | Agenda “mijn dag” eerst | Agent-cron eerst |
| F-45 | P2 | Graph/OS of eerlijk weglaten | Redirect / onzichtbaar |
| F-46 | P3 | One-click Cursor | Copy-paste token |

---

## 13. Aanbevolen triage-volgorde (voor latere keuzes)

Niet geïmplementeerd — alleen voorstel om te beslissen:

1. **Waarheid & send-path** — F-01, F-02, F-34, F-39, **F-47**  
2. **AI echt vs mock / taal** — **F-48**, F-56  
3. **Needs-you IA** — F-03, F-04, F-05, F-06, F-35, F-40  
4. **Takeover / uitzonderingen in de thread** — F-09, F-07, F-08  
5. **Signalen close-the-loop** — F-14, F-15, F-41, **F-49**  
6. **Agenda- / run-ruis** — F-19, F-20, F-44, **F-53**  
7. **Contact-identiteit** — F-16, F-17  
8. **Modules eerlijkheid** — F-27, F-28, **F-51**  
9. **Trust / legal copy** — **F-55**  
10. **i18n & chrome** — F-31, F-32, F-35, F-11, F-37, **F-52**, **F-57**, **F-64**, **F-66**, **F-68**  
11. **OS-canvas productkeuze** — F-25, F-45  
12. **Lege mappen & metrics-waarheid** — **F-63**, **F-65**  
13. **Widget / default agent** — **F-69**, F-56  
14. **Beslissing-IA / notificaties** — **F-74**, **F-75**, **F-76**, **F-83**, F-03, F-04  
15. **Timeline & routing i18n** — **F-77**, **F-78**  
16. **Developers / MCP at rest** — **F-84**  
17. **Autonomy + mock combo** — **F-86**, F-47  

---

## 14. Observatiesessie (kort log)

| Surface | Opvallend |
|---------|-----------|
| Login prod | NL login, Google/Microsoft, build `33ba9c1` |
| Communicatie Open | Tipbanner, AI-banner, dual overname, composer → Front desk |
| Jan Devries (mail) | Geen send-kanaal-banner; Wat nu dialog ok |
| Erik Tester | Takeover/pause/resume; geen Signaal; truncated subject; +1 eerder |
| Petra (Van mij) | NL vraag, EN AI-antwoord; mailbox-banner |
| Filters | Jij aan zet / Wacht op beslissing bestaan; niet als map |
| Overview | Jij bent nodig + lege signalen + Govern-metric |
| Agenda | Cron-flood + DUE follow-up |
| Agents / detail PO | Badge 1; run-geschiedenis = scans; EN Internal/prompt |
| Draaiboeken / Test | 0 stappen, gepauzeerd, wél “Run starten”; EN types |
| Project detail | Queue “Verify the deep link”; card op lijst nauwelijks klikbaar |
| Kennis | Lege workspace-kennis |
| Koppelingen / Marketplace | Cursor-CTA; Boekhouding 0; Bankieren SETUP; WhatsApp Koppelen; EN tool-copy |
| Kanalen settings | “Nog geen kanalen” |
| Chatwidget | Snippet met localhost `127.0.0.1:5173` |
| AI-antwoorden | Suggest/auto; mailbox-paradox; EN routing |
| Models | “mock-modus” / geen platformsleutel — verklaart tijdelijke antwoorden |
| Trust/privacy | Legal docs als “engineering-concepten” |
| Leden | Invite-mail niet vanaf server; pending Casper |
| Developers | Presets bij nieuwe token; weinig Cursor-copy at rest |
| Govern | Rijke autonomie-UI |
| Contacten | Websitebezoeker-zwerm |
| Help | Titel/nav “help” |
| Gesloten + Signaal | Gesprek dicht, Bug report Signaal nog Open |
| Niet toegewezen | Vol met AI-behandelde threads |
| `/marketplace` | Dode URL → Communicatie; echte route `/connections/marketplace` |
| `/os` | → Agents |
| Uitgesteld / Spam (leeg) | Geen “geen items”; wél setup-CTA “Koppel je kanalen” |
| Front desk agent-inbox | “Agent session: …”; Pauze; mock-antwoord |
| Verbruik | 1.460 tokens / 0 gesprekken (7d) terwijl Open vol staat |
| Signaal toevoegen (Erik) | Complaint / Bug report / Feature request / Spam or abuse |
| Profiel → Startpagina | Optie **Berichten** (rail heet Communicatie) |
| Chatwidget Uiterlijk | Modules Home/Berichten/Help/Tools; default agent Platform PO |
| Signaaltypes-settings | EN namen + descriptions; Spam = Alleen label |
| Filter Wacht op beslissing | 1 intern Deep-link-item in Open; detail blijft op Haaaiii |
| Direct `?filter=needsDecision` | Landt in Agent-runs (`/communication/runs/all`) |
| Notificatiebel | Tabs Inbox / Beslissingen; EN takeover + EN decision-body |
| AI-antwoorden → routing | EN copy; `support@bokito.ai` Email / No default agent |
| Contacten `/contacts` | Erik = Websitechat; veel Websitebezoeker Goedgekeurd |
| Jan Devries timeline | Herhaald “Message added” + concept terzijde gelegd |
| Filter sticky | Van mij erft `?filter=needsDecision` na Open-filter |
| Setupgids | Nog “2 van 4”; stap 1 kanaal open |
| Developers at rest | Webhooks + app-token `mcp-smoke bok_…`; geen MCP/Cursor-copy |
| Govern | Posture-UI met “Huidige instelling” bij Autonoom; EN signaaltypes |
| Wat nu → Signaal | Complaint / Bug report / Feature request / Spam or abuse |
| Uitstellen-menu | 1u / 4u / Morgen / Maandag / Tot klant antwoordt (NL ok) |
| Zijbalk aanpassen | “Reorder Kanalen” / “Reorder Chat met agents” |
| Notificatie-prefs | Toewijzing / vermelding / beslissing — geen takeover-rij |

---

## 16. Ronde 3 — verdieping (nieuwe punten)

### F-47 — P0 — AI draait in mock-modus (verklaart “Tijdelijk antwoord…”)

**Wat je ziet**  
Instellingen → Providers en modellen: *“Geen platformsleutel geconfigureerd, dus AI-aanroepen draaien in mock-modus.”* Bokito AI staat op **Niet geconfigureerd**. In threads overal: “Tijdelijk antwoord over &lt;onderwerp&gt;.” — naar de klant verstuurd als AI-antwoord.

**Waarom het pijn doet**  
Dit is geen cosmetisch seed-probleem. De operator ervaart “AI die klanten beantwoordt” als kapotte placeholder-tekst. Vertrouwen in het hele AI-native verhaal stort in vóór Govern of Signalen relevant worden. Combineert dodelijk met F-01 (mail toch “verstuurd” in timeline terwijl send-path elders stuk lijkt).

**Gewenst**  
Workspace zonder live LLM: duidelijke banner *in Communicatie* (“AI is demo/mock — antwoorden gaan niet echt de deur uit / zijn placeholders”), Setup-stap “AI live zetten”, geen “Verstuurd naar de klant” voor mock bodies. Of keys altijd aanwezig in demo-tenants die er uitzien als live.

---

### F-48 — P1 — Klant schrijft NL, AI antwoordt EN

**Wat je ziet**  
Petra Bakker (Van mij): Nederlandse vraag over levertijd. Goedgekeurd AI-antwoord: “Thank you for your message. We have received your request and will follow up shortly.” AI-antwoorden-settings zeggen “Automatisch (volg de klant)”.

**Waarom**  
Zelfs bij suggest-mode + goedkeuring faalt de belofte “antwoordtaal volgt de klant”. Operator moet elke kaart controleren op taal — niet schaalbaar.

**Gewenst**  
Harde check: concepttaal ≠ klanttaal → blokkeer of forceer herschrijven vóór goedkeuren.

---

### F-49 — P1 — Gesprek gesloten, Signaal blijft Open

**Wat je ziet**  
Gesloten-map, thread “test”: badge **Bug report**, onder Signalen nog **Bug report · Open**. Gesprek is dicht; typed work niet.

**Waarom**  
Close-the-loop breekt. Operator denkt “klaar” na Sluiten; Overview/Signalen blijven rommel of omgekeerd: open Signalen zonder open gesprek.

**Gewenst**  
Sluiten vraagt wat met open Signalen (meenemen / afsluiten / follow-up). Of Signalen blokkeren “gesprek sluiten” tot resolved.

---

### F-50 — P1 — “Niet toegewezen” ≠ “niemand werkt eraan”

**Wat je ziet**  
Niet toegewezen zit vol threads die **AI behandelt** (banner, Front desk-sessie). Geen menselijke assignee, wél actieve AI.

**Waarom**  
In klassieke inbox = “pak dit op”. Hier = “geen mens-owner”. Nieuwe gebruiker denkt dat niemand kijkt, of juist dat ze alles moeten claimen terwijl AI al loopt.

**Gewenst**  
Hernoemen of subtitel: “Geen mens toegewezen (AI mag wel)”. Filter “AI bezig / wacht op mens”.

---

### F-51 — P1 — Bankieren-module “SETUP” naast Boekhouding “GEÏNSTALLEERD”

**Wat je ziet**  
Marketplace: Boekhouding geïnstalleerd (0 pakketten), Bankieren status **SETUP** + “Setup afronden”, Beleggen/Documenten **BINNENKORT**.

**Waarom**  
Drie status-woorden (geïnstalleerd / setup / binnenkort) zonder één “verbonden en bruikbaar voor agents”-criterium. Accountancy-koper ziet groen op Boekhouding en mist dat er niets gekoppeld is (F-27).

**Gewenst**  
Eén statusmodel: niet geïnstalleerd → geïnstalleerd → gekoppeld (N packages) → agents mogen gebruiken.

---

### F-52 — P2 — Marketplace-copy grotendeels Engels

Airtable, Canva, Figma, HubSpot, Intercom, Miro, Mollie, enz. Engelse one-liners in NL-shell. Module-uitleg NL; tool-tegels EN.

**Gewenst**  
NL descriptions of taal-toggle; geen half-localized catalogus.

---

### F-53 — P2 — Agent run-geschiedenis = scan-ruis + engineer-chrome

Platform PO detail: eindeloze “Dagelijkse platformscan” @ 0 tokens, overal **Run-id kopiëren**. Openstaande gesprekken mixen klantwerk met “Daily platform scan” en oude decision.

**Waarom**  
Agent-pagina zou “wie is deze medewerker en wat moet *ik* doen?” zijn. Nu voelt het als ops-log voor developers.

**Gewenst**  
Default: klant-/beslissing-runs; cron inklappen. Run-id achter “ technisch ”.

---

### F-54 — P2 — Projectkaart opent niet als geheel

Lijst toont “Bokito Platform” met Agent openen / Gesprekken openen; geen duidelijke klik op de kaarttitel naar `/projects/:id`. Detail bestaat (queue-item “Verify the deep link”), breadcrumb zegt alleen “Project”.

**Gewenst**  
Hele kaart klikbaar; breadcrumb met projectnaam; queue in mensentaal.

---

### F-55 — P1 — Trust-pagina zegt “engineering-concepten — jurist moet reviewen”

**Wat je ziet**  
Vertrouwen en privacy: DPA/Privacy/Subprocessors/Security als *“Engineering-concepten onder docs/legal. Jurist of FG moet reviewen vóór productie met klantdata.”*

**Waarom**  
Voor een operator die net klantdata wil laden is dit een harde stop. Product oogt alsof compliance nog niet productie-klaar is — terecht of niet, de copy is desastreus voor sales/trust.

**Gewenst**  
Of echte reviewed docs, of deze pagina verbergen/tonen als “concept” alleen in non-prod, of zachte “conceptversie” zonder “vóór productie met klantdata” in tenant-UI.

---

### F-56 — P2 — Widget-snippet wijst naar localhost

Chatwidget Installeren: `src="http://127.0.0.1:5173/chat-widget/..."` en `data-api-url` idem. Route redirect `/settings/widget` → `/ai/assistant/external/installation`.

**Waarom**  
Copy-paste naar echte site faalt stil. Local-dev is oké als duidelijk gelabeld; zonder waarschuwing = support-tickets.

**Gewenst**  
Altijd productie-origin in snippet (of grote waarschuwing “dit is je lokale URL”). Route/naam consistent (“Chatwidget” overal).

---

### F-57 — P2 — Draaiboek “Run starten” zonder stappen

Test-draaiboek: Gepauzeerd, “Nog geen stappen”, knop **Run starten** (twee keer in UI). Geaccepteerde types: Complaint/Bug report/… (EN).

**Waarom**  
Suggesteert dat runnen kan; dat kan niet zinvol. Leert verkeerd model van Draaiboeken.

**Gewenst**  
Run disabled tot ≥1 stap + niet gepauzeerd; NL type-namen; lege staat = “koppel aan Signaaltype X”.

---

### F-58 — P2 — Leden: mail uitnodigen werkt niet vanaf server

Copy: *“Uitnodigingsmails worden nog niet vanaf deze server verstuurd. Deel de kopieerbare uitnodigingslink.”* Casper pending sinds 24 jul.

**Waarom**  
Team-onboarding breekt. “Nodig uit” belooft mail; krijgt clipboard-SOP.

**Gewenst**  
Echte invite-mail, of knop hernoemen naar “Uitnodigingslink maken” als primaire actie.

---

### F-59 — P2 — Dode URL `/marketplace`

Navigeren naar `/marketplace` landt terug in Communicatie. Werkende route: `/connections/marketplace`. Docs/links/bookmarks kunnen stilletjes falen.

**Gewenst**  
Redirect `/marketplace` → connections marketplace (zoals andere legacy redirects).

---

### F-60 — P2 — Staff “Platformbeheer” + markup zichtbaar op Models

Onderaan Providers: Anthropic/OpenAI fallback-sleutels + “Token doorverkoop markup” onder **Platformbeheer (staff)**. In PLATFORM SUPPORT-modus zichtbaar voor deze sessie — voor een normale owner mag dit nooit lijken op tenant-settings.

**Gewenst**  
Strikt staff-only gate; geen markup-UI in tenant-shell.

---

### F-61 — P3 — Agent-detail: “Internal” + Engelse system prompt

Label Internal i.p.v. Intern; instructies Engels in NL-product. Breadcrumb “Agents / Agent” i.p.v. agentnaam.

---

### F-62 — P3 — `/settings/privacy` en `/settings/providers` zijn geen routes

Nav naar die paden bounce’t weg (SPA valt terug). Correct: `/settings/trust`, `/settings/models`. Settings-nav labels matchen niet alle URL-slugs die je zou raden. Zelfde patroon: `/settings/signal-types` bestaat niet → bounce; correct is `/settings/signals`.

---

## 17. Ronde 4 — wachtrijen, metrics, Signaal, widget, vocab

### F-63 — P1 — Lege Uitgesteld / Spam tonen setup i.p.v. lege map

**Wat je ziet**  
`/communication/inbox/snoozed` en `/spam` met 0 threads: heading **Ga verder met setup**, “Volgende: Koppel je kanalen”, links Open kanalen / Open setupgids / Praat met een agent. Geen “Nog geen uitgestelde gesprekken” / “Geen spam”.

**Waarom**  
Operator checkt of snooze/spam werkt en landt in onboarding. Lege secundaire mappen voelen kapot of alsof de workspace “nog niet mag” bestaan — terwijl Open al vol zit.

**Gewenst**  
Queue-specifieke empty state + korte hint (“Stel een gesprek uit via Uitstellen”). Setup alleen op Open/Nieuwe chat of Setupgids, niet als fallback voor elke lege filter.

---

### F-64 — P2 — Startpagina heet “Berichten”, rail “Communicatie”

**Wat je ziet**  
Profiel → Startpagina: *“Berichten is de standaard.”* Opties **Berichten** | Overview. Rail-item en page title: **Communicatie**. Widget-modules en Overview-loopkaart gebruiken ook “Berichten”.

**Waarom**  
Set C / productvocab zegt Communicatie. Nieuwe gebruiker denkt dat er twee producten zijn (Berichten vs Communicatie) of dat de startpagina-keuze iets anders opent.

**Gewenst**  
Eén woord overal (Communicatie), of expliciet “Communicatie (voorheen Berichten)” één release — geen parallelle labels.

---

### F-65 — P1 — Verbruik: 0 gesprekken (7d) naast volle Open-inbox

**Wat je ziet**  
Overview → Verbruik: Tokens 1.460 (30d), Front desk 55 tok, Platform PO 1.185 tok — én **Gesprekken (7d): 0** met copy *“Deze week nog geen gesprekken. Open de inbox om te beginnen.”* Open-inbox toont tientallen threads (laatste activiteit o.a. 5 sep / 27 aug).

**Waarom**  
Technisch kan “0 in 7d” kloppen (oude backlog). Product-copy zegt “nog geen gesprekken” alsof de inbox leeg is. Operator concludeert: metrics liegen of inbox is nep.

**Gewenst**  
Onderscheid “actieve gesprekken deze week” vs “open backlog”. CTA niet “beginnen” als Open > 0; toon “Geen nieuwe gesprekken deze week · N open in Communicatie”.

---

### F-66 — P1 — Signaal-menu: alleen Engelse types, geen factuur/billing

**Wat je ziet**  
Op Erik (factuur 2026-118 / aanmaning): **Signaal toevoegen** → Complaint, Bug report, Feature request, Spam or abuse (+ suffix **Label** in menu). Settings → Signaaltypes: zelfde EN namen/descriptions; Spam = “Alleen label”. Geen type voor betaling/factuur/dispute.

**Waarom**  
Kernjob “dit is een betalingsprobleem” past niet. Operator forceert Complaint of laat Signaal leeg (F-14/F-41). EN labels in NL-shell versterken “half gelokaliseerd product”.

**Gewenst**  
NL labels + tenant-relevante seed types (factuur/betaling voor MKB); of “Nieuw type” prominent vanuit dit menu. Geen ruwe “Label”-suffix in menuitem.

---

### F-67 — P3 — Meer acties = vooral chrome, niet ops

**Wat je ziet**  
Overflow: Gesprekslink kopiëren, Gespreks-ID kopiëren, Markeer als spam, Markeer als ongelezen, Gesprek pinnen, Verwijderen. Geen “Signaal”, “Beslissing”, “Project”, “Draaiboek”.

**Waarom**  
Primaire ops-acties zitten elders (goed). Overflow leert wel “technisch / opruimen”, niet “stuur het bedrijf”. Dubbele Verwijderen (lijstrij + menu).

**Gewenst**  
Optioneel: Signaal / Wat nu in overflow voor power users; Verwijderen niet twee keer.

---

### F-68 — P2 — Front desk-inbox: Engelse sessietitel + Pauze + mock

**Wat je ziet**  
Chat met agents → Front desk opent `/communication/agent/…/open` met thread **Agent session: Haaaiii**. Context: Front desk Assistant **Pauze**, model Bokito AI 3.1, antwoord “Tijdelijk antwoord…”. “Bericht naar deze agent” opent wél nette nieuwe-chat flow (“Er wordt pas iets verstuurd als je op versturen klikt”).

**Waarom**  
Agent-naam-klik belooft “praat met Front desk”; landt in engineer-achtige sessietitel + gepauzeerde agent + mock. Nieuwe-chat-pad is beter — maar is het secundaire icoon.

**Gewenst**  
Menselijke threadtitels; Pauze zichtbaar met “hervatten”; mock-banner (F-47); agent-naam-klik = zelfde heldere compose als “Bericht naar…”.

---

### F-69 — P2 — Widget default agent = Platform PO

**Wat je ziet**  
Chatwidget → Uiterlijk: *Behandelende agent* = **Platform PO — standaardagent**. Front desk bestaat als bedrijfsagent voor klantchat.

**Waarom**  
Websitebezoeker landt bij product/PO-agent i.p.v. Front desk. Verklaart PO-links in visitor threads en verkeerde “wie behandelt dit?”-intuïtie.

**Gewenst**  
Default behandelaar = Front desk (of “eerste customer-facing agent”); Platform PO niet als widget-default tenzij bewust gekozen.

---

### F-70 — P2 — Composer op AI-visitor-thread opent Intern → Front desk

**Wat je ziet**  
Websitebezoeker “Haaaiii”: composer-tab **Front desk**, placeholder “Bericht aan Front desk (intern — niet naar de klant)…”, knop **Naar Front desk**. **Beantwoorden** bestaat maar is niet default. Op Erik (mens-achtige chat) is Beantwoorden wél default.

**Waarom**  
Na “Overnemen van AI” verwacht je klantantwoord. Default intern-agentchat vertraagt reply en versterkt verwarring over wat de klant ziet.

**Gewenst**  
Na overname of bij intent “ik antwoord”: Beantwoorden default. Intern/agent expliciet tweede tab.

---

### F-71 — P3 — `/ai/assistant/external/appearance` → customization

Directe “Uiterlijk”-URL landt op customization-tab. Werkt, maar bookmarks/docs die `/appearance` beloven zijn fragiel (vergelijk F-56 route-chaos).

---

### F-72 — P2 — Contactpaneel toont “Websitebezoeker” onder Erik Tester

**Wat je ziet**  
Thread Erik Tester, naamveld “Erik Tester”, daaronder in contactcontext nog **Websitebezoeker** / “Laatst gezien 31d” terwijl er ook “+1 eerder” / Hello quick test is.

**Waarom**  
Identiteit voelt gelekt of verkeerd gemerged (sluit aan op F-16/F-17). Operator twijfelt welk profiel ze bewerken.

**Gewenst**  
Eén contact-header; secondary channels als lijst (“ook gezien als Websitebezoeker”), niet als tweede naam.

---

### F-73 — P3 — Overview “Jij bent nodig” mix NL/EN titels

Kaarten: “Deep-link check: approve this?” (EN) naast “Vraag over levertijd”. Seed/demo-copy breekt de NL-shell.

---

## 18. Ronde 5 — filters, beslissingen, notificaties, routing, contacten

### F-74 — P1 — “Wacht op beslissing” toont interne run in Open + orphan detail

**Wat je ziet**  
Filters → **Wacht op beslissing**: chip “1 · Wacht op beslissing”. Lijst toont **Platform PO · INTERN · Deep-link check: approve this?** terwijl je nog in map **Open** zit. Detailpaneel blijft **Haaaiii** (Websitebezoeker) open — geen beslissingskaart zichtbaar tot je de intern-rij klikt.

**Waarom**  
Operator filtert “wat wacht op mij” en ziet (1) een tech-deep-link tussen klantwerk, (2) een verkeerde thread rechts. Vertrouwen in filters en in Open als klantmap daalt.

**Gewenst**  
Beslissingen in eigen map/hub (of filter schakelt context naar Agent-runs/Beslissingen). Bij lege match: clear empty state, detail wissen of auto-select eerste match.

---

### F-75 — P1 — Twee paden voor needsDecision, geen Beslissingen-map

**Wat je ziet**

| Pad | Landing |
|-----|---------|
| Filters in Open → Wacht op beslissing | Blijft `/communication/inbox/open?filter=needsDecision` |
| Directe URL `…/open?filter=needsDecision` (zonder prior thread) | Springt naar `/communication/runs/all` (Agent-runs) |
| Tip op Agent-runs | “Items die op een ja of nee wachten staan onder **Beslissingen**” |
| Hub-nav | Geen map Beslissingen — wel bel-tab **Beslissingen** |

**Waarom**  
Zelfde intent, twee surfaces. Tip verwijst naar een noun die geen primaire nav is (versterkt F-03/F-04).

**Gewenst**  
Eén canonical “Beslissingen”-wachtrij in Communicatie-nav; alle filters/deep-links landen daar.

---

### F-76 — P1 — Notificatiebel: kritieke alerts in het Engels

**Wat je ziet**  
Bel (4): tabs Inbox / Beslissingen / Gelezen. Onder Eerder o.a.:

- *“Human takeover requested: Hallo, ik heb gisteren factuur…”* — body: *“Erik Tester asked for a human. AI replies are paused…”*
- *“Deep-link check: approve this?”* — *“Created by a dev script…”*
- NL wel: “Conceptantwoord klaar ter beoordeling” + “8 vergelijkbaar — nog open”

**Waarom**  
Takeover is dé uitzondering die een NL-operator moet snappen. Engelse bel = “product niet voor mij” + gemiste urgentie. Grouping “8 vergelijkbaar” zonder bulk-actie voelt als ruis.

**Gewenst**  
Alle operator-facing notification templates NL/EN via locale. Takeover-copy in Set C. Grouping met “alles openen / alles afhandelen”.

---

### F-77 — P2 — Timeline-events Engels + herhaalde “concept terzijde”

**Wat je ziet** (Jan Devries / needsReply): herhaaldelijk *Message added*, *Website visitor*, *Eerder concept — terzijde gelegd — Conceptantwoord klaar ter beoordeling* + *Afgehandeld / AI heeft dit bericht beoordeeld* per inbound. Ondertussen mailbox-banner: kan niet antwoorden.

**Waarom**  
Thread leest als auditlog, niet als gesprek. “Afgehandeld” terwijl klant nog vraagt = false closure.

**Gewenst**  
NL event-labels; concept-lifecycle samenvatten (één statusregel i.p.v. drie per message); geen “Afgehandeld” als klant nog open staat.

---

### F-78 — P2 — AI-routing: Engende copy + mailbox-paradox

**Wat je ziet**  
AI-antwoorden: workspace NL helder (voorstellen/auto). Sectie **Wie antwoordt / Kanaalrouting**: *“A conversation keeps its pinned agent…”*, rij `support@bokito.ai` · **Email** · **No default agent**. Dezelfde pagina hoger: *“Geen mailbox gekoppeld”* voor uitzonderingen.

**Waarom**  
Routing claimt een Email-adres; uitzonderingen zeggen geen mailbox — F-01 in één scherm. EN strings in kern-settings.

**Gewenst**  
Zelfde kanaal-waarheid als Koppelingen/Kanalen; NL labels; “No default agent” → “Geen standaardagent” + kies Front desk.

---

### F-79 — P2 — Contactenlijst: Erik = Websitebezoeker-kanaal + anonieme zwerm

**Wat je ziet**  
`/contacts`: Erik Tester onder kanaal **Websitechat** met subtitel Websitebezoeker; tientallen **Websitebezoeker**-rijen alle **Goedgekeurd**; Bedrijf overal “-”; document-title blijft “Communicatie”.

**Waarom**  
CRM-achtige pagina lost identiteit niet op (F-16/F-72). “Goedgekeurd” op anonieme bezoekers is betekenisloos.

**Gewenst**  
Merge/dedupe prompts; anonieme bezoekers als groep of “wacht op e-mail”; document-title Contacten.

---

### F-80 — P2 — Agenda: enige DUE-menswerk begraven onder scans

**Wat je ziet**  
Vandaag: **DUE · Opnieuw kijken · Haaaiii** tussen eindeloze **Herhalend · Dagelijkse platformscan · AFGEROND/GEPLAND**. Outlook “3 afspraken gesynchroniseerd” — kalenderblokken niet zichtbaar in deze tijdlijn-snip.

**Waarom**  
Agenda belooft “mijn dag”; toont agent-cron. Menselijke DUE verdwijnt (F-19/F-44).

**Gewenst**  
Default filter “Mijn kijkmomenten / mensen”; cron inklappen of aparte Agent-agenda.

---

### F-81 — P3 — Settings-nav label “help” lowercase

Onder Geavanceerd staat letterlijk **help** i.p.v. Help / Hulp — chrome-ruis naast verder nette NL-labels.

---

### F-82 — P2 — Notificatie-stack “8 vergelijkbaar — nog open”

Conceptantwoord-notificaties groeperen tot *“31d geleden — nog open · 8 vergelijkbaar — nog open”* zonder bulk resolve. Bel blijft “druk” terwijl operator denkt dat concepten al afgehandeld zijn (timeline “Afgehandeld”).

**Gewenst**  
Sync notificatie-state met concept-resolutie; bulk “markeer groep gelezen/afgehandeld”.

---

## 19. Ronde 6 — sticky filters, Developers, Govern, Wat nu, chrome

### F-83 — P1 — Filter “Wacht op beslissing” blijft plakken over mappen

**Wat je ziet**  
Na Filters → Wacht op beslissing in Open: nav naar **Van mij** of `/communication/inbox/mine` heropent met `?filter=needsDecision`. Lijst toont alleen de interne Deep-link-beslissing; Petra (echte Van-mij-thread) verdwijnt tot **Wissen**.

**Waarom**  
Operator denkt “mijn toegewezen werk” en ziet een tech-deep-link of een lege map. Map + filter zijn niet onafhankelijk; sticky state voelt als bug.

**Gewenst**  
Filter reset bij mapwissel, of persist per map. Chip altijd met “Wissen” + mapnaam (“Van mij · wacht op beslissing”).

---

### F-84 — P1 — Developers at rest: geen MCP/Cursor-setup, wél token-prefix

**Wat je ziet**  
Instellingen → Voor ontwikkelaars: Webhooks (leeg), App-tokens met rij **mcp-smoke bok_SHOtIpvE…** (“workspace, messaging · nooit gebruikt”), korte Workspace-API-tekst. Geen MCP-endpoint, geen Cursor/Claude install-snippets, geen “kopieer config”.

**Waarom**  
Integrators die MCP net gebouwd willen gebruiken, vinden de install-flow niet. Token-prefix in de lijst lekt partial secret-shape. “Nooit gebruikt” op een smoke-token verwart.

**Gewenst**  
MCP-client setup (Cursor/Claude) zichtbaar at rest; tokens alleen als `bok_…` zonder significante prefix, of volledig gemaskeerd; revoke/rotate duidelijk.

---

### F-85 — P2 — Beslissingskaart: “queue-item” + composer → Platform PO

**Wat je ziet**  
Deep-link-beslissing: *Vanuit **queue-item*** (linktekst Engels). Composer-default: **Bericht aan Platform PO…** i.p.v. neutrale notitie. **Beslissings-ID kopiëren** prominent.

**Waarom**  
Kaart Goedkeuren/Afwijzen is goed; chrome eromheen is engineer. Operator die alleen wil ja/nee wordt naar agent-chat geduwd.

**Gewenst**  
“Vanuit projectqueue” / verberg queue-jargon; composer secundair; ID achter “Technisch”.

---

### F-86 — P1 — Govern-houding oogt Autonoom naast mock + kapotte mail

**Wat je ziet**  
Govern: drie houdingen; label **Huidige instelling** zit visueel bij **Autonoom** (*“Agents versturen zonder te wachten”*). Signaaltype-dials EN (Complaint…). Intussen Models = mock (F-47) en send-path stuk (F-01).

**Waarom**  
Autonoom + mock + “Verstuurd naar de klant” = product vertelt dat AI de operatie runt terwijl antwoorden placeholders zijn. Gevaarlijkste combo voor first-run trust.

**Gewenst**  
Posture-badge ondubbelzinnig op de geselecteerde kaart. Als LLM mock of mailbox niet send-ready: blokkeer of waarschuw vóór Autonoom (“Eerst AI/mail live”).

---

### F-87 — P3 — Zijbalk aanpassen: “Reorder …” Engels

Dialog: *Reorder Kanalen*, *Reorder Chat met agents*, verder NL (Inklappen/Tonen/Standaard herstellen).

**Gewenst**  
“Volgorde Kanalen” / aria-labels NL.

---

### F-88 — P2 — Projectkaart: Engelse demobeschrijving

Projecten: **Bokito Platform** — *“Demo project for local development.”* + “1 in queue” / “Geen repository”. Kaart-acties Agent/Gesprekken openen; titel niet duidelijk één klik naar detail (F-54).

**Gewenst**  
NL beschrijving of verberg seed-copy; hele kaart klikbaar.

---

### F-89 — P2 — Notificatie-prefs missen human takeover

**Wat je ziet**  
Notificaties-settings: toewijzing, vermelding, beslissing, digests, push. Bel toont wél *Human takeover requested* (F-76) — geen rij om takeover aan/uit of kanaal te kiezen.

**Waarom**  
Kritiekste alert is niet configureerbaar; voelt alsof prefs incompleet zijn.

**Gewenst**  
Rij “Wanneer een klant een medewerker vraagt” met in-app/e-mail/push.

---

### F-90 — P2 — Wat nu → Signaal openen: zelfde EN-catalogus

Dialog copy NL goed (*Plan een kijkmoment…*). Tab Signaal: kort “Signaaltypes laden…”, dan Complaint / Bug report / Feature request / Spam or abuse — geen factuurtype (F-66).

---

### F-91 — P2 — Takeover-state vs knop “Overnemen van AI”

**Wat je ziet**  
Erik: notificatie zegt AI gepauzeerd tot overname; thread toont **Overnemen van AI** nog als available (released), géén duidelijke “AI gepauzeerd / wacht op mens”-banner. Composer is wél Beantwoorden.

**Waarom**  
Twee waarheden over of AI nog mag antwoorden.

**Gewenst**  
Eén banner: “Klant vroeg een medewerker — AI gepauzeerd”; knop wordt “AI hervatten” of verdwijnt.

---

### F-92 — P2 — Uitstellen-menu is sterk (positief) vs lege Uitgesteld-map

Menu: 1 uur / 4 uur / Morgen 9:00 / Volgende maandag / **Tot de klant antwoordt** / Kies datum — helder NL. Contrast met F-63: na uitstellen land je in een map die setup toont i.p.v. het uitgestelde item.

**Gewenst**  
Bewaar dit menu; fix empty state (F-63) zodat de loop sluit.

---

## 15. Volgende stap

Dit document is de **keuzelijst** (rondes 1–6, F-01…F-92). Bij een vervolg: per triage-bucket (sectie 13) beslissen *do / defer / won’t*, daarna tickets of een implementatieplan. Geen codewijzigingen in deze inventarisronde.

**Ronde 3:** mock LLM (F-47).  
**Ronde 4:** lege mappen (F-63), Verbruik (F-65), Signaaltypes (F-66), widget defaults (F-69/F-70).  
**Ronde 5:** Beslissingen-IA (F-74/F-75), EN-notificaties (F-76).  
**Ronde 6:** sticky decision-filter (F-83), Developers zonder MCP at rest (F-84), Autonoom + mock (F-86), takeover-state mismatch (F-91).
