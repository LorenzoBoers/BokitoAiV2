# Platformfeatures

Overzicht van wat Bokito nu is, van de schil tot de kleine knopen. Elke feature heeft een Engelse naam, een Nederlandse naam en een toelichting. De toelichting noemt de relaties, integraties en overlap met andere features.

Bronnen, in deze volgorde als ze botsen: `docs/CORE_INTENT.md`, de SQLModel-tabellen in `apps/api/app/models/`, de rail in `apps/dashboard/src/lib/navigation.ts`, `docs/architecture/multi-agent-threads.md`, `docs/architecture/module-one-time-drop.md`, en de operatorartikelen in `docs/product-help/`. Oudere handboeken (`docs/company/`, delen van `docs/architecture.md`, `apps/dashboard/docs/NAVIGATION.md`) beschrijven een eerdere indeling en zijn hier niet leidend.

Operators noemen zeven dingen: Gesprek, Actietag, Flow, Map, Contact, Agent, Beslissing. Al het andere is een scherm, een instelling of leidingwerk. Een nieuw zelfstandig woord hoort alleen als die zeven het niet kunnen zeggen.

---

## 1. Schil

### Platform

- **EN:** Bokito
- **NL:** Bokito
- **Toelichting:** Eén chatoppervlak voor het bedrijf. Klanten schrijven waar ze al schrijven. Het team en de agents antwoorden in één lijst. Achtergrondwerk start, verschijnt en wijzigt vanuit dat gesprek. Bokito vervangt Cursor, Claude of ChatGPT niet. Het beslist, geeft werk door, zet een poort en toont het resultaat naast het klantbericht. Langetermijndoel is een operationele digitale tweeling die je vanuit Overview en Govern bekijkt en via feedback verbetert.

### Tenant

- **EN:** Tenant / workspace
- **NL:** Werkruimte
- **Toelichting:** Elke klantorganisatie is een tenant (`tenants`), met een slug en `tenant_id` op alle domeinrijen. Leden hangen via `memberships`. Het product draait op het subdomein van de tenant. Het control plane (`app`) is alleen login en werkruimtekeuze. Relateert aan elke feature hieronder. Overlap: “workspace” in de UI en “tenant” in de API zijn hetzelfde ding.

### Dashboard

- **EN:** Dashboard / portal
- **NL:** Dashboard
- **Toelichting:** React-app (`apps/dashboard`) tegen FastAPI. De rail staat in `navigation.ts`. Vastgezet: New chat, Overview, Communication. Groep Work: Folders, Playbooks, Agenda. Groep AI: Agents, Knowledge, Grid. Groep Organization: Workforce, Connections, Settings. Govern is geen rail-item. Het zit onder Settings.

### Chat widget

- **EN:** Chat widget
- **NL:** Websitechat
- **Toelichting:** In te sluiten op de site van de klant (`apps/chat-widget`). Bezoekers loggen nergens in. Berichten worden een Gesprek op kanaal `widget`, gekoppeld aan een Contact. Zelfde gateway als het dashboard, maar een widget-principal mag alleen het eigen gesprek volgen. Zie Widget embed en Continue on WhatsApp.

### Mobile app

- **EN:** Mobile app
- **NL:** Mobiele app
- **Toelichting:** Expo-client op dezelfde login, dezelfde gateway en dezelfde Signal-API. Oppervlakken: assistent, berichten, beslissingen, thread met inline kaarten. Push via `POST /api/push/subscribe`. Geen aparte datalaag.

### Product help

- **EN:** Product help / Learn / Docs
- **NL:** Producthulp / Leren / Documentatie
- **Toelichting:** `docs/product-help/` voedt de publieke `/docs`, de ingelogde `/learn`, de assistent-RAG en `llms.txt`. De hoekassistent antwoordt vanuit deze artikelen. Relateert aan Bokito assistant en Knowledge. Dit is uitleg over het product, niet de kennis die agents over het bedrijf lezen.

### Realtime gateway

- **EN:** Gateway (WebSocket)
- **NL:** Gateway
- **Toelichting:** Alle live data gaat over `GET /api/ws`. Events: bericht, thread, agentbeurt, beslissing, notificatie, aanwezigheid, entiteit gewijzigd. Topics zijn werkruimtebreed of per gesprek of run. Dashboard, widget en mobiel upserten op id. Productie vereist Redis voor fan-out naar workers. Relateert aan elk scherm dat een lijst of thread live houdt.

### Worker

- **EN:** Worker (ARQ + Redis)
- **NL:** Achtergrondwerker
- **Toelichting:** Langere agentbeurten, triggers, inbound mail en deelnemerbeurten lopen als segmentjobs. Zonder Redis valt ontwikkeling terug op inline uitvoeren. Relateert aan Agent run, Trigger, Agenda en de gateway.

---

## 2. De zeven operatorobjecten

### Conversation

- **EN:** Conversation
- **NL:** Gesprek
- **Toelichting:** De enige thread (`signals` + `signal_messages`). Kanalen: email, chat, widget, Slack, WhatsApp, webhook, integration, api, internal, assistant. Een status maakt het een ticket. Een datum (`next_at`; oudere tekst zegt `follow_up_at`) maakt het een agenda-item. Een herhaling maakt het terugkerend. Een agent-run leeft in zijn gesprek. Berichten zijn klantbericht, agentbericht, run, beslissing, status, taakresultaat, systeemgebeurtenis of interne notitie. Eigenaar is één principal (persoon, agent of afdeling). De beurt is wie nu moet handelen. Deelnemers (`signal_participants`) zeggen wie betrokken is. Relateert aan alles. Communication is het scherm. Overview, Agenda en Agents zijn andere deuren naar dezelfde rijen.

### Action tag

- **EN:** Action tag
- **NL:** Actietag
- **Toelichting:** Een hashtag in `signal_tags` met een `workstream_id`. Hoogstens één per gesprek (`ticket_tag_id`). Archiveren maakt het gesprek een ticket met `ticket_status` (proposed, open, waiting, done, closed) en `stage_key`. Kleur en icoon bestaan alleen zolang de flow eraan hangt. Vrije hashtags op hetzelfde register zijn labels, geen achtste object. Ze hangen ook aan contacten en bedrijven en erven mee naar het gesprek. Relateert aan Flow, Map, Labels, Communication en triage. Overlap: rail en instellingen zeggen nog Playbook, Category of Labels voor delen van dit object.

### Flow

- **EN:** Flow
- **NL:** Flow
- **Toelichting:** De fasepijplijn van precies één actietag (`workstreams` + `workstream_stages`). De lijst toont een titel naast het label (`#klacht`). Het label blijft de archiefidentiteit. Per fase een eigenaar: persoon, agent of afdeling (`workstream_stage_owners`). Een flow kan kanalen en koppelingen binden. De oude stapmachine is geen tabel meer. Relateert aan Actietag, ticket op het Gesprek, Map (het bord per map), Agenda (stage-checkup als trigger) en Agents (wie de fase doet). Overlap: de rail heet Playbooks. De tabel heet workstream. De help en de intentie zeggen Flow.

### Folder

- **EN:** Folder
- **NL:** Map
- **Toelichting:** Een benoemde plek in een vrije boom (`projects.parent_id`). Optionele labels (`project_tag_links`) zijn een EN-filter: het gesprek hoort erbij als het élk label dekt, inclusief labels van contact en bedrijf. Nesten verplaatst alleen de knoop. `Signal.project_id` is de cache van de diepste passende map. Op de hub: gesprekken, ticketbord, canvas, documenten en bestanden. Er is geen agent, budget of repository per map. Relateert aan Actietag, Labels, Knowledge (zelfde documenttabel) en Flow (bord). Overlap: het artikel Folders zegt “één label is genoeg”. Code, intentie en het artikel Labels zeggen EN. Communication noemt afdelingen ook mappen. Dat is een ander object (Department).

### Contact

- **EN:** Contact
- **NL:** Contact
- **Toelichting:** De persoon aan de andere kant (`contacts`), per kanaal, met status approved, pending of blocked. Een bedrijf (`companies`) koppelt op e-maildomein. Labels op contact en bedrijf tellen mee voor mappen en voor de effectieve tags van het gesprek. Een gesprek koppelt via verified, claimed, manual of een inkomend adres. Relateert aan Communication, Channels (pairing), Widget, Company en Map. Samenvoegen, splitsen, blokkeren en verwijderen zijn owner of admin. Naam en adres mag een lid wijzigen.

### Organization

- **EN:** Organization (company record)
- **NL:** Bedrijf
- **Toelichting:** CRM-bedrijf bij een contact, niet de tenant. Labels erven naar elk contact van dat bedrijf en daarmee naar hun gesprekken. Relateert aan Contact en Map. Verwijderen en backfill zijn owner of admin.

### Agent

- **EN:** Agent
- **NL:** Agent
- **Toelichting:** AI-medewerker (`agents`), type `ai_agent`. Eén vorm: naam, functietitel, omschrijving, instructie, model, tools, autonomieplafond. Eén actieve agent is lead en vangt wat nergens specifieker is gebonden. `chat_access` is everyone, selected of nobody. De rol (assistant, orchestrator, po, coding, orchestra) zet alleen het standaard paspoort. Relateert aan Communication (gesprekken), Workforce (gids), Grid (markering), Channels (standaardagent), Flow (fase-eigenaar), Knowledge (agentdocumenten), Govern (paspoort) en Connections (module-roster). Overlap: dezelfde agent staat op vier schermen. De persoonlijke assistent Bokito is wel een agentrij (`acts_for_user`) maar hoort niet in de bibliotheek en niet op Grid.

### Decision

- **EN:** Decision
- **NL:** Beslissing
- **Toelichting:** Een vraag in het gesprek (`decision_requests`, berichtsoort `decision_request`). Status: awaiting_human, approved, rejected, deferred. De geadresseerde is een persoon of een afdeling. Goedkeuren voert de gekoppelde tool opnieuw uit of past een Platform change toe. Kaarten uit dezelfde agentbeurt vormen één bundel. Relateert aan Communication, Overview (Needs you), notificaties, Govern (alleen de structurele boeking) en Autonomy. Overlap: Govern is het kasboek, niet een tweede inbox. Needs you en For you tonen dezelfde kaarten nog eens.

---

## 3. Rail — vastgezet

### New chat

- **EN:** New chat
- **NL:** Nieuw gesprek
- **Toelichting:** Pad `/new`. Start een gesprek met een company-agent waarvoor chat-toegang openstaat, of een uitgaand klantbericht. Zonder bereikbare agent zegt de composer dat er geen agents zijn. Relateert aan Agent (`chat_access`), Communication en Channels. Overlap: drie startdeuren. Deze pagina, een agentgesprek vanuit Communication, en Bokito in de hoek. De hoekhulp is verborgen op dit scherm en in een open thread. Help in de bovenbalk opent hem dan.

### Overview

- **EN:** Overview
- **NL:** Overview
- **Toelichting:** Pad `/cockpit` (ook `/overview` en `/home`). De ochtendscan: Needs you, AI-activiteit, open tickets per label, wat loopt en wat volgt, traject van de week. Klikken opent het onderliggende gesprek, de run of de gefilterde lijst. Tabs: Overview, Usage, Canvas. Een stille werkruimte toont de setupvoortgang. Relateert aan Communication (Needs you is For you), Agenda, Agent run, Govern, Usage en AI handling. Budget wijzigen is owner of admin. Overlap: geen eigen wachtrij. Het is een venster op gesprekken en runs.

### Canvas

- **EN:** Canvas
- **NL:** Canvas
- **Toelichting:** Momentopname-dashboard, geen live tegels. Op Overview kiest een lid een agent. Die agent bouwt het canvas in een gesprek. Verversen is de herhaling van dat gesprek op de Agenda. Mappen hebben hun eigen canvas op de hub. Relateert aan Agent, Gesprek, Agenda, Folder en Knowledge. Het oude OS-canvas (`/os`, graafknopen) is uit de rail en het endpoint is retired. De intentie noemt `/os` nog.

### Usage

- **EN:** Usage
- **NL:** Verbruik
- **Toelichting:** Tab op Overview. Tokenverbruik tegen een budget (`usage_ledger` per runsegment). Het budgetplafond wijzigt alleen owner of admin. Relateert aan Agent run, Models en Overview. Kosten omzeilen een goedkeuring niet.

---

## 4. Rail — Communication

### Communication

- **EN:** Communication
- **NL:** Communicatie
- **Toelichting:** Pad `/communication`. Het bureau van de dag. Klantmail, websitechat, Slack, WhatsApp, interne agentthreads en chats met company-agents in één hub. Wachtrijen zijn weergaven, geen tabellen: For you, open, unassigned, closed, spam, en views per kanaal. De zijbalk toont afdelingen als mappen met Unassigned eronder, plus een Agents-map voor interne chats. Het gesprek is het logboek: wat een agent deed staat als bericht in de thread. Relateert aan alle zeven objecten, Channels, AI handling, Agenda (plannen vanuit de thread) en Grid (Open in Grid). Overlap met Overview, Agents (open gesprekken per agent) en Agenda (due werk).

### For you

- **EN:** For you
- **NL:** Voor jou
- **Toelichting:** Gesprekken waarvan de beurt of een open beslissing bij jou of jouw afdeling ligt. Hetzelfde blok heet Needs you op Overview. De bel-badge telt dezelfde rijen en opent deze wachtrij. Relateert aan eigenaarschap, Decision en Notifications.

### Queues and lists

- **EN:** Queues
- **NL:** Wachtrijen
- **Toelichting:** All, Open, Unassigned, Closed, Spam, per kanaal, per afdeling, per agent, per label of flow. Filters, geen aparte opslag. Relateert aan Gesprek, Department, Channel, Actietag en Folder.

### Composer

- **EN:** Composer
- **NL:** Opsteller
- **Toelichting:** Reply, Ask AI, Note. Notitie is `internal_note` en gaat niet naar de klant. E-mail kent reply, reply all en forward. `/ticket #naam` archiveert een ticket. Een mens die typt zet `human_composing_until`, zodat een autonome agent dan een concept maakt in plaats van te versturen. Relateert aan AI handling, Decision (concept ter goedkeuring) en Channel (verzendpad).

### Plan

- **EN:** Plan
- **NL:** Plannen
- **Toelichting:** Vanuit een gesprek een datum of herhaling zetten. Dat schrijft `next_at` en, bij herhaling, een Trigger met `signal_id`. Agenda toont het. Sluiten duurt tot de volgende run. Relateert aan Agenda, Trigger en Gesprek. Geen tweede takenlijst.

### Assignment

- **EN:** Assignment
- **NL:** Toewijzen
- **Toelichting:** Het gesprek krijgt één eigenaar: persoon, agent of afdeling. Toewijzen aan een persoon zet AI-afhandeling van dat gesprek op Handmatig, reden assigned. Zonder toewijzing valt het op de routing-eigenaar van het kanaal, anders op All. Ophalen door een afdeling volgt de pickup-stand. Relateert aan Department, Channel, Presence en AI handling.

### Internal note

- **EN:** Internal note
- **NL:** Interne notitie
- **Toelichting:** Bericht in het gesprek dat de klant niet ziet. Zelfde thread, andere soort. Relateert aan Composer en deelnemers.

### Reactions

- **EN:** Reactions
- **NL:** Reacties
- **Toelichting:** `message_reactions` op een bericht. Klein signaal naast Feedback. Relateert aan Gesprek en Learning.

### Split conversation

- **EN:** Split conversation
- **NL:** Gesprek splitsen
- **Toelichting:** Een tweede verzoek in dezelfde provider-thread wordt een kindgesprek. Het kind houdt het provider-id. Het oudergesprek wijst vooruit, zodat nieuwe inbound in het kind landt. Relateert aan Actietag (tweede ticket) en Contact.

### Handled externally

- **EN:** Handled externally
- **NL:** Al afgehandeld buiten Bokito
- **Toelichting:** Een gesprek sluiten omdat het antwoord elders is gegeven, zonder een nepantwoord te versturen. Relateert aan Gesprek-status en AI handling (geen antwoord nodig).

### No reply needed

- **EN:** No reply needed
- **NL:** Geen antwoord nodig
- **Toelichting:** De lezing zegt dat er niet geantwoord hoeft te worden. Herhaalde keuzes worden een Inbox rule (auto-sluiten, taak, of AI dempen voor afzender, domein of lijst). Relateert aan Learning, Inbox rule en AI handling.

### Suggested reply

- **EN:** Suggested reply
- **NL:** Voorgesteld antwoord
- **Toelichting:** Concept van de agent in het gesprek. In Geassisteerd keurt een mens goed, bewerkt of wijst af. Een verouderd concept (de klant schreef daarna opnieuw) wordt als zodanig gemarkeerd. Relateert aan AI handling, Decision en Composer.

### Ask assistant in a thread

- **EN:** Ask assistant
- **NL:** Assistent vragen
- **Toelichting:** Vanuit een klantgesprek een assistant-gesprek openen. `context_signal_id` injecteert het transcript, zodat het antwoord in de live thread blijft. Sessie kan actief of gesloten zijn, met een checkout-samenvatting. Relateert aan Bokito assistant en Gesprek. Dit is niet de hoekwidget en niet een company-agent.

### Customer verification

- **EN:** Customer verification
- **NL:** Klantverificatie
- **Toelichting:** Magic link op het gesprek (`customer_verify_tokens`, velden `assurance_*` op het signaal). Een actietag kan `requires_verification` eisen vóór een gevolgrijke stap. Relateert aan Contact, Actietag en Widget. Een bezoeker zonder stabiel adres koppel je handmatig. Een merge daarbij is owner of admin.

### Handover code

- **EN:** Handover code
- **NL:** Overdrachtcode
- **Toelichting:** Korte code om een widgetgesprek op WhatsApp voort te zetten (`handover_codes`). De klant stuurt de code. Inbound koppelt het nummer aan dezelfde persoon. Relateert aan Widget, WhatsApp en Contact.

### Thread pin

- **EN:** Pin
- **NL:** Vastzetten
- **Toelichting:** Per gebruiker (`signal_thread_pins`). Persoonlijke ordening, geen eigenschap van het gesprek voor het hele team.

### Example conversation

- **EN:** Example
- **NL:** Voorbeeld
- **Toelichting:** Een gesloten gesprek markeren als leervoorbeeld (`is_example`). Het transcript blijft de bron. De vlag zet het alleen in few-shot retrieval. Relateert aan Learning en Knowledge.

### Participants and floor

- **EN:** Participants / floor
- **NL:** Deelnemers / beurtvloer
- **Toelichting:** Meerdere mensen en agents in één gesprek, zonder een kamer-object. Rollen: owner, member, watcher. Tools: uitnodigen, verlaten, een zichtbaar bericht posten, de beurt vragen. `@agent` in de composer maakt deelnemer en geeft de vloer. Te veel beurten achter elkaar van één agent dwingen een beslissing af. Relateert aan Agent, Decision en de gateway (presence van de actieve beurt). Uit `docs/architecture/multi-agent-threads.md`.

---

## 5. Rail — Work

### Folders

- **EN:** Folders
- **NL:** Mappen
- **Toelichting:** Pad `/folders`. Boom, lidmaatschap via labels, hub met overzicht, bord, canvas, documenten en bestanden. Leden lezen. De UI verstopt hernoemen, labels, nesten en verwijderen voor niet-admins. De API voor aanmaken en wijzigen eist die rol niet. Relateert aan Map, Actietag, Flow, Knowledge en Canvas. Overlap met Department-mappen in de Communication-zijbalk, en met Knowledge voor documenten.

### Folder board

- **EN:** Board
- **NL:** Bord
- **Toelichting:** Tickets van de flows waarvan de actietag in de map zit, per fase. Hetzelfde bord staat op de flow, met een baan per map. Relateert aan Flow, Actietag en Gesprek. Geen aparte tickettafel.

### Folder files and resources

- **EN:** Files / resources
- **NL:** Bestanden / bronnen
- **Toelichting:** Bestanden en `project_resources` op de map. Optioneel een workbench-koppeling zodat codewerk naar een extern gereedschap gaat. Relateert aan Workbench en Connections. Bokito host geen IDE, repo-browser of diff.

### Project queue

- **EN:** Queue item
- **NL:** Wachtrij-item
- **Toelichting:** Intern werkboek (`agent_tasks` met soorten feature, bug, task, idea, risk). Geen operatorwoord. De intentie verbiedt Task als achtste zelfstandig naamwoord. Getypeerd klantwerk is een ticket. Relateert aan Agent run en Folder. Overlap met tickets als beide “werk dat gedaan moet worden” lijken.

### Playbooks

- **EN:** Playbooks (rail) / Flows (product)
- **NL:** Playbooks (rail) / Flows (product)
- **Toelichting:** Pad `/flows`. Het scherm van Flow. Leden zien het bord. Aanmaken, fasen en verwijderen: owner of admin. Een nieuwe flow kiest een vrije hashtag of maakt er een, met kleur en icoon. Een hashtag die al een flow heeft kan geen tweede starten. Relateert aan Actietag, Labels, Folder, Agenda en Department (een flow hoort bij een afdeling). Naamconflict: rail zegt Playbooks, subtitel “repeatable step-by-step playbooks”, terwijl de stapmachine is verwijderd en de intentie het woord Playbook afraadt.

### Stages

- **EN:** Stages
- **NL:** Fasen
- **Toelichting:** Open, waiting, done, closed. Ticketstatus spiegelt de fase, plus proposed vóór de pijplijn. Per fase een checkup-interval. Die checkup is een Trigger met purpose `stage_checkup` en gaat bij afvuren naar de eigenaar van dat moment. Relateert aan Agenda, Trigger en Assignment.

### Intake fields

- **EN:** Intake fields
- **NL:** Invoervelden
- **Toelichting:** Optionele velden op de fasen van een flow. Waarden staan op het gesprek (`ticket_fields_json`). Relateert aan Actietag en Gesprek. Geen apart formulierobject.

### Agenda

- **EN:** Agenda
- **NL:** Agenda
- **Toelichting:** Pad `/agenda`. Dag, week, maand, lijst. Toont wat gebeurde, wat due is en wat gepland is, voor mensen en agents, plus Google- of Outlook-afspraken. De zijlijst What is dezelfde labelboom als Communication. Mensen, agents en externe agenda’s zet je aan of uit. Een item opent het gesprek, de map of de agent. Het railgetal telt due taken op open gesprekken die aan jou zijn toegewezen. Relateert aan Trigger, Gesprek (`next_at`, `ends_at`, `schedule_json`), Stage checkup, Connections (agenda-apps) en Overview (Running and next up). Overlap: vier bronnen op één rooster. Werkdatums, triggers, checkups en externe agenda’s.

### Trigger

- **EN:** Trigger
- **NL:** Trigger
- **Toelichting:** De enige planner (`triggers`). Soorten: cron, interval, heartbeat, webhook, once, event. Elke trigger heeft een gesprek. De wake draait en rapporteert daar. Doel leeg is een operator- of agentwake. `stage_checkup` is de terugkerende blik op een ticket. Webhook vuurt via `POST /api/hooks/{id}` met een gedeeld geheim. Aanmaken, wijzigen, verwijderen en nu draaien: owner of admin. Het woord Trigger hoort niet in de UI. De operator ziet Agenda of Plan. Relateert aan Agent, Flow, Gesprek en Worker.

### Heartbeat

- **EN:** Heartbeat
- **NL:** Heartbeat
- **Toelichting:** Triggersoort die een checklist uit kennisdocumenten van soort heartbeat in de prompt zet. Antwoord exact `HEARTBEAT_OK` wordt onderdrukt. Al het andere komt in een intern gesprek. Nieuwe tenants krijgen een uitgezette heartbeat van 30 minuten. Relateert aan Knowledge en Communication.

### External calendar

- **EN:** Calendar
- **NL:** Agenda-koppeling
- **Toelichting:** `tenant_calendars` en `calendar_events`, plus `calendar_tag_links`. Sync haalt 90 dagen terug en 180 vooruit. Uitgezette agenda’s staan als Off. Aanzetten start de sync. Vergaderingen negeren het labelfilter van Agenda. Relateert aan Connections en Resource grant (wie de agenda mag gebruiken).

---

## 6. Rail — AI

### Agents

- **EN:** Agents
- **NL:** Agents
- **Toelichting:** Pad `/agents`. Bibliotheek van company-agents. Kaarten met open gesprekken, beslissingen, activiteit en de map als de agent een map leidt. Zoeken en filters All en Working. Leden lezen en mogen chatten. Aanmaken, instructie, model, tools, chat-toegang, handtekening, lead en archiveren: owner of admin. Een lid mag regels zetten. Het plafond naar Autonoom verhogen niet. Deactiveren haalt de agent uit de bibliotheek, wist kanaaldefaults en zet open gesprekken op de lead. Geschiedenis blijft. Relateert aan Workforce (zelfde deactiveren en hetzelfde plafond), Communication, Models, Govern en Knowledge.

### Lead agent

- **EN:** Lead / default agent
- **NL:** Leadagent
- **Toelichting:** Precies één actieve company-agent met `is_lead`. Terugval als een kanaal, gesprek of module niemand specifiekere bindt. Alleen owner of admin verlegt de lead. Relateert aan Channel (default agent wint niet van een pin op het gesprek) en Module roster.

### Agent passport

- **EN:** Passport
- **NL:** Paspoort
- **Toelichting:** Tools (`tools_json`), autonomieplafond en platformscopes op de agent. Lege scopes vallen terug op de rol. Govern toont en wijzigt paspoorten. De uitvoerlaag dwingt ze af bij elke toolaanroep. Relateert aan Autonomy, Tool registry en Agent role.

### Agent activity

- **EN:** Activity
- **NL:** Activiteit
- **Toelichting:** Tijdlijn van runs, wakes en heartbeats op Agents en op de agentpagina. Een punt opent de run, het gesprek of het agenda-item. Korte sessies tonen één kloktijd. Relateert aan Agent run en Agenda. Hetzelfde “nu bezig” staat ook in Communication, Workforce en op de map-lead.

### Chat access

- **EN:** Chat access
- **NL:** Chat-toegang
- **Toelichting:** Wie een direct gesprek met deze company-agent mag openen: iedereen, een lijst (`agent_chat_users`) of niemand. Bepaalt New chat en de Agents-map in Communication. Wijzigen is owner of admin.

### Bokito assistant

- **EN:** Bokito (personal assistant)
- **NL:** Bokito-assistent
- **Toelichting:** Eén agent per werkruimte met `acts_for_user`. Niet verwijderbaar, niet in de bibliotheek, niet op Grid. Zit in de hoek en onder Help. Kent het scherm, antwoordt vanuit producthulp, handelt binnen de rol van het lid en geeft werk door aan company-agents. Plafond is de werkruimterol gekruist met de houding. Een member mag via deze assistent geen mutaties doen aan agents, kanalen, triggers, integraties en govern. Privégesprekken (`channel=assistant`, `owner_user_id`). Instellingen onder Settings → My assistant, plus geheugen (`user_assistant_memory`). Relateert aan Product help, New chat en Delegation.

### Knowledge

- **EN:** Knowledge
- **NL:** Kennis
- **Toelichting:** Pad `/knowledge`. Markdown dat agents bij elke run lezen. Soorten: doc, memory, persona, skill, daily_log, heartbeat, project_doc. Scope is organisatie, map of agent, optioneel een afdeling. Een pagina (`workspace_docs`) bestaat uit secties (`doc_sections`) met status draft, review of final. Zoeken is hybride (vector plus trefwoord) over `doc_chunks`. Interne pagina’s gaan mee in retrieval. Publiceren maakt een klantartikel voor de widget. Elk lid mag schrijven via de API. Een agent die schrijft gaat via Govern. Relateert aan Agent (prompt: persona, geheugen, skills), Folder (zelfde tabel, andere deur), Heartbeat, Widget (help-artikelen) en Product help (dat is een andere corpus).

### Memory and persona

- **EN:** Memory / persona
- **NL:** Geheugen / persona
- **Toelichting:** `memory.md` en `persona.md`, gezaaid bij een nieuwe tenant, plus `company.md`. Lange threads worden samengevat naar `compact_summary`. Duurzame feiten gaan eerst naar het geheugen. Relateert aan Gesprek en Knowledge.

### Skills

- **EN:** Skills
- **NL:** Vaardigheden
- **Toelichting:** Kennisdocumenten van soort skill. De prompt noemt alleen naam en omschrijving. De agent leest de tekst via een tool als het nodig is. Een module-drop kan een skill meekrijgen. Relateert aan Knowledge en Module.

### Grid

- **EN:** Grid
- **NL:** Grid
- **Toelichting:** Pad `/grid`. Organisatiekaart: het bedrijf in het midden, afdelingen als eilanden, mensen, agents, kanalen en flows als markeringen. Labels en de persoonlijke assistent staan er niet op. Slepen verschuift het beeld. Een markering opent het item. Open in Grid staat op Workforce, Agents, Flows, Folders en Connections. Geen eigen rechten en geen tweede datamodel. Relateert aan Department, Agent, Channel en Flow. Overlap met Workforce: de kaart tekent wat de gids bewerkt.

---

## 7. Rail — Organization

### Workforce

- **EN:** Workforce
- **NL:** Workforce
- **Toelichting:** Pad `/team`. Gids van mensen, open uitnodigingen en company-agents, plus afdelingen. Type is Person of AI agent. Eigenaar of admin nodigt uit, wijzigt de werkruimterol, deactiveert en bouwt afdelingen. Alleen de owner wijzigt of deactiveert een andere owner. Het agentplafond staat in dezelfde kolom als de menselijke rol. Inhuren opent Connections gefilterd op modules. Relateert aan Agents, Department, Presence, Grid en Govern. Overlap: deactiveren en plafond bestaan ook op de agentpagina.

### Department

- **EN:** Department
- **NL:** Afdeling
- **Toelichting:** De enige groepering van mensen en agents (`departments`). Het model kent een wortel All (`parent_id` leeg, niet verwijderbaar). Daarnaast bestaan altijd de systeemafdelingen All people (Alle mensen) en All agents (Alle agents). Hun leden volgen de werkruimte. Pickup en lidmaatschap daarvan wijzig je niet, en ze verschijnen niet als map in Communication. Aangepaste afdelingen nesten en verschijnen daar wel. Leden (`department_members`) hebben duty primary, backup of member. Pickup: people, agent_first, round_robin, least_open. Round robin en least open slaan afwezigen en agents die het kanaal niet mogen over. Past niemand, dan blijft het gesprek bij de afdeling. Een module-installatie maakt één afdeling met `origin_module_slug`. “Geïnstalleerd” betekent dat die afdeling nog leeft. Verwijderen van de afdeling is de-installeren. Relateert aan Assignment, Channel routing, Flow, Grid, Module en Resource grant. Overlap met Map: beide heten in de zijbalk een map.

### Invite

- **EN:** Invite
- **NL:** Uitnodiging
- **Toelichting:** `invites` met rol admin of member. De owner-rol geef je niet via een uitnodiging aan een vreemde. Kan de server geen mail sturen, dan kopieer je de link. Opnieuw sturen en intrekken op Workforce. Accepteren maakt of werkt het lidmaatschap bij. Relateert aan Workspace role.

### Presence

- **EN:** Presence / away
- **NL:** Aanwezigheid / afwezig
- **Toelichting:** Beschikbaar, afwezig of offline. Afwezig zet je in het accountmenu. Agents slaan je over bij een vraag, afdelingen geven je geen nieuw gesprek, de widget telt je niet voor live overdracht. Een agent toont standby, werkend of fout, met een paarse markering. Relateert aan Department pickup, Widget handoff en de gateway.

### Workspace role

- **EN:** Workspace role
- **NL:** Werkruimterol
- **Toelichting:** Owner, admin of member op `memberships`. Oude labels worden admin of member. Staff telt als admin. Owner mag de werkruimte verwijderen en eigenaren wijzigen. Admin en owner nodigen uit en wijzigen structuur (kanalen, flows, agents, houding, Govern-voorstellen, modellen, prullenbak). Member werkt gesprekken, leest de bibliotheek en mag kennis schrijven. De UI verbergt veel wijzigingen die de API voor mappen niet blokkeert. Dit is niet de gesprekseigenaar, niet de deelnemerrol, niet de agentrol en niet de afdelingsduty. Al die vier gebruiken het woord owner of rol.

### Connections

- **EN:** Connections
- **NL:** Koppelingen
- **Toelichting:** Pad `/connections`. Eén pagina: wat gekoppeld is, daarna een raster van modules, partnerlogins en AI-gereedschap. Koppelen en installeren is owner of admin. Een partnerlogin geeft agents nog geen tools. Eerst de module installeren en een agent op het roster zetten. Mailboxen openen Channels. Agenda-apps openen Agenda. Relateert aan Module, MCP, Workbench, Channel, Govern (allowances voor integrations) en Resource grant. Het woord Connection is leidingwerk. De operator ziet Koppelingen.

### Module

- **EN:** Module
- **NL:** Module
- **Toelichting:** Een cataloguspakket dat één keer dropt (`docs/architecture/module-one-time-drop.md`). Drop maakt, als ze ontbreken: een afdeling met origin-slug, een specialist, verpakte tags, flows en een skill. Daarna is het gewone data. Geen reconcile, geen tweede scherm, geen rail-item. Voorkeuren zitten in `settings_json.modules` op de afdeling. De tabel `module_installs` is weg. Tools heten `{slug}_{verb}` en zijn alleen beschikbaar voor agents op `module_agents` (`can_write` scheidt lezen van voorstellen en toepassen). Partnerkoppelingen blijven aan de slug hangen, zodat een nieuwe installatie ze terugvindt. Koppelingen maakt de installatie niet zelf. Relateert aan Department, Agent, Actietag, Flow, Knowledge en Connections.

### MCP server

- **EN:** MCP server
- **NL:** MCP-server
- **Toelichting:** Twee richtingen. Uitgaand: de werkruimte roept een externe MCP-server aan (`mcp_servers`, tool `call_mcp_tool`). Inkomend: Bokito is zelf een MCP-server op `POST /api/mcp` voor Cursor, Claude, Codex, VS Code, Windsurf en ChatGPT. Zelfde toolregister als interne agents, trust `api`, token `bok_...` of OAuth (`mcp_oauth_*`). Clients beheer je onder Developers. Relateert aan Tool registry, API token, Govern en Workbench.

### Workbench

- **EN:** Workbench
- **NL:** Werkbank
- **Toelichting:** Een koppeling die codewerk buiten Bokito uitvoert. Providers: Cursor, Claude Managed, Devin, GitHub Copilot, OpenAI, MCP. Een `work_jobs`-rij is één opdracht op een gesprek of map, met status en uitkomst (merged, closed, abandoned). Het resultaat komt terug in het gesprek. Relateert aan Decision (gevolgrijke merge vraagt), Folder en Connections.

### Integration catalog

- **EN:** Integration catalog
- **NL:** Integratiecatalogus
- **Toelichting:** Hosts en providers (`integration_catalog_*`) plus de tenant-koppeling (`integration_connections`) en binding (`integration_bindings`). OAuth-state en providerverbindingen zitten ernaast. Relateert aan Connections, Channel (een mailbox kan aan een connection hangen) en Workstream connection.

---

## 8. Settings

Settings groepeert Personal, Workspace, Communication, Govern, Advanced en Help. De prullenbak staat onderaan. Connections zijn vanuit het palet vindbaar maar horen bij de rail.

### Profile and security

- **EN:** Profile & security
- **NL:** Profiel en beveiliging
- **Toelichting:** Voornaam, achternaam, taal van de UI (Nederlands of Engels), startpagina (Overview of Communication), uiterlijk, persoonlijke e-mailhandtekening, wachtwoord en TOTP. Taal van de UI is niet de werktaal van de organisatie. Relateert aan Channel signatures en AI handling (werktaal). Elk lid wijzigt alleen zichzelf.

### Notifications

- **EN:** Notifications
- **NL:** Meldingen
- **Toelichting:** Per laag: Now (push en in-app voor een gesprek of vraag voor jou, een nieuw bericht op wat jij of je afdeling bezit, een vermelding, een wachtende klant), Later (mislukte run, Govern-voorstel, geen push), Digest (teamactiviteit en afgeronde runs, dagelijkse mail). De bel opent For you. De lijst onder de bel houdt systeemberichten. Relateert aan Decision, Gesprek en Presence. Voorkeuren in `user_notification_preferences`. Push in `push_subscriptions`.

### My assistant

- **EN:** My assistant
- **NL:** Mijn assistent
- **Toelichting:** Instellingen van de persoonlijke Bokito, los van de company-bibliotheek. Relateert aan Bokito assistant.

### General

- **EN:** General
- **NL:** Algemeen
- **Toelichting:** Werkruimtenaam en algemene voorkeuren (`tenants.settings_json`). Owner of admin. Relateert aan Branding en de setupgids.

### Branding

- **EN:** Branding
- **NL:** Huisstijl
- **Toelichting:** Logo en uitstraling van de werkruimte, ook zichtbaar in de widget. Relateert aan Widget Look en Tenant.

### Channels

- **EN:** Channels
- **NL:** Kanalen
- **Toelichting:** Pad `/settings/channels`. Eén `channel_accounts`-rij per oppervlak: e-mail (Gmail, Outlook, SMTP/IMAP, Bokito-adres), widget, Slack, WhatsApp, internal. Status, mogelijkheden en checks komen uit het kanaalregister. Per kanaal: standaardagent, routing-eigenaar (persoon of afdeling), AI-afhandeling, handtekening, toegang (`resource_grants`), archiveren van automatische mail, pairing. Een pin op het gesprek wint van de standaardagent. Archiveren stopt sync en verzenden. Geschiedenis en de toegangslijst blijven. Verwijderen met alle data is een aparte, zwaardere actie. Wijzigen is owner of admin. Relateert aan Gesprek, Contact, Agent, Department, AI handling en Connections.

### AI handling

- **EN:** AI handling
- **NL:** AI-afhandeling
- **Toelichting:** Instelling, geen object. Autonomous, Assisted, Manual. Laag: werkruimte, kanaal, contact, gesprek. De specifiekste wint, onder het Govern-plafond voor messaging. Op het gesprek leeg betekent: volg de laag erboven. Sluiten wist de override. Toewijzen aan een persoon zet Handmatig. Uitzonderingen en waarborgen voor autonome antwoorden, labels die altijd een review eisen, en de werktaal zitten op Settings → Communication. Relateert aan Autonomy (het plafond), Suggested reply, Channel en Contact. Overlap: dezelfde drie woorden als het agentplafond en de werkruimtehouding, maar dit beslist of de AI de klant antwoordt.

### Labels

- **EN:** Labels
- **NL:** Labels
- **Toelichting:** Pad `/settings/labels`. Eén platte lijst van het hashtag-register. Flow-labels eerst, met kleur. Vrije labels blijven vlak. New label maakt een vrije hashtag. Create flow hangt er een flow aan. Save as map maakt een map. What we missed telt verzoeken die niets raakten. Who may confirm tickets bepaalt wie een AI-voorstel mag bevestigen. Leden mogen altijd zelf archiveren. Aanmaken en beleid wijzigen: owner of admin. Relateert aan Actietag, Flow, Folder, Communication en triage. Vijf deuren naar hetzelfde register: deze pagina, de flow, de map, het contact en de kiezer in het gesprek.

### Triage

- **EN:** Triage
- **NL:** Lezing
- **Toelichting:** Elk inkomend bericht wordt gelezen: samenvatting, prioriteit, labels, zekerheid, intentie. Een zekere lezing archiveert het ticket als het label auto-taggen aanstaat. Een zekere lezing op een label dat niet auto-tagt wordt een kaart File as. Een onzekere lezing vraagt Confirm of Dismiss op het gesprek. Zonder kanaalagent is er geen AI-lezing. Onder Handmatig leest de agent nog wel en mag hij labels zetten, maar stuurt hij geen klantantwoord. Relateert aan Actietag, AI handling, Decision en Inbox rule. Het systeem leest eerst. Mensen corrigeren.

### Govern

- **EN:** Govern
- **NL:** Govern
- **Toelichting:** Pad `/settings/govern`. Twee delen. Ledger: open voorstellen, geschiedenis, audit. Autonomy: werkruimteplafond, vergoedingen per toolcategorie, per-tool override, regels, paspoorten. Dagelijkse antwoorden blijven in Communication. Accepteren, afwijzen, terugdraaien en herstellen van een Platform change is owner of admin. Relateert aan Decision, Audit, Agent passport en Autonomy. Overlap met Needs you: alleen structurele wijzigingen horen hier.

### Autonomy posture

- **EN:** Autonomy posture
- **NL:** Autonomiehouding
- **Toelichting:** Het werkruimteplafond: Manual (alles vragen), Assisted (laag risico door, de rest vragen), Autonomous (handelen binnen vergoedingen, integraties blijven vragen tot je dat verlaagt). Autonomous vereist een live model en een kanaal dat kan versturen. Een label of flow mag strenger, nooit ruimer. Het agentplafond kan allow naar ask klemmen of ask naar allow tillen. Gevolgrijke tools (geld, contract, merge) vragen altijd tot een owner dat per tool verlaagt. Externe sessies (widget) muteren nooit zelf. Relateert aan AI handling, Tool registry, Decision en Models.

### Allowances and rules

- **EN:** Allowances / rules
- **NL:** Vergoedingen / regels
- **Toelichting:** Per toolcategorie een schuif deny, ask of allow: messaging, workspace, projects, agents, delegation, channels, triggers, integrations, govern, tickets. Per tool een override (“voortaan automatisch”). Werkruimteregels en agentregels zijn uitzonderingen op het plafond. Een routingregel stuurt vragen over een onderwerp naar wie ze beantwoordt. Regels test je voordat ze gelden. Relateert aan Agent passport, Decision en Platform change (een regelwijziging kan een voorstel zijn).

### Platform change

- **EN:** Platform change
- **NL:** Platformwijziging
- **Toelichting:** Elke structurele mutatie (`platform_changes`): agent, flow, document, integratie, MCP, canvas, paspoort, houding, categorie, map, trigger, agentregel, routingregel. Ask wordt pending review plus een beslissing in de thread. Allow past meteen toe (`applied_yolo`) met een terugdraaibare versie. Terugdraaien waar het ondersteund is. Relateert aan Govern, Decision en Audit.

### Audit

- **EN:** Audit log
- **NL:** Auditlog
- **Toelichting:** `audit_events` voor voorstellen, accepteren, afwijzen, toepassen, terugdraaien en voor geweigerde toolaanroepen. Het gesprek toont wat er gebeurde. Het logboek is de volledige boeking. Relateert aan Govern en Learning.

### Models

- **EN:** Models
- **NL:** Modellen
- **Toelichting:** Pad `/settings/models`. Werkruimte-standaard, beeldmodel, en per agent: werkruimte-standaard, automatisch, of een vast model (Maki, Bokito, Kong). Zonder live sleutel zijn antwoorden placeholders en worden ze niet als verzonden gelabeld. Een providerweigering blijft zichtbaar. Catalogus, tenantmodellen en providerverbindingen: `model_catalog`, `tenant_models`, `provider_connections`. Wijzigen is owner of admin. Relateert aan Agent, Usage, Autonomy (Autonomous eist een live model) en Privacy (niet-EU-modellen).

### Trust and privacy

- **EN:** Data & privacy / trust
- **NL:** Gegevens en privacy
- **Toelichting:** Pad `/settings/trust`. Bewaartermijn, of de AI berichtteksten mag gebruiken, EU-only modellen, exporteren of wissen van een betrokkene. Relateert aan Models, Bin, Contact en Gesprek. Owner of admin.

### Developers

- **EN:** Developers
- **NL:** Ontwikkelaars
- **Toelichting:** Pad `/settings/developers`. API-tokens, inkomende MCP-clients, uitgaande webhooks. Relateert aan MCP, Webhooks, API en Govern (tokens aanmaken en intrekken is owner of admin).

### API

- **EN:** Public API
- **NL:** API
- **Toelichting:** Zelfde-oorsprong `/api/*` naar FastAPI. Tokens `bok_...`, SHA-256 opgeslagen. Signal-API, thread-messaging, authenticatie en rate limits hebben een ontwikkelaarsartikel. De frontend bouwt paden alleen uit `apps/dashboard/src/api/routes/`. Relateert aan MCP (deelt het toolpad) en Webhooks.

### Webhooks

- **EN:** Webhooks
- **NL:** Webhooks
- **Toelichting:** Uitgaand: `webhook_endpoints` en `webhook_deliveries`, handtekening, snel antwoorden, opnieuw proberen. Inkomend: kanaalwebhooks (mail, Slack, WhatsApp) en trigger-hooks. Eindpunten beheren is owner of admin. Relateert aan Channel, Trigger en Developers. Twee verschillende “webhook”-dingen: abonneren op gebeurtenissen, en een wake van buitenaf.

### Help and setup

- **EN:** Help / setup guide
- **NL:** Help / instelgids
- **Toelichting:** `/settings/help` en `/settings/setup`. Checklist: huisstijl, team, kanalen, AI-afhandeling, kennis, agents, terugkerend werk. De productrondleiding (`tour`) wijst de rail. Relateert aan Product help, Onboarding en Overview (resterende stappen op een nieuwe werkruimte).

### Command palette

- **EN:** Command palette
- **NL:** Opdrachtpalet
- **Toelichting:** Ctrl+K of Cmd+K. Springt naar rail-items, wachtrijen, contacten en due taken. Relateert aan de hele navigatie. Geen eigen data.

### Bin

- **EN:** Bin
- **NL:** Prullenbak
- **Toelichting:** Pad `/settings/bin`. `trash_entries` is de index. De tombstone staat op de brontabel (`deleted_at`). Soorten: gesprek, contact, bedrijf, map, canvas, kennis, playbook, trigger, afdeling, inbox rule, bron, wachtrij-item. Herstellen of definitief wissen. Wissen van een betrokkene hangt hieraan. Owner of admin. Relateert aan Privacy en aan elke feature met een prullenbakkolom. De soortnaam playbook in de prullenbak is de flow.

---

## 9. Kanalen en widget, kleiner

### Email

- **EN:** Email
- **NL:** E-mail
- **Toelichting:** Gmail, Outlook, SMTP/IMAP of een Bokito-relayadres. Verzonden items kunnen meelezen. Handtekening per mailbox, met terugval op de persoonlijke handtekening. Automatische mail archiveren per mailbox. Inbound wordt een Gesprek via de e-mailadapter. Relateert aan Channel, Contact en Composer.

### Slack

- **EN:** Slack
- **NL:** Slack
- **Toelichting:** Events-API naar een Gesprek. Handtekening gecontroleerd. Antwoorden via `chat.postMessage`. Relateert aan Channel en Webhooks.

### WhatsApp

- **EN:** WhatsApp
- **NL:** WhatsApp
- **Toelichting:** Cloud-webhook en setup. Ook de bestemming van een widget-overdracht. Relateert aan Handover code en Channel.

### Widget embed

- **EN:** Widget
- **NL:** Widget
- **Toelichting:** Embed-snippet, Look, Voice, live overdracht, pre-chat formulier, help-artikelen uit Knowledge, doorgaan op WhatsApp. Bezoeker is een Contact, vaak pending tot pairing dat uitzet. Relateert aan Branding, Knowledge, Presence, Department en Customer verification.

### Pairing

- **EN:** Pairing
- **NL:** Koppelen van afzenders
- **Toelichting:** `require_pairing` op een kanaal zet een eerste afzender op pending. Het gesprek wacht op een operator. Blocked wordt bij de webhook geweigerd. Relateert aan Contact-status en Channel.

### Channel access

- **EN:** Channel access
- **NL:** Kanaaltoegang
- **Toelichting:** `resource_grants` voor kanaal, agenda, koppeling of module. Principal is user, agent of department. Niveau op de rij. Leeg betekent niet “niemand” overal. Agent scopes (`agent_scopes`) zijn de allowlist per agent voor project, knowledge of channel. Geen rijen betekent onbeperkt voor die soort. Relateert aan Department, Agent en Connections.

---

## 10. Uitvoering, leren, leidingwerk

Dit zijn geen operatorwoorden. Ze staan hier omdat de code en de docs ze als feature dragen.

### Agent run

- **EN:** Agent run
- **NL:** Agent-run
- **Toelichting:** `agent_runs` plus `run_events`. Een segment van werk, gekoppeld aan agent, gesprek, optioneel map, flow en ticket. Rollen van de run: main, delegate, judge, orchestrator. Platte vraag-en-antwoord blijft alleen een run. Echt muterend werk promoveert naar een Agent task. Het resultaat wordt een bericht in het gesprek. Relateert aan Activity, Usage, Worker en Decision.

### Agent task

- **EN:** Task (internal)
- **NL:** Taak (intern)
- **Toelichting:** `agent_tasks`. Herkomst: handmatig, gesprek, agent, API, trigger, delegatie, flow, mens. Toegewezen aan agent of mens. Geplande taken wekt de scheduler. Dit is het werkboek, niet een achtste object in de UI. Relateert aan Queue item, Trigger en Agent run.

### Delegation

- **EN:** Delegation
- **NL:** Delegeren
- **Toelichting:** Toolcategorie die werk aan een andere agent geeft of een run start. Staat open voor members, ook via de assistent. `start_conversation` met mode task delegeert. Mode chat opent een peer-gesprek. Relateert aan Participants, Agent en Bokito assistant.

### Tool registry

- **EN:** Tool registry
- **NL:** Toolregister
- **Toelichting:** Eén register en één `execute_tool()` voor interne agents en externe MCP. Categorieën met een schuif. Trust: operator, external, api. Ask wordt een beslissing. Deny wordt een auditfout. Allow voert uit. Relateert aan Autonomy, Passport, MCP en Module.

### Inbox rule

- **EN:** Inbox rule
- **NL:** Inboxregel
- **Toelichting:** Geleerde of handmatige politiek op inkomende threads (`inbox_rules`), vaak uit herhaalde “geen antwoord nodig”. Levenscyclus begint als suggestie. Relateert aan No reply needed, Learning en Triage. Staat in de prullenbak als soort.

### Feedback and eval

- **EN:** Feedback / eval score
- **NL:** Feedback / evaluatiescore
- **Toelichting:** `feedback_entries` op bericht, run, beslissing of gesprek. `eval_scores` voeden Overview. V1 is heuristiek, geen finetuning. Correcties worden voorbeelden. Relateert aan Example, Overview en Autonomy (een hoog escalatiecijfer kan de houding aanscherpen).

### Routing rule

- **EN:** Routing rule
- **NL:** Routeringsregel
- **Toelichting:** Geleerde regel: vragen over een onderwerp gaan naar de persoon die ze beantwoordt. Opgeslagen als platformwijziging van soort routing_rule. Relateert aan Decision (addressee, routed_by) en Govern.

### Notifications tiers

- **EN:** Notification tiers
- **NL:** Meldingslagen
- **Toelichting:** `notifications.tier`: 1 nu, 2 later, 3 digest. Elke melding kan aan een gesprek hangen. Het gesprek openen markeert hem gelezen. Relateert aan Notifications en For you.

### Session and auth

- **EN:** Session / authentication
- **NL:** Sessie / authenticatie
- **Toelichting:** Gebruiker, wachtwoord of SSO (`user_identities`), refresh-sessie, JWT met tenant, optioneel staff en impersonatie. Het subdomein moet bij de token-tenant horen, behalve voor staff. 2FA via TOTP. Relateert aan Workspace role en Staff.

### Staff

- **EN:** Staff
- **NL:** Staff
- **Toelichting:** `users.is_staff`. Telt in het product als admin, inclusief impersonatie, met een `staff_access_log`. Platformcatalogus van integraties is een staff-pad. Dit is geen werkruimterol.

### Onboarding

- **EN:** Onboarding
- **NL:** Onboarding
- **Toelichting:** Wizard plus de setupchecklist. Nieuwe tenant krijgt persona, memory, company, heartbeat en een uitgezette heartbeat-trigger, plus de afdeling All. Relateert aan Help, Knowledge en Department.

### Uploads

- **EN:** Uploads
- **NL:** Uploads
- **Toelichting:** Bestanden aan een gesprek of een kennisdocument. Relateert aan Folder files en Knowledge.

### Custom database

- **EN:** Custom database
- **NL:** Eigen database
- **Toelichting:** Modellen bestaan (`custom_db`) maar het is geen rail-item en geen van de zeven objecten. Oudere docs noemen het een uitgezette Data-module. Niet als huidig productoppervlak behandelen.

### Retired OS graph

- **EN:** AI OS canvas (retired)
- **NL:** AI OS-canvas (uitgezet)
- **Toelichting:** `/os` en de graaf-endpoints geven aan dat ze retired zijn. De intentie en `docs/architecture.md` noemen ze nog. De levende kaart is Grid. De levende momentopnames zijn Canvas op Overview en op een map.

---

## 11. Waar namen en deuren botsen

Korte index. De toelichting hierboven werkt elk punt uit.

| Wat de gebruiker ziet | Wat het is | Botsing |
|---|---|---|
| Playbooks in de rail | Flow | Intentie en help zeggen Flow. De tabel heet workstream. De prullenbak zegt playbook. |
| Labels in Settings | Actietag of vrije hashtag | Eén register, vijf deuren. |
| Map in Communication | Afdeling | Folders zijn een andere boom (`projects`). |
| Needs you en For you | Dezelfde gesprekken | Overview en Communication. |
| Autonoom / Geassisteerd / Handmatig | Twee mechanismen | AI-afhandeling (antwoordt de AI) en autonomieplafond (mag de agent handelen). Zelfde woorden. |
| Owner | Vier rollen | Werkruimte, gesprek, deelnemer, fase of kanaal. |
| Agents | Eén rij, vier schermen | Bibliotheek, Workforce, Grid, Communication. |
| Kennis | Eén tabel, twee deuren | Knowledge en het documenttabblad van een map. Leden mogen via de API schrijven. De mappagina verstopt dat. |
| Agenda | Vier bronnen | Gespreksdatum, trigger, checkup, externe agenda. |
| Govern en beslissingen | Twee lagen | Kaart in de thread versus structureel voorstel. |
| Nieuw gesprek, thread, hoekhulp | Drie chats | Company-agent, klant, persoonlijke assistent. |
| Connection, Trigger, Task, Message | Geen operatorwoorden | Zichtbaar als Koppelingen, Agenda, ticket of gesprek. |
