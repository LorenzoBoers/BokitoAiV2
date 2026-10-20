# Bokito: van features naar één product

19 oktober 2026 · Lorenzo

> Bron: productreview van dev 1.2.18 (commit `baabd1d`), gebaseerd op de featurepagina, een rondgang door de app en een lezing van deze repo. Levende versie: https://claude.ai/code/artifact/d37afc37-8d35-4ac0-acdc-8321f02aacf4

## Samenvatting

**Oordeel: de overlap uit de featurepagina klopt, en in de app is het erger dan in de docs.** Hetzelfde ding heeft vaak drie namen, en sommige getallen spreken elkaar tegen tussen schermen. Autonomie stel je op ruim tien plekken in.

**De ene grote wijziging:** breng Bokito terug naar vijf begrippen met elk één naam. Dat zijn Gesprek, Map, Flow, Agent en Autonomie. Elke instelling krijgt één plek. De rail gaat van 12 naar 7 items. Daarna volgt pas nieuwe functionaliteit.

Dit is vooral hernoemen, samenvoegen en verbergen. Er hoeft weinig nieuw gebouwd te worden. De codebase bevestigt dat: het datamodel en je eigen noordster wijzen al deze kant op, en de autonomie-logica zit al in één functie. Bouw het niet opnieuw; ruim op voordat de gedeelde UI-bibliotheek naar mobiel gaat.

## Toetsing aan de codebase

**De code bevestigt het oordeel, en het wordt goedkoper dan gedacht.** Het datamodel is grotendeels al één product. De versnippering zit vooral in de copy, in de rail en in hoe de schermen hetzelfde model laten zien. De repo `BokitoAiV2` is gelezen op commit `baabd1d`; er is niets gewijzigd.

### Je eigen noordster zegt het al

`.cursor/rules/bokito-core-intent.mdc` schrijft precies dit voor, maar de app volgt het nog niet:

| Regel in de codebase | Wat de app nu doet |
| --- | --- |
| "One object per idea" | Gesprek heet ook Signal, Map heet ook Project, Flow heet ook Workstream en Playbook, Label heet ook Categorie en action tag |
| "Avoid actietag / action tag" | De docs gebruiken het, en Labels staat op `/settings/labels` in component `CategoriesSettings` |
| "Projects are folders" | De NL-copy noemt "project" ruim 240 keer en "map" zo'n 40 keer |
| "Autonomy is one dial in Govern" | Autonomie staat verdeeld over AI-afhandeling, Govern, de agentpagina en Labels |
| "Delete the old surface in the same change" | `App.tsx` heeft 199 routes, waarvan 139 redirects van eerdere namen |

De beslissing is dus al genomen. Wat nog ontbreekt is één opruimronde die de regels afdwingt.

### Wat de code verklaart

- **De plafond-tegenstrijdigheid is een echte bug, geen data.** `governance_ceiling()` (`apps/api/app/services/ai_handling.py`) leidt het plafond voor AI-afhandeling af van de toolcategorie "messaging". Govern toont de naam van de preset ("Geassisteerd"). Staat de categorie Gesprekken op Toestaan, dan is het effectieve plafond Autonoom terwijl Govern "Geassisteerd" laat zien. Het zijn twee plafonds onder één naam.
- **De autonomie-logica bestaat al in één functie.** `resolve_ai_handling()` combineert negen bronnen: werkruimte, kanaal, contact, gesprek, Govern, privacy, noodrem, agent, label en flow. Het resultaat geeft al `source` en `clamped_by` terug. De "Waarom?"-knop is dus vooral UI op data die er al is.
- **De Bokito-assistent is een gewone agent-rij.** Hij heeft `acts_for_user=true` (`apps/api/app/models/agent.py`) en verschijnt daarom op Agents, Grid, Workforce en in de Agenda-filters, terwijl de docs het tegendeel zeggen. Eén filter op de API lost dat overal op.
- **Flow-fasen staan op twee plekken:** in `Workstream.stages_json` en in de tabel `workstream_stages`. Dat verklaart waarschijnlijk de dubbele fasen (Active, Actief, Active 2).
- **Er staat code die niemand gebruikt.** `apps/api/app/routers/custom_db.py` (513 regels) zit niet in `main.py`. `/ops` en `/learn` zijn nog bereikbaar maar staan niet in de rail.
- **De rail staat op één plek** (`apps/dashboard/src/lib/navigation.ts`). Van 12 naar 7 items is een kleine wijziging.
- **De subtitels spreken de docs tegen.** Agents heet "Mensen en agents waarmee je kunt chatten", waarmee het overlapt met Workforce. Ook staat "Overview" op twee sleutels (overview en cockpit) en "Mappen" op twee (folders en projects) in `locales/nl/nav.json`.

### Wat dit verandert aan de route

1. **Niet herbouwen.** De V2-herbouw van september is op 1 oktober in zijn geheel verwijderd (`BOKITO_KNOWLEDGE.md` §42). Deze opruimronde gaat over hernoemen en verbergen op het bestaande V1-model.
2. **Eerst opruimen, dan de gedeelde UI-bibliotheek.** Het plan `docs/plans/shared-ui-library.md` port Nieuwe chat, de zijbalk en de Agenda naar mobiel. Doe je dat eerst, dan neem je de verwarring mee naar de app.
3. **Fase 3 (autonomie) is kleiner dan gedacht.** De resolver hoeft niet herschreven te worden. Er moeten drie dingen gebeuren: één plafond dat de UI toont (de effectieve waarde uit de resolver), de lagen contact, label en flow verbergen of samenvoegen, en één scherm.

## Wat bekeken is

Op 19 oktober is de dev-omgeving doorgelopen (versie 1.2.18, werkruimte Bokito) en vergeleken met de [featurepagina](https://dev.app.bokito.ai/docs/getting-started/features). Er is alleen gekeken, niets gewijzigd.

Bekeken schermen: Nieuw gesprek, Overview, Communicatie met een open gesprek, Mappen met de hub van "bokito platform", Flows, Agenda, Agents, Kennis, Grid, Workforce, Koppelingen, en in Instellingen het profiel, AI-afhandeling en Govern (Autonomie). Kanalen, Labels, Modellen en Ontwikkelaars zijn niet geopend.

## Bevindingen

Een gebruiker ziet in de app vaker dezelfde dingen onder een andere naam dan de docs doen vermoeden. Hieronder per thema wat er op het scherm staat.

### 1. Eén ding, meerdere namen

| Begrip | Namen in de app | Waar |
| --- | --- | --- |
| Map | Map, Project, Projecten | Kruimelpad zegt Map; "Terug naar projecten"; veld "Project" in het gespreksdetail; Kennis labelt mappen als "Project"; Govern heeft de toolcategorie "Projecten" |
| Flow | Flow, Playbooks (docs), workstreams (URL), "Open tickets per actietag" (Overview) | Rail, docs, Overview |
| Voor jou | Voor jou, Jij bent nodig, Needs you (docs) | Communicatie, Overview, docs |
| Afdeling | Afdeling, Teams, team (URL), All / Root | Workforce: kolom "Teams", sectie "Afdelingen" |
| AI-afhandeling | AI-afhandeling, AI-antwoordinstellingen | Instellingen, Agents |
| Nieuw gesprek | New chat, Nieuw gesprek, Nieuwe chat starten | Rail, Communicatie, lege staat |
| Koppelingen | Koppelingen, Integraties | Paginatitel "Instellingen / Integraties" |
| Govern-kasboek | Ledger | Govern |

### 2. De naam Bokito betekent vijf dingen

Bokito is het platform, de werkruimte en de hulp in de hoek (de mascotte). "Bokito assistant" is daarnaast een company-agent: die staat op Agents, op Grid en in "Chat met agents". "Boekito" is de agent uit de boekhoudmodule. Er is ook nog "Mijn assistent" in de persoonlijke instellingen.

De docs zeggen dat de Bokito-assistent géén agent is en niet op Grid staat. In de app staat "Bokito assistant" juist wel tussen de agents.

### 3. Groeperen kan op zes manieren

Label, actietag, flow, map, afdeling en kanaal ordenen allemaal gesprekken. In de app lopen ze door elkaar:

- "Development" is zowel een map als een afdeling. "Support" is een kanaal, een afdeling én een flow (op Grid).
- De zijlijst van Agenda zet mappen en losse labels (documentatie, qa_bundel_a, bug, feature) in één boom.
- De map "bokito platform" heeft het label `feature`. Dat is ook een actietag van een flow. Zo wordt een flow-label tegelijk een mapfilter.
- Communicatie toont Flows, Kanalen, Chat met agents en Afdelingen in één zijbalk. Kanalen staat er twee keer in: als sectie en onderaan als link.

### 4. Autonomie zit op ruim tien plekken

Op de pagina AI-afhandeling staat:

- een werkruimte-standaard
- uitzonderingen per kanaal, contact en gesprek
- een plafond
- een pauzeknop
- een zekerheidsdrempel
- controle voor nieuwe contacten
- een noodrem
- overdrachtsregels en een pingpong-limiet
- "labels die altijd controle nodig hebben"

Govern heeft daarnaast:

- een werkruimte-plafond
- autonomie per label
- autonomie per flow, apart van het label met dezelfde naam
- regels per agent
- regels voor alle agents
- toestemmingsniveaus per toolcategorie

De agentpagina heeft ook nog "Tools en toestemmingen".

**Tegenstrijdigheid op het scherm:** AI-afhandeling toont "Plafond: Autonoom", maar Govern zegt dat het werkruimte-plafond op Geassisteerd staat. Workforce toont bij elke agent "Geassisteerd". Een gebruiker kan zo niet zien wat de AI nu echt mag.

### 5. "Wat moet ik doen" heeft vier ingangen

Overview (Jij bent nodig), Communicatie (Voor jou, 27), de bel (9) en de teller bij Agents op de rail (2) tonen elk een ander getal. Overview zegt "Geen open tickets". Workforce toont tegelijk 60 open bij Lorenzo en 117 open bij Orchestrator.

### 6. Getallen verschillen per scherm

| Wat | Scherm A | Scherm B |
| --- | --- | --- |
| Aantal flows | Flows-pagina: 2 | Grid: 5 (ook Monthly close review, Support, VAT filing preparation) |
| Aantal agents | Agents en Workforce: 4 | Grid: 3 |
| Open tickets | Overview: 0 | Workforce: 117 open bij Orchestrator |

Dit kan een datakwestie in dev zijn. Voor de gebruiker voelt het als een product dat zichzelf niet kent.

### 7. Kleinere visuele onduidelijkheden

- Op de Flows-pagina staat het actieve item in de rail op Mappen, niet op Flows.
- De fasen van flow `feature` mengen talen en dubbelen: Not started, Niet gestart, Actief, Active, Active 2.
- Een flow en zijn label staan dubbel naast elkaar ("bug" + chip "bug").
- De Agenda zet elke chat als activiteit in de dag, dus de kalender loopt vol met chatregels. De legenda kent ook "Taken", een begrip dat in de docs niet bestaat.
- In een gesprek met Boekito zegt de opsteller "Vraag Extra test agent". Het is daardoor niet duidelijk wie je aanspreekt.
- Engels en Nederlands lopen door elkaar: New chat, Overview, Files, Ledger, workspace-standaard, Marketplace, Skills, Docs.
- Koppelingen toont dubbele ingangen voor hetzelfde systeem: Exact Online in de module én als Exact Online MCP, GitHub én GitHub tools, Alpaca in de module Beleggen én als MCP.
- Agents aannemen kan op twee manieren: Marketplace op Workforce, en modules op Koppelingen.
- De startpagina-keuze biedt "Chat" en "Communicatie" als twee aparte opties.

## Voorstel: vijf begrippen, zeven rail-items

Het product draait om vijf begrippen, elk met één naam en één plek:

- **Gesprek:** alles wat binnenkomt of wordt gestart. Een status maakt het een ticket, een datum zet het op de agenda.
- **Map:** waar werk bij elkaar hoort, met eigen gesprekken, een bord, kennis en rapporten.
- **Flow:** de fasen voor één soort ticket. Het label is het mechanisme eronder, geen apart begrip voor de gebruiker.
- **Agent:** een AI-medewerker met een plafond.
- **Autonomie:** wat een agent mag. Dat stel je in op één pagina, in drie lagen.

Label, afdeling, kanaal en contact blijven bestaan als eigenschappen en filters. Ze zijn geen plekken om naartoe te gaan.

| Nieuw rail-item | Neemt over |
| --- | --- |
| Communicatie | Startweergave Vandaag (was Overview); Voor jou, kanalen, filters op flow en afdeling |
| Agenda | Gepland en due werk, één teller; chatactiviteit als filter, standaard uit |
| Mappen | Hub: gesprekken, bord, kennis, rapport; heet overal Map, nooit Project |
| Flows | Was Playbooks, actietag en workstreams; fasen per flow, altijd-controle als optie |
| Agents | Bibliotheek met Kennis als tab; aannemen via één flow (modules + Marketplace) |
| Workforce | Mensen, agents, afdelingen; Grid als tab; plafond per agent staat hier |
| Instellingen | Govern: één autonomie-dial plus logboek; Koppelingen, verbruik, Werkbank (Ontwikkelaars) |
| Nieuw gesprek | Knop bovenaan de rail, geen rail-item; vervangt New chat en Nieuwe chat starten |

Overview, Kennis, Grid en Koppelingen verdwijnen als eigen rail-item. Ze worden een tab of een instelling bij het item waar ze bij horen.

## Wijzigingen voor developers

Alles hieronder valt onder één release: "Eén product". De volgorde is van goedkoop met veel impact naar meer werk.

### Fase 1 — Eén woordenlijst (vooral copy)

- [ ] Leg een woordenlijst vast als bron in de repo: één term per begrip, NL en EN. Laat UI, docs en URL-slugs daaruit komen.
- [ ] Map overal "Map" noemen: "Project" en "Projecten" vervallen in het kruimelpad, het gespreksdetail, Kennis en de Govern-toolcategorie.
- [ ] Flow overal "Flow" noemen: "Playbooks" en "actietag" verdwijnen uit de UI, en de URL `/flows` wordt `/flows`.
- [ ] Eén naam voor de persoonlijke lijst: "Voor jou". "Jij bent nodig" en "Needs you" vervallen.
- [ ] Afdeling overal "Afdeling" noemen: "Teams", "All" en "Root" vervallen, en `/team` wordt `/afdelingen`.
- [ ] Eén knop en één naam: "Nieuw gesprek". De tweede knop in de Communicatie-zijbalk verdwijnt.
- [ ] Geen gemengde talen: New chat, Files, Ledger, Marketplace, Skills, Docs en workspace vertalen.
- [ ] Fasenamen van flows normaliseren en dubbelingen opruimen (Not started / Niet gestart, Active / Actief / Active 2).
- [ ] Werkwoorden kloppend maken: "archiveren" wordt "Ticket maken" of "In flow zetten".

### Fase 2 — Bokito betekent één ding

- [ ] Bokito is het platform en de hulp in de hoek. Dat is geen agent.
- [ ] Filter agents met `acts_for_user` uit alle tenant-lijsten (Agents, Grid, Workforce, Agenda, Chat met agents) en toon de assistent alleen als de hulp in de hoek. Voeg "Mijn assistent" in Instellingen daarmee samen.
- [ ] Geef module-agents gewone functienamen ("Boekhouder") of laat de klant ze een naam geven. Zo verdwijnt de bijna-dubbele naam Boekito.

### Fase 3 — Eén autonomie-model

- [ ] Eén pagina vervangt AI-afhandeling plus Govern › Autonomie. Volgens regel 5 van de noordster ("Autonomy is one dial in Govern") wordt dat Govern; het auditlog krijgt daar een eigen tab.
- [ ] Het model krijgt drie lagen:
    - plafond per agent (in Workforce)
    - standaard per kanaal
    - override per gesprek
- [ ] Contact, label en flow worden geen aparte autonomielagen. "Altijd controle" wordt een eigenschap van de flow.
- [ ] Veiligheidsknoppen bundelen onder "Waarborgen" op diezelfde pagina: drempel, noodrem, nieuwe contacten en pingpong.
- [ ] Toolcategorie-rechten verhuizen naar het plafond van de agent.
- [ ] Elk scherm toont het effectieve niveau uit `resolve_ai_handling()`. Govern toont niet langer de naam van de preset als plafond, want die wijkt af zodra een toolcategorie is aangepast. Dat is nu de oorzaak van "Plafond: Autonoom" naast "Geassisteerd".
- [ ] Fasen van een flow op één plek opslaan: `stages_json` of `workstream_stages`, niet allebei.

### Fase 4 — Eén ingang per taak

- [ ] Overview wordt de startweergave van Communicatie ("Vandaag") en verdwijnt als eigen rail-item.
- [ ] Verbruik en kosten verhuizen naar Instellingen.
- [ ] Grid wordt een tab binnen Workforce. Kennis wordt een tab binnen Agents en binnen elke map.
- [ ] Koppelingen gaat naar Instellingen. Marketplace en modules worden één "Agents aannemen"-flow.
- [ ] Dubbele integraties samenvoegen: één kaart per systeem (Exact, GitHub, Alpaca), met de module als laag erop.
- [ ] Communicatie-zijbalk: Flows en Afdelingen worden filters in plaats van eigen secties, en Kanalen komt er één keer in.
- [ ] Agenda toont standaard alleen geplande en due items. Chat-activiteit wordt een filter dat standaard uit staat.
- [ ] Badges en tellers rekenen allemaal uit dezelfde bron (Voor jou), zodat ze overal hetzelfde getal tonen.

### Fase 5 — Productfocus

- [ ] De Werkbank blijft (regel 9 van de noordster: werk overdragen aan tools die mensen al gebruiken), maar de instellingen voor codetools verhuizen naar Ontwikkelaars. Geef het kostenlabel "workbench" een categorie.
- [ ] Beslissen of modules als Beleggen in de standaardcatalogus passen bij de doelgroep. Anders verbergen per werkruimte-type.
- [ ] Kennissoorten terugbrengen naar Document en Geheugen. Persona hoort bij de instructie van de agent, Vaardigheid bij de module, en Heartbeat bij de Agenda.
- [ ] Canvas wordt een type gesprek-uitvoer ("Rapport") met één plek per map, in plaats van een eigen tab op Overview én op mappen.

## Nieuwe features die het ene product versterken

Dit zijn er bewust drie, en alle drie maken bestaande dingen begrijpelijker.

1. **"Waarom?" bij elk AI-antwoord en elk gesprek.** Eén klik laat vier dingen zien:
    - welke agent antwoordde
    - welk autonomieniveau dat toeliet, en waar dat niveau vandaan komt
    - welke kennis is gebruikt
    - waarom het gesprek in deze map of flow staat

    Dit lost de verwarring over overerving en lagen op zonder iets te schrappen. De data bestaat al: `resolve_ai_handling()` geeft `source` en `clamped_by` terug.
2. **Correctie wordt kennis.** Als iemand een concept van een agent bewerkt of afwijst, stelt Bokito een geheugenregel of instructiewijziging voor. Die verschijnt als beslissing in het gesprek. Dit is de kern van "zelfontwikkelend" en gebruikt Beslissingen en Kennis die er al zijn.
3. **Cmd+K als universele ingang.** De zoekbalk staat er al. Breid hem uit met acties: nieuw gesprek, ga naar map, wijs toe aan, zet autonomie. Dan kan de rail kleiner zonder dat iets onvindbaar wordt.
