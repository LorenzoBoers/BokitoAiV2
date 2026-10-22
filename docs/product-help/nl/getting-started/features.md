---
title: Platformfeatures
intro: Elk onderdeel van Bokito, van de rail tot de kleine knoppen, en hoe ze aan elkaar hangen.
description: Overzicht van alle Bokito-features. Per onderdeel de Nederlandse en Engelse naam, wat het doet, en met welke andere onderdelen het samenwerkt.
keywords: features, overzicht, rail, gesprek, werkmap, werkt in, opgeleverd, flow, agent, autonomie, govern, grid, agenda
sort: 15
related: welcome,communication,agents,folders,flows,agenda,team,govern
---

# Platformfeatures

Bokito is één gesprek voor het bedrijf. Klanten schrijven waar ze al schrijven. Het team en de agents antwoorden in dezelfde lijst. Pagina's zijn om te bladeren. Het gesprek is waar je het werk start, ziet en corrigeert.

Elk blok hieronder noemt de Nederlandse naam als titel en de Engelse naam eronder. De tekst zegt wat het doet en met welke andere features het te maken heeft.

## De vijf begrippen

Alles in Bokito hangt aan deze vijf. Label, afdeling, kanaal en contact zijn eigenschappen en filters, geen plekken waar werk landt.

### {icon:conversation} Gesprek

**EN:** Conversation. Alles wat binnenkomt of wordt gestart. Een status maakt het een ticket. Een datum zet het op de agenda. Een herhaling maakt het terugkerend. Wat een agent deed, staat als bericht in dat gesprek. Hangt aan [Communicatie](/docs/inbox/communication), [Agenda](/docs/ai/agenda) en [Beslissingen](/docs/ai/decisions).

### {icon:folder} Werkmap

**EN:** Folder. De plek waar al het werk over één onderwerp samenkomt en terechtkomt: een klant, een project of een afdelingstaak. Werkmappen kun je nesten. **Werkt in** toont waar in die werkmap gewerkt wordt: Bord, Bestanden en canvassen in Bokito, en koppelingen zoals een GitHub-repo, een Drive-map of een Exact-administratie. Wat een gesprek opleverde, landt hier als **Opgeleverd**. Hangt aan [Werkmappen](/docs/ai/folders), [Labels](/docs/ai/categories) en [Kennis](/docs/ai/knowledge).

### {icon:flow} Flow

**EN:** Flow. Hoe één soort werk loopt: fasen, een eigenaar per fase en een optionele bestemming (**Levert op in**). Het label met de flow is het mechanisme eronder, bijvoorbeeld `#klacht`. Bereikt een ticket een fase Klaar, dan wordt het opgeleverd in die bestemming. Hangt aan [Flows](/docs/ai/flows), [Labels](/docs/ai/categories) en [Werkmappen](/docs/ai/folders).

### {icon:agent} Agent

**EN:** Agent. Een AI-medewerker met naam, functietitel, instructie, model, toegestane tools en een plafond. Eén agent is de lead en vangt wat nergens anders is gebonden. Dezelfde agent staat op Agents, op Workforce, op de Grid en in Communicatie. Hangt aan [Agents](/docs/ai/agents), [Workforce](/docs/getting-started/team) en [Kennis](/docs/ai/knowledge).

### {icon:autonomy} Autonomie

**EN:** Autonomy. Wat een agent zelf mag: **Autonoom**, **Geassisteerd** of **Handmatig**. Eén dial in **Govern**, tab **Beleid**, voor de hele werkruimte. Een kanaal, een gesprek, een agent of een flow mag lager staan; niets gaat boven de dial. Hangt aan [Autonomie instellen](/docs/govern/autonomy) en [Antwoorden, waarborgen en overdracht](/docs/inbox/inbox-ai).

## Eigenschappen

### {icon:hash} Label

**EN:** Label. Een hashtag op een gesprek. Een label met een flow maakt het gesprek een ticket in die flow; een gesprek heeft er hoogstens één. Kleur en icoon bestaan alleen zolang de flow eraan hangt. Labels bepalen ook in welke werkmap een gesprek staat. Hangt aan [Labels](/docs/ai/categories) en [Flows](/docs/ai/flows).

### {icon:contact} Contact

**EN:** Contact. De persoon aan de andere kant, per kanaal. Status is goedgekeurd, in afwachting of geblokkeerd. Labels op het contact tellen mee voor werkmappen. Hangt aan [Contacten](/docs/inbox/contacts), [Kanalen](/docs/inbox/channels) en de [widget](/docs/inbox/widget).

### {icon:company} Bedrijf

**EN:** Organization. Het CRM-bedrijf bij een contact, gekoppeld op e-maildomein. Dit is niet de werkruimte. Labels erven naar elk contact van dat bedrijf en daarmee naar hun gesprekken. Hangt aan [Contacten](/docs/inbox/contacts) en [Werkmappen](/docs/ai/folders).

## Rail

Bovenaan de knop **Nieuwe chat**, daarna **Inbox** los boven de groep **Werk**. Groep **Werk**: Agenda, Werkmappen, Flows. Groep **Team**: Agents, Workforce. Boven je account: **Koppelingen**, daarna **Instellingen**. Vandaag zit in Inbox, Kennis onder Agents, de Grid onder Workforce, en Govern en Verbruik onder Instellingen.

### {icon:new-chat} Nieuwe chat

**EN:** New chat. Start een gesprek met een bedrijfsagent die voor jou openstaat, of een uitgaand klantbericht. Zonder bereikbare agent zegt de opsteller dat er geen agents zijn. De hulp in de hoek is een ander gesprek en is op dit scherm verborgen. Hangt aan [Agents](/docs/ai/agents) en [Communicatie](/docs/inbox/communication).

### {icon:communication} Inbox

**EN:** Inbox. Het bureau van de dag. Mail, websitechat, Slack, WhatsApp en chats met agents in één lijst. Wachtrijen zijn weergaven: Voor jou, open, niet toegewezen, gesloten, spam, per kanaal, per afdeling en per agent. Zie [Communicatie](/docs/inbox/communication).

### {icon:today} Vandaag

**EN:** Today. Het eerste item in Inbox (`/communication/today`): wat jou nodig heeft, AI-activiteit, open tickets, wat loopt en het traject van de week. Hangt aan [Vandaag](/docs/getting-started/cockpit) en [Agenda](/docs/ai/agenda).

### {icon:for-you} Voor jou

**EN:** For you. Gesprekken waarvan de beurt of een open beslissing bij jou of je afdeling ligt. Hetzelfde blok staat op Vandaag. De bel telt deze rijen.

### {icon:composer} Opsteller

**EN:** Composer. Antwoorden, de AI vragen, of een interne notitie. Een notitie ziet de klant niet. E-mail kent beantwoorden, allen beantwoorden en doorsturen. `/ticket #naam` archiveert een ticket. Terwijl je typt, maakt een autonome agent een concept in plaats van te versturen. Hangt aan [Antwoorden, waarborgen en overdracht](/docs/inbox/inbox-ai).

### {icon:decision} Beslissing

**EN:** Decision. Een vraag in het gesprek zelf. Goedkeuren voert de actie uit. Afwijzen of uitstellen laat haar liggen. Kaarten uit dezelfde beurt vormen één bundel. Govern bewaart alleen structurele wijzigingen. Hangt aan [Beslissingen](/docs/ai/decisions).

### {icon:reply} Voorgesteld antwoord

**EN:** Suggested reply. Een concept van de agent in het gesprek. In Geassisteerd keur je goed, bewerk je of wijs je af. Een concept dat de klant heeft ingehaald, wordt als verouderd gemarkeerd. Hangt aan [Beslissingen](/docs/ai/decisions).

### {icon:no-reply} Geen antwoord nodig

**EN:** No reply needed. De lezing zegt dat er niet geantwoord hoeft te worden. Herhaalde keuzes worden een regel voor die afzender. Zo'n gesprek landt op de Grid in **Afgerond** en telt daar apart mee. Hangt aan [Antwoorden, waarborgen en overdracht](/docs/inbox/inbox-ai).

### {icon:delivered} Opgeleverd

**EN:** Delivered. Waar het werk uit een gesprek terechtkwam: een antwoord via het kanaal, een plek in een werkmap of kennis na een correctie. Het gesprek toont een chip zoals "Opgeleverd in administratie › Exact", en het paneel Waarom noemt de laatste opleveringen. Hangt aan [Werkmappen](/docs/ai/folders) en [Communicatie](/docs/inbox/communication).

### {icon:plan} Plannen

**EN:** Plan. Vanuit een gesprek een datum of herhaling zetten. Agenda toont het. Sluiten duurt tot de volgende keer. Hangt aan [Agenda](/docs/ai/agenda).

### {icon:assignment} Toewijzen

**EN:** Assignment. Eén eigenaar: een persoon, een agent of een afdeling. Toewijzen aan een persoon zet de Autonomie van dat gesprek op Handmatig. Zonder toewijzing valt het op de eigenaar van het kanaal, anders op Alle mensen. Hangt aan [Workforce](/docs/getting-started/team) en [Kanalen](/docs/inbox/channels).

### {icon:split} Gesprek splitsen

**EN:** Split conversation. Een tweede verzoek in dezelfde mailthread wordt een nieuw gesprek. Nieuwe antwoorden landen daar. Hangt aan [Labels](/docs/ai/categories).

### {icon:participants} Deelnemers

**EN:** Participants. Meerdere mensen en agents in één gesprek. Je nodigt uit, geeft de beurt door of plaatst een zichtbaar bericht. `@agent` in de opsteller doet dat in één stap. Te veel beurten achter elkaar van één agent dwingen een beslissing af. Hangt aan [Agents](/docs/ai/agents).

### {icon:agenda} Agenda

**EN:** Agenda. Wat gebeurde, wat due is en wat gepland is, plus afspraken uit Google of Outlook. Het getal op de rail telt due werk op gesprekken die aan jou zijn toegewezen. Hangt aan [Agenda](/docs/ai/agenda), [Communicatie](/docs/inbox/communication) en [Koppelingen](/docs/integrations/integrations).

### {icon:folder} Werkmappen

**EN:** Folders. De boom van werkmappen. Leden lezen. Hernoemen, labels en nesten doen eigenaar en beheerder. Elke werkmap toont gesprekken, documenten en **Werkt in**. Hangt aan [Werkmappen](/docs/ai/folders).

### {icon:works-in} Werkt in

**EN:** Works in. Eén sectie op de werkmap met alles waar in die werkmap gewerkt wordt, één kaart per plek. Een gevuld icoon zit in Bokito (Bord, Bestanden, Canvas), een omlijnd icoon is een koppeling. Een koppeling die werk ontvangt, hangt altijd aan een werkmap. **Toevoegen aan Werkt in** voegt een plek toe. Hangt aan [Werkmappen](/docs/ai/folders) en [Koppelingen](/docs/integrations/integrations).

### {icon:canvas} Canvas

**EN:** Canvas. Een werkoppervlak in een werkmap, bijvoorbeeld voor de cijfers van een klant. Het staat onder Werkt in. Een agent bouwt het in een gesprek; verversen is de herhaling van dat gesprek op de agenda. Hangt aan [Werkmappen](/docs/ai/folders), [Agents](/docs/ai/agents) en [Agenda](/docs/ai/agenda).

### {icon:board} Bord

**EN:** Board. Tickets van een flow, per fase. Op de werkmap zie je de flows die hier matchen. Op de flow zie je een baan per werkmap. Slepen wijzigt de fase. Hangt aan [Flows](/docs/ai/flows).

### {icon:flows} Flows

**EN:** Flows. De lijst van flows. Leden zien het bord. Aanmaken, fasen wijzigen en **Levert op in** kiezen doen eigenaar en beheerder. Een flow kiest een vrij label of maakt er een. Hangt aan [Flows](/docs/ai/flows).

### {icon:stages} Fasen

**EN:** Stages. Niet gestart, Wachtend en Klaar, plus gesloten. Een voorgesteld ticket zit nog vóór de pijplijn. Per fase kan een checkup staan. Die verschijnt op de agenda en gaat naar de eigenaar van dat moment. Hangt aan [Agenda](/docs/ai/agenda).

### {icon:agent} Agents

**EN:** Agents. De bibliotheek, met de tab **Kennis**. Leden lezen en mogen chatten als de chat-toegang dat toestaat. Aanmaken, instructie, model, tools, lead en archiveren doen eigenaar en beheerder. Deactiveren zet open gesprekken op de lead. Geschiedenis blijft. Hangt aan [Agents](/docs/ai/agents) en [Modellen](/docs/govern/models).

### {icon:knowledge} Kennis

**EN:** Knowledge. Markdown die agents bij elke run lezen, voor de organisatie, een werkmap of een agent. Soorten zijn document, geheugen, persona, vaardigheid en heartbeat. Publiceren maakt een artikel voor de widget. Hangt aan [Kennis](/docs/ai/knowledge) en de [widget](/docs/inbox/widget).

### {icon:assistant} Bokito-assistent

**EN:** Bokito assistant. Jouw hulp in de hoek en onder Hulp. Geen bedrijfsagent, niet op de Grid en niet in de bibliotheek. Kent het scherm, antwoordt vanuit deze docs en geeft werk door binnen jouw rol. Een lid kan via Bokito geen kanalen, agents of Govern wijzigen. Hangt aan [Bokito](/docs/getting-started/assistant).

### {icon:workbench} Werkbank

**EN:** Workbench. Codewerk naar Cursor, Claude, Devin of een vergelijkbaar gereedschap. Het resultaat komt terug in het gesprek. Bokito toont geen eigen code-editor. Hangt aan [Beslissingen](/docs/ai/decisions) en [Koppelingen](/docs/integrations/integrations).

### {icon:workforce} Workforce

**EN:** Workforce. De secties **Mensen en agents** en **Afdelingen**, plus de Grid en Workflow. Uitnodigen en rollen wijzigen doen eigenaar en beheerder. Alleen de eigenaar wijzigt een andere eigenaar. Het plafond van een agent staat in dezelfde kolom als de rol van een mens. Hangt aan [Workforce](/docs/getting-started/team) en [Agents](/docs/ai/agents).

### {icon:department} Afdeling

**EN:** Department. Een groep mensen en agents. Alle mensen en Alle agents bestaan altijd en verschijnen niet in de zijbalk van Communicatie. Eigen afdelingen wel, met een manier van oppakken: mensen pakken op, agent eerst, om de beurt, of minst open. Een module-installatie maakt één afdeling. Hangt aan [Workforce](/docs/getting-started/team) en [Kanalen](/docs/inbox/channels).

### {icon:presence} Aanwezigheid

**EN:** Presence. Beschikbaar, afwezig of offline. Afwezig zet je in het accountmenu. Agents slaan je over, afdelingen geven je geen nieuw gesprek, en de websitechat telt je niet voor een live overdracht. Hangt aan [Workforce](/docs/getting-started/team) en de [widget](/docs/inbox/widget).

### {icon:grid} Grid

**EN:** Grid. De organisatiekaart in 3D: afdelingen met hun mensen en agents, en de werkmappen, flows en koppelingen waarmee ze werken. Ernaast staat **Workflow**: hoe werk door het bedrijf loopt, in vier lagen van links naar rechts: **Binnenkomst** (kanalen), **Uitvoerders** (mensen en agents per afdeling), **Flow** en **Resultaat** (antwoord, werkmappen met hun Werkt in, kennis). De lenzen van Workflow zijn Stroom, Labels en Autonomie, in 3D of 2D; knelpunten staan in het zijpaneel. **Open in Grid** staat op Agents, Flows, Werkmappen en Koppelingen. Bewerken doe je op die pagina's. Hangt aan [Workforce](/docs/getting-started/team).

## Instellingen

Persoonlijk is van het lid. Werkruimte, kanalen, labels, Govern, modellen, koppelingen, verbruik en privacy zijn van eigenaar en beheerder.

### {icon:profile} Profiel en beveiliging

**EN:** Profile & security. Naam, taal van het scherm, startpagina, uiterlijk, persoonlijke handtekening en tweestapsverificatie. De schermtaal is niet de werktaal waarin agents schrijven; die staat in Govern.

### {icon:notifications} Meldingen

**EN:** Notifications. Nu, later of in een dagelijks overzicht. De bel opent Voor jou. Hangt aan [Beslissingen](/docs/ai/decisions).

### {icon:branding} Algemeen en huisstijl

**EN:** General and Branding. Naam, logo en uitstraling van de werkruimte. Het logo zie je ook in de widget. Hangt aan de [setupgids](/docs/getting-started/setup-guide).

### {icon:channels} Kanalen

**EN:** Channels. E-mail, websitechat, Slack en WhatsApp. Per kanaal een standaardagent, een eigenaar en een handtekening. De Autonomie per kanaal staat in Govern. Een keuze op het gesprek wint van de standaardagent. Hangt aan [Kanalen](/docs/inbox/channels).

### {icon:labels} Labels

**EN:** Labels. Eén lijst. Een vrij label, een flow eraan hangen, of er een werkmap van maken. Hier stel je ook in wie een AI-voorstel mag bevestigen. Leden mogen altijd zelf een ticket archiveren. Hangt aan [Labels](/docs/ai/categories).

### {icon:govern} Govern

**EN:** Govern. Twee delen. Het **Logboek**: openstaande concepten, versiegeschiedenis en de recente audit. **Beleid**: van boven naar beneden de Autonomie-dial, de standaard per kanaal, **Waarborgen**, overdracht, de werktaal, en ingeklapt de standaardrechten voor tools. **Agenttoegang** toont per agent wat hij mag. Dagelijkse antwoorden blijven in het gesprek. Hangt aan [Govern](/docs/govern/govern) en [Autonomie instellen](/docs/govern/autonomy).

### {icon:models} Modellen

**EN:** Models. De standaard van de werkruimte, een beeldmodel, en per agent automatisch of een vast model. Zonder live sleutel zijn antwoorden placeholders. Hangt aan [Modellen](/docs/govern/models).

### {icon:connections} Koppelingen

**EN:** Connections. Modules, partnerlogins en AI-gereedschap op één pagina. Een login geeft agents nog geen tools: installeer eerst de module en wijs een agent toe. Een koppeling die werk ontvangt, zet je onder Werkt in van een werkmap. Mailboxen openen Kanalen. Agenda-apps openen Agenda. Hangt aan [Koppelingen](/docs/integrations/integrations) en [MCP](/docs/integrations/mcp).

### {icon:module} Module

**EN:** Module. Een pakket dat één keer neerzet: een afdeling, een specialist, labels, een flow, een vaardigheid en een werkmap met het juiste Werkt in-item. Daarna is het gewone data. Geen extra rail-item. Hangt aan [Workforce](/docs/getting-started/team), [Flows](/docs/ai/flows) en [Koppelingen](/docs/integrations/integrations).

### {icon:usage} Verbruik

**EN:** Usage. Onder **Instellingen**, **Verbruik**. Tokens en kosten tegen een budget. Het budget wijzigt een eigenaar of beheerder. Kosten omzeilen een goedkeuring niet. Hangt aan [Vandaag](/docs/getting-started/cockpit) en [Modellen](/docs/govern/models).

### {icon:privacy} Gegevens en privacy

**EN:** Data & privacy. Bewaartermijn, of de AI berichtteksten mag gebruiken, alleen EU-modellen, en exporteren of wissen van een persoon. Hangt aan [Gegevens en privacy](/docs/govern/privacy-security).

### {icon:developers} Voor ontwikkelaars

**EN:** Developers. API-tokens, MCP-clients en uitgaande webhooks. Hangt aan het [API-overzicht](/docs/developers/api-overview), [webhooks](/docs/developers/webhooks) en het [MCP-eindpunt](/docs/developers/mcp-endpoint).

### {icon:bin} Prullenbak

**EN:** Bin. Verwijderde gesprekken, contacten, werkmappen, kennis, flows, agenda-items en afdelingen. Herstellen of definitief wissen. Hangt aan [Gegevens en privacy](/docs/govern/privacy-security).

### {icon:help} Hulp en instelgids

**EN:** Help and setup guide. De checklist voor een nieuwe werkruimte en de rondleiding door de rail. Hangt aan de [setupgids](/docs/getting-started/setup-guide) en de [tour](/docs/getting-started/tour).

## Wat nu

1. Open [Communicatie](/docs/inbox/communication) en werk één gesprek.
2. Zet in **Govern**, tab **Beleid**, de Autonomie-dial ([Autonomie instellen](/docs/govern/autonomy)) en daarna op dezelfde tab de **Waarborgen** ([Antwoorden, waarborgen en overdracht](/docs/inbox/inbox-ai)).
3. Volg de [setupgids](/docs/getting-started/setup-guide) als de werkruimte nog leeg is.
