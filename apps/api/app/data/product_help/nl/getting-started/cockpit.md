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

1. Open **Overview** in de linkerrail. Je landt op de scan. De ondertitel begroet je en toont de datum van vandaag. De grijze regel `environment · tenant-slug · Live` is voor support (API-environment, deze tenant, websocket). Klik de slug om te kopiëren. Dezelfde regel staat onderaan het accountmenu. Een dashboard-build-id verschijnt daar alleen op een uitgerolde release.
2. Scan de vier vaste blokken: **Jij bent nodig**, **Open tickets per categorie**, **Lopend en straks** en **Traject**. **Lopend en straks** waarschuwt voor openstaande check-ups en verlopen kijkmomenten, toont de eerstvolgende items uit [Agenda](/docs/ai/agenda), daarna de lopende runs, en eindigt met **Agenda openen**. Traject vergelijkt deze week met vorige week: **Tickets vastgelegd (7 dagen)** telt alleen bevestigde tickets, en het blok linkt naar afgeronde runs, Govern-voorstellen en Verbruik.
3. Klik een rij in de vier blokken om het gesprek, de run of een gefilterde lijst te openen. Een rij onder **Open tickets per categorie** opent de rij van die categorie in Communicatie.
4. **AI-afhandeling** telt open gesprekken per modus (**Autonoom**, **Geassisteerd**, **Handmatig**) en toont **Autonome antwoorden**, **Doorgegeven aan een persoon** en **Concepten aangepast voor verzenden** over de afgelopen 30 dagen. Zie [AI-afhandeling](/docs/inbox/inbox-ai).

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

1. Open **Activiteit** vanuit Communicatie (of de rij **Activiteit** van een agent) als je de volledige stream nodig hebt. Overview zelf houdt het bij de vier blokken.
2. Scan resultaten, niet elke denkstap.
3. Spring naar een gesprek of agent wanneer een rij follow-up vraagt.

## Check Verbruik

1. Open het tabblad **Verbruik** op Overview. De kaart **Budget (platformsleutels)** toont **Tokens vandaag** en **Factureerbare spend deze maand**, plus uitsplitsingen **Per model**, **Per agent**, **Per gebruiker** en **Per dataregio**. De statistiek **Aandeel EU-gehost** toont welk deel van de live tokens op EU-gehoste modellen draaide; wijzig het beleid onder [Data en privacy](/docs/govern/privacy-security). Wissel de periode met **7 dagen**, **30 dagen** of **90 dagen**, of kies **CSV exporteren**.
2. Owners en admins kiezen **Plafonds bewerken**. Zet een **Dagelijks tokenplafond** en een **Maandelijks spendplafond (USD)**, of laat een veld leeg voor **Geen plafond**. Meldingen gaan af bij 80% en 100%.
3. Als het budget op is, pauzeren AI-calls op Bokito-platformkeys tot je het plafond verhoogt of de periode reset. Modellen op je eigen keys blijven werken (**Eigen sleutel (geen kosten)**). Lege beoordelingen zeggen **Nog geen klantbeoordelingen** met **Websitechat installeren**.
