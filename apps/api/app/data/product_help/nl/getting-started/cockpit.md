---
title: Zo werkt Overview
intro: Begin hier als je wilt weten of werk doorloopt en waar aandacht nodig is.
description: Gebruik Overview voor de dagelijkse scan, Canvas voor workspace-dashboards, Activiteit voor het eventlog en Verbruik voor tokenbudget en kosten.
keywords: overview, rapportages, cockpit, dashboard, overzicht, verbruik, budget, activiteit
sort: 50
related: communication,categories,agent-runs,decisions,agenda
---

# Zo werkt Overview

Overview is de ochtendscan. Open die in de linkerrail om te zien waar jij nodig bent, welke tickets openstaan, wat loopt en hoe het traject zich ontwikkelt, en spring daarna in het onderliggende gesprek of de run. Onder **Instellingen → Profiel** kun je Overview als startpagina na inloggen kiezen; Communicatie blijft de standaard.

## Scan de dag op Overview

![Overview](/api/docs/assets/cockpit/overview.png)
*Overview toont open werk, beslissingen en recente runs.*

1. Open **Overview** in de linkerrail. Je landt op de scan. De titel op de pagina is de workspacenaam; het hulp-icoon naast **Overview** in de bovenbalk opent deze gids. De ondertitel begroet je en toont de datum van vandaag. De grijze regel `environment · tenant-slug · Live · 1.2.01` is voor support (API-environment, deze tenant, websocket, releaseversie). Klik de slug om de hele regel te kopiëren. Dezelfde regel staat onderaan het accountmenu. De dev-host toont de volgende patch, één stap voor op productie.
2. **Jij bent nodig** staat bovenaan over de volle breedte: open beslissingen en gesprekken die aan jou zijn toegewezen (dezelfde uitzonderingenlijst als **Voor jou** in Communicatie). Is die leeg, gebruik **Voor jou openen** of **Kanaal koppelen**.
3. Daaronder toont **AI-activiteit** het tokengebruik over de afgelopen 24 uur per uur als grafiek (zonder verticale schaal), **Tijd bespaard** (geschatte minuten uit AI-resultaten deze week: autonome sends, geassisteerde concepten die verstuurd of door een persoon voortgezet zijn, stille no-reply-triage, bevestigde no-reply-sluitingen, door AI vastgelegde tickets, afgeronde flows) en **Afgehandeld** (gesprekken gesloten zonder overname die 72 uur dicht bleven, en in de afgelopen 7 dagen die grens haalden), plus een cirkeldiagram van gewogen **Autonoom**-, **Geassisteerd**- en **Handmatig**-acties deze week (met open-gesprekstellers onder de legenda). **Instellingen AI-afhandeling** opent de workspace-draaiknop. Zie [AI-afhandeling](/docs/inbox/inbox-ai).
4. Onder **Verder in de workspace** staan drie secundaire blokken: **Open tickets per categorie**, **Lopend en straks** en **Traject**. **Lopend en straks** waarschuwt voor openstaande check-ups en verlopen kijkmomenten, toont de eerstvolgende items uit [Agenda](/docs/ai/agenda), daarna de lopende runs, en eindigt met **Agenda openen**. Traject vergelijkt deze week met vorige week: **Tickets vastgelegd (7 dagen)** telt alleen bevestigde tickets, en het blok linkt naar afgeronde runs, Govern-voorstellen en Verbruik.
5. Klik een rij om het gesprek, de run of een gefilterde lijst te openen. Een rij onder **Open tickets per categorie** opent de rij van die categorie in Communicatie. Heeft een open gesprek 14 dagen geen bericht, dan staat het onder **Al 14 dagen stil** met **Afsluiten**. Zonder terugkerende taak staat bovenaan een banner met **Taak instellen**. Die opent het aanmaakvenster op Agenda, al ingevuld als dagelijkse interval. Het kruisje verbergt de banner voor deze workspace.

In een nieuwe workspace kan Overview nog setupvoortgang tonen. Rond die af via de [setupgids](/docs/getting-started/setup-guide).

## Lees workspace-canvasses

Workspace-canvasses zijn snapshot-dashboards (geen live tegels). Ze staan op het tabblad **Canvas** naast Overview en Verbruik. De lead-agent schrijft ze; jij voegt toe, verwijdert en zet verversen.

1. Open **Overview**, daarna het tabblad **Canvas**. Canvasnamen staan van links naar rechts; **Canvas toevoegen** is de tab ná de laatste canvas. Dat opent een dialoog: **Titel**, **Wat het moet bevatten** en **Verversen** (**Handmatig**, **Dagelijks**, **Wekelijks**, **Uurlijks**, **Maandelijks**). Dagelijks is de standaard.
2. Sla op. De lead-agent begint vanuit je omschrijving. Verversen is een [Agenda](/docs/ai/agenda)-wake op die agent — geen aparte scheduler.
3. Bewerk inhoud alleen via agents. Kies **Vraag agent om bij te werken** voor een eenmalige herschrijving, of wijzig Verversen zodat Agenda de agent blijft wekken. Projectcanvasses staan op het [Canvas](/docs/ai/projects)-tabblad van het project.

## Open werk dat op jou wacht

![Overview-aandachtspunten](/api/docs/assets/cockpit/awaiting-decision.png)
*Wacht op beslissing springt naar dezelfde lijst als Agent-runs.*

1. Zoek het gesprek onder **Jij bent nodig**. De rij toont dezelfde avatar, hetzelfde onderwerp en dezelfde beslissingsmarkering als Communicatie.
2. Open het. Je landt op het bijbehorende gesprek in Communicatie.
3. Handel de beslissing af in het gesprek en keer terug naar Overview.

## Lees Activiteit

1. Open **Activiteit** vanuit Communicatie (of de rij **Activiteit** van een agent) als je de volledige stream nodig hebt. Overview zelf houdt **Jij bent nodig** vooraan, daarna de secundaire contextblokken.
2. Scan resultaten, niet elke denkstap.
3. Spring naar een gesprek of agent wanneer een rij follow-up vraagt.

## Check Verbruik

1. Open het tabblad **Verbruik** op Overview. Bovenaan staat **Tokengebruik**: een grafiek per dag voor **7 dagen**, **30 dagen** of **90 dagen**, met **Tokens** en **Kosten** voor die periode ernaast. Daaronder staan **Budget (platformsleutels)** (tokens vandaag en factureerbare spend deze maand), **Resultaat** (gesprekken, autonomieratio, tijd bespaard, gemiddelde feedback, klantbeoordeling en open beslissingen van deze week) en **Uitsplitsing** (**Per model**, **Per agent**, **Per gebruiker**, **Per dataregio**). **Tijd bespaard** is een schatting over 7 dagen: vaste minuten per autonome antwoorden, geassisteerde concepten (ook als iemand daarna zelf antwoordde), stille no-reply-triage, bevestigde no-reply-sluitingen, door AI vastgelegde tickets en afgeronde flows. De dataregio-mix staat onder **Per dataregio**; wijzig het beleid onder [Data en privacy](/docs/govern/privacy-security). Kies **CSV exporteren** in de kop.
2. Owners en admins kiezen **Plafonds bewerken**. Zet een **Dagelijks tokenplafond** en een **Maandelijks spendplafond (USD)**, of laat een veld leeg voor **Geen plafond**. Meldingen gaan af bij 80% en 100%.
3. Als het budget op is, pauzeren AI-calls op Bokito-platformkeys tot je het plafond verhoogt of de periode reset. Modellen op je eigen keys blijven werken (**Eigen sleutel (geen kosten)**).
