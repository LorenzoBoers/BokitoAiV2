---
title: Platformfeatures
intro: Elk onderdeel van Bokito, van de rail tot de kleine knoppen, en hoe ze aan elkaar hangen.
description: Overzicht van alle Bokito-features. Per onderdeel de Engelse en Nederlandse naam, wat het doet, en met welke andere onderdelen het samenwerkt.
keywords: features, overzicht, rail, gesprek, flow, werkmap, agent, govern, agenda
sort: 15
related: welcome,communication,agents,folders,flows,agenda,team,govern
---

# Platformfeatures

Bokito is één gesprek voor het bedrijf. Klanten schrijven waar ze al schrijven. Het team en de agents antwoorden in dezelfde lijst. Pagina's zijn om te bladeren. Het gesprek is waar je het werk start, ziet en corrigeert.

Elk blok hieronder noemt de Engelse en de Nederlandse naam. De tekst zegt wat het doet en met welke andere features het te maken heeft.

## De zeven dingen die je bij naam noemt

Al het andere is een scherm, een instelling of iets wat op de achtergrond loopt.

### {icon:conversation} Gesprek

**EN:** Conversation. Het enige gesprek in het platform. Een status maakt het een ticket. Een datum maakt het een agenda-item. Een herhaling maakt het terugkerend. Wat een agent deed staat als bericht in dat gesprek. Hangt aan [Communicatie](/docs/inbox/communication), [Vandaag](/docs/getting-started/cockpit), [Agenda](/docs/ai/agenda) en [Beslissingen](/docs/ai/decisions).

### {icon:hash} label

**EN:** label. Een hashtag die een flow start. Hoogstens één per gesprek. Archiveren maakt het gesprek een ticket in de fasen van die flow. Kleur en icoon bestaan alleen zolang de flow eraan hangt. Vrije hashtags ernaast zijn labels, geen apart ding. Hangt aan [Labels](/docs/ai/categories), [Flows](/docs/ai/flows) en [Werkmappen](/docs/ai/folders).

### {icon:flow} Flow

**EN:** Flow. De fasepijplijn van precies één label. De lijst toont een titel naast het label, bijvoorbeeld `#klacht`. Het label blijft de identiteit. Per fase is de eigenaar een persoon, een agent of een afdeling. De rail zegt Flows. Deze docs en het product zeggen Flow. Hangt aan [Labels](/docs/ai/categories), [Werkmappen](/docs/ai/folders) en [Agenda](/docs/ai/agenda).

### {icon:map} Werkmap

**EN:** Folder. De plek waar al het werk over één onderwerp samenkomt: een klant, een project of een afdelingstaak. Een benoemde plek in een boom. Optionele labels bepalen welke gesprekken erbij horen: het gesprek moet élk label van de set dragen, ook labels van het contact en het bedrijf. Nesten verplaatst alleen de plek. Op de hub staan gesprekken, het bord, canvas, documenten en bestanden. Hangt aan [Labels](/docs/ai/categories), [Flows](/docs/ai/flows) en [Kennis](/docs/ai/knowledge). Een afdeling in de zijbalk van Communicatie is een andere soort groep.

### {icon:contact} Contact

**EN:** Contact. De persoon aan de andere kant, per kanaal. Status is goedgekeurd, in afwachting of geblokkeerd. Labels op het contact tellen mee voor werkmappen. Hangt aan [Contacten](/docs/inbox/contacts), [Kanalen](/docs/inbox/channels) en de [widget](/docs/inbox/widget).

### {icon:company} Bedrijf

**EN:** Organization. Het CRM-bedrijf bij een contact, gekoppeld op e-maildomein. Dit is niet de werkruimte. Labels erven naar elk contact van dat bedrijf en daarmee naar hun gesprekken. Hangt aan [Contacten](/docs/inbox/contacts) en [Werkmappen](/docs/ai/folders).

### {icon:agent} Agent

**EN:** Agent. Een AI-medewerker met naam, functietitel, instructie, model en toegestane tools. Eén agent is de lead en vangt wat nergens anders is gebonden. Dezelfde agent staat in de bibliotheek, op Workforce, op Grid en in Communicatie. Hangt aan [Agents](/docs/ai/agents), [Workforce](/docs/getting-started/team), [Kennis](/docs/ai/knowledge) en [Govern](/docs/govern/govern).

### {icon:decision} Beslissing

**EN:** Decision. Een vraag in het gesprek zelf. Goedkeuren voert de actie uit. Afwijzen of uitstellen laat haar liggen. Kaarten uit dezelfde beurt vormen één bundel. [Vandaag](/docs/getting-started/cockpit) toont dezelfde kaarten onder Voor jou. [Govern](/docs/govern/govern) bewaart alleen structurele wijzigingen. Hangt aan [Beslissingen](/docs/ai/decisions).

## Rail

Vastgezet: Nieuw gesprek, Vandaag, Communicatie. Groep Work: Werkmappen, Flows, Agenda. Groep AI: Agents, Kennis, Grid. Groep Organization: Workforce, Koppelingen, Instellingen. Govern zit onder Instellingen, niet als eigen rail-item.

### {icon:new-chat} Nieuw gesprek

**EN:** Nieuw gesprek. Start een gesprek met een company-agent die voor jou openstaat, of een uitgaand klantbericht. Zonder bereikbare agent zegt de opsteller dat er geen agents zijn. De hulp in de hoek is een ander gesprek en is op dit scherm verborgen. Hangt aan [Agents](/docs/ai/agents) en [Communicatie](/docs/inbox/communication).

### {icon:vandaag} Vandaag

**EN:** Vandaag. De ochtendscan in Communicatie (`/communication/today`): wat jou nodig heeft, AI-activiteit, open tickets, wat loopt en het traject van de week. Voor jou is dezelfde lijst als Voor jou in Communicatie. Hangt aan [Vandaag](/docs/getting-started/cockpit), [Communicatie](/docs/inbox/communication) en [Agenda](/docs/ai/agenda).

### {icon:canvas} Canvas

**EN:** Canvas. Een momentopname, geen live tegels. Je kiest een agent. Die bouwt het canvas in een gesprek. Verversen is de herhaling van dat gesprek op de agenda. Werkmappen hebben hun eigen canvas. Hangt aan [Agents](/docs/ai/agents), [Agenda](/docs/ai/agenda) en [Werkmappen](/docs/ai/folders).

### {icon:usage} Verbruik

**EN:** Usage. Tab op Vandaag. Tokens en kosten tegen een budget. Het budget wijzigt een eigenaar of beheerder. Kosten omzeilen een goedkeuring niet. Hangt aan [Vandaag](/docs/getting-started/cockpit) en [Modellen](/docs/govern/models).

### {icon:communication} Communicatie

**EN:** Communication. Het bureau van de dag. Mail, websitechat, Slack, WhatsApp en chats met agents in één lijst. Wachtrijen zijn weergaven: Voor jou, open, niet toegewezen, gesloten, spam, per kanaal, per afdeling en per agent. Hangt aan elk van de zeven dingen hierboven. Zie [Communicatie](/docs/inbox/communication).

### {icon:for-you} Voor jou

**EN:** Voor jou. Gesprekken waarvan de beurt of een open beslissing bij jou of je afdeling ligt. Hetzelfde blok heet Voor jou op Vandaag. De bel telt deze rijen.

### {icon:composer} Opsteller

**EN:** Composer. Antwoorden, de AI vragen, of een interne notitie. Een notitie ziet de klant niet. E-mail kent beantwoorden, iedereen en doorsturen. `/ticket #naam` archiveert een ticket. Terwijl je typt maakt een autonome agent een concept in plaats van te versturen. Hangt aan [Autonomie](/docs/inbox/inbox-ai).

### {icon:plan} Plannen

**EN:** Plan. Vanuit een gesprek een datum of herhaling zetten. Agenda toont het. Sluiten duurt tot de volgende keer. Hangt aan [Agenda](/docs/ai/agenda).

### {icon:assignment} Toewijzen

**EN:** Assignment. Eén eigenaar: een persoon, een agent of een afdeling. Toewijzen aan een persoon zet Autonomie van dat gesprek op Handmatig. Zonder toewijzing valt het op de eigenaar van het kanaal, anders op Alle mensen. Hangt aan [Workforce](/docs/getting-started/team) en [Kanalen](/docs/inbox/channels).

### {icon:split} Gesprek splitsen

**EN:** Split conversation. Een tweede verzoek in dezelfde mailthread wordt een nieuw gesprek. Nieuwe antwoorden landen daar. Hangt aan [Labels](/docs/ai/categories).

### {icon:no-reply} Geen antwoord nodig

**EN:** No reply needed. De lezing zegt dat er niet geantwoord hoeft te worden. Herhaalde keuzes worden een regel voor die afzender. Hangt aan [Autonomie](/docs/inbox/inbox-ai).

### {icon:reply} Voorgesteld antwoord

**EN:** Suggested reply. Een concept van de agent in het gesprek. In Geassisteerd keur je goed, bewerk je of wijs je af. Een concept dat de klant heeft ingehaald wordt als verouderd gemarkeerd. Hangt aan [Beslissingen](/docs/ai/decisions).

### {icon:participants} Deelnemers

**EN:** Participants. Meerdere mensen en agents in één gesprek. Je nodigt uit, geeft de beurt door of plaatst een zichtbaar bericht. `@agent` in de opsteller doet dat in één stap. Te veel beurten achter elkaar van één agent dwingen een beslissing af. Hangt aan [Agents](/docs/ai/agents).

### {icon:map} Werkmappen

**EN:** Folders. De boom van werkmappen. Leden lezen. Hernoemen, labels en nesten doen eigenaar en beheerder. Hangt aan [Werkmappen](/docs/ai/folders). Documenten op een werkmap zijn dezelfde kennis als op [Kennis](/docs/ai/knowledge).

### {icon:board} Bord

**EN:** Board. Tickets van een flow, per fase. Op de werkmap zie je de flows die hier matchen. Op de flow zie je een baan per werkmap. Slepen wijzigt de fase. Hangt aan [Flows](/docs/ai/flows).

### {icon:flows} Flows

**EN:** Flows. De railnaam van [Flows](/docs/ai/flows). Leden zien het bord. Aanmaken en fasen wijzigen doen eigenaar en beheerder. Een flow kiest een vrije hashtag of maakt er een.

### {icon:stages} Fasen

**EN:** Stages. Open, wachtend, klaar, gesloten. Een voorgesteld ticket zit nog vóór de pijplijn. Per fase kan een checkup staan. Die checkup verschijnt op de agenda en gaat naar de eigenaar van dat moment. Hangt aan [Agenda](/docs/ai/agenda).

### {icon:agenda} Agenda

**EN:** Agenda. Wat gebeurde, wat due is en wat gepland is, plus afspraken uit Google of Outlook. De zijlijst What is dezelfde labelboom als Communicatie. Het getal op de rail telt due werk op gesprekken die aan jou zijn toegewezen. Hangt aan [Agenda](/docs/ai/agenda), [Communicatie](/docs/inbox/communication) en [Koppelingen](/docs/integrations/integrations).

### {icon:agent} Agents

**EN:** Agents. De bibliotheek. Leden lezen en mogen chatten als de chat-toegang dat toestaat. Aanmaken, instructie, model, tools, lead en archiveren doen eigenaar en beheerder. Deactiveren zet open gesprekken op de lead. Geschiedenis blijft. Hangt aan [Agents](/docs/ai/agents), [Workforce](/docs/getting-started/team) en [Modellen](/docs/govern/models).

### {icon:assistant} Bokito-assistent

**EN:** Bokito. Jouw hulp in de hoek en onder Hulp. Geen company-agent, niet op Grid, niet in de bibliotheek. Kent het scherm, antwoordt vanuit deze docs en geeft werk door binnen jouw rol. Een lid kan via Bokito geen kanalen, agents of Govern wijzigen. Hangt aan [Bokito](/docs/getting-started/assistant).

### {icon:knowledge} Kennis

**EN:** Knowledge. Markdown die agents bij elke run lezen. Organisatie, werkmap of agent. Soorten zijn document, geheugen, persona, vaardigheid en heartbeat. Publiceren maakt een artikel voor de widget. Hangt aan [Kennis](/docs/ai/knowledge), [Agents](/docs/ai/agents) en de [widget](/docs/inbox/widget).

### {icon:grid} Grid

**EN:** Grid. De organisatiekaart. Het bedrijf in het midden, afdelingen als eilanden, mensen, agents, kanalen en flows als markeringen. Labels en Bokito staan er niet op. Open in Grid staat op Workforce, Agents, Flows, Werkmappen en Koppelingen. Bewerken doe je op die pagina's, niet op de kaart. Hangt aan [Workforce](/docs/getting-started/team).

### {icon:workforce} Workforce

**EN:** Workforce. Gids van mensen, uitnodigingen en agents, plus afdelingen. Uitnodigen en rollen wijzigen doen eigenaar en beheerder. Alleen de eigenaar wijzigt een andere eigenaar. Het plafond van een agent staat in dezelfde kolom als de rol van een mens. Inhuren opent Koppelingen. Hangt aan [Workforce](/docs/getting-started/team) en [Agents](/docs/ai/agents).

### {icon:department} Afdeling

**EN:** Department. Een groep mensen en agents. Alle mensen en Alle agents bestaan altijd en verschijnen niet als map in Communicatie. Eigen afdelingen wel, met een ophaalwijze: mensen pakken op, agent eerst, om de beurt, of minst open. Een module-installatie maakt één afdeling. Die verwijderen haalt de module weg. Hangt aan [Kanalen](/docs/inbox/channels) en [Koppelingen](/docs/integrations/integrations).

### {icon:presence} Aanwezigheid

**EN:** Presence. Beschikbaar, afwezig of offline. Afwezig zet je in het accountmenu. Agents slaan je over, afdelingen geven je geen nieuw gesprek, en de websitechat telt je niet voor een live overdracht. Hangt aan [Workforce](/docs/getting-started/team) en de [widget](/docs/inbox/widget).

### {icon:koppelingen} Koppelingen

**EN:** Koppelingen. Modules, partnerlogins en AI-gereedschap op één pagina. Een login geeft agents nog geen tools. Eerst de module installeren en een agent toewijzen. Mailboxen openen Kanalen. Agenda-apps openen Agenda. Hangt aan [Koppelingen](/docs/integrations/integrations) en [MCP](/docs/integrations/mcp).

### {icon:module} Module

**EN:** Module. Een pakket dat één keer neerzet: een afdeling, een specialist, labels, een flow en een vaardigheid. Daarna is het gewone data. Geen extra rail-item. Hangt aan [Workforce](/docs/getting-started/team), [Flows](/docs/ai/flows) en [Labels](/docs/ai/categories).

### {icon:workbench} Werkbank

**EN:** Workbench. Codewerk naar Cursor, Claude, Devin of een vergelijkbaar gereedschap. Het resultaat komt terug in het gesprek. Bokito toont geen eigen code-editor. Hangt aan [Beslissingen](/docs/ai/decisions) en [Koppelingen](/docs/integrations/integrations).

## Instellingen

Persoonlijk is van het lid. Werkruimte, kanalen, labels, modellen, privacy en Govern zijn van eigenaar en beheerder.

### {icon:profile} Profiel en beveiliging

**EN:** Profile & security. Naam, taal van het scherm, startpagina, uiterlijk, persoonlijke handtekening en tweestapsverificatie. De schermtaal is niet de taal waarin agents schrijven.

### {icon:notifications} Meldingen

**EN:** Notifications. Nu, later of in een dagelijks overzicht. De bel opent Voor jou. Hangt aan [Beslissingen](/docs/ai/decisions).

### {icon:branding} Algemeen en huisstijl

**EN:** General en Branding. Naam, logo en uitstraling van de werkruimte. Het logo zie je ook in de widget. Hangt aan de [setupgids](/docs/getting-started/setup-guide).

### {icon:channels} Kanalen

**EN:** Channels. E-mail, websitechat, Slack en WhatsApp. Per kanaal een standaardagent, een eigenaar, Autonomie en een handtekening. Een keuze op het gesprek wint van de standaardagent. Hangt aan [Kanalen](/docs/inbox/channels) en [Autonomie](/docs/inbox/inbox-ai).

### {icon:Autonomie} Autonomie

**EN:** Autonomie. Autonoom, Geassisteerd of Handmatig. Eén dial op Govern voor de hele werkruimte. Een kanaal of gesprek mag lager staan, net als een agent of een flow op Altijd controle; niets gaat boven de dial. Hangt aan [Autonomie](/docs/inbox/inbox-ai) en [autonomie](/docs/govern/autonomy).

### {icon:labels} Labels

**EN:** Labels. Eén lijst. Een vrij label, een flow eraan hangen, of er een werkmap van maken. Hier stel je ook in wie een AI-voorstel mag bevestigen. Leden mogen altijd zelf een ticket archiveren. Hangt aan [Labels](/docs/ai/categories).

### {icon:govern} Govern

**EN:** Govern. Twee delen. Het kasboek toont open voorstellen, geschiedenis en het auditlog. Autonomie bevat de ene dial, de standaardrechten voor tools en de paspoorten van agents. Dagelijkse antwoorden blijven in het gesprek. Hangt aan [Govern](/docs/govern/govern) en [autonomie](/docs/govern/autonomy).

### {icon:models} Modellen

**EN:** Models. De standaard van de werkruimte, een beeldmodel, en per agent automatisch of een vast model. Zonder live sleutel zijn antwoorden placeholders. Hangt aan [Modellen](/docs/govern/models) en [Verbruik](/docs/getting-started/cockpit).

### {icon:privacy} Gegevens en privacy

**EN:** Data & privacy. Bewaartermijn, of de AI berichtteksten mag gebruiken, alleen EU-modellen, en exporteren of wissen van een persoon. Hangt aan [Data en privacy](/docs/govern/privacy-security).

### {icon:developers} Ontwikkelaars

**EN:** Developers. API-tokens, MCP-clients en uitgaande webhooks. Hangt aan het [API-overzicht](/docs/developers/api-today), [webhooks](/docs/developers/webhooks) en het [MCP-eindpunt](/docs/developers/mcp-endpoint).

### {icon:bin} Prullenbak

**EN:** Bin. Verwijderde gesprekken, contacten, werkmappen, kennis, flows, agenda-items en afdelingen. Herstellen of definitief wissen. Hangt aan [Data en privacy](/docs/govern/privacy-security).

### {icon:help} Hulp en instelgids

**EN:** Help en setup guide. De checklist voor een nieuwe werkruimte en de rondleiding door de rail. Hangt aan de [setupgids](/docs/getting-started/setup-guide) en de [tour](/docs/getting-started/tour).

## Waar namen elkaar raken

| Wat je ziet | Wat het is |
| --- | --- |
| Flows in de rail | [Flows](/docs/ai/flows) |
| Voor jou en Voor jou | Dezelfde gesprekken, twee deuren |
| Groep in de zijbalk van Communicatie | Een afdeling, niet een [werkmap](/docs/ai/folders) |
| Autonoom, Geassisteerd, Handmatig | De Autonomie-dial in [Govern](/docs/govern/autonomy) en de uitzonderingen in [Autonomie](/docs/inbox/inbox-ai) |
| Agents op vier plekken | Bibliotheek, Workforce, Grid en Communicatie |
| Kennis en documenten in een werkmap | Dezelfde documenten, twee deuren |

## Wat nu

1. Open [Communicatie](/docs/inbox/communication) en werk één gesprek.
2. Zet de Autonomie-dial in [Govern](/docs/govern/autonomy) en daarna de waarborgen in [Autonomie](/docs/inbox/inbox-ai).
3. Volg de [setupgids](/docs/getting-started/setup-guide) als de werkruimte nog leeg is.
