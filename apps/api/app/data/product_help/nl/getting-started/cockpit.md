---
title: Zo werkt Overview
intro: Begin hier als je wilt weten of werk doorloopt en waar aandacht nodig is.
description: Gebruik Overview voor de dagelijkse scan, Activiteit voor het eventlog en Verbruik voor tokenbudget en kosten.
keywords: overview, rapportages, cockpit, dashboard, overzicht, verbruik, budget, activiteit
sort: 50
related: communication,agent-runs,decisions,agenda
---

# Zo werkt Overview

Overview is de ochtendscan. Open die in de linkerrail om te zien waar jij nodig bent, welke signalen openstaan, wat loopt en hoe het traject zich ontwikkelt, en spring daarna in het onderliggende gesprek of de run. Onder **Instellingen → Profiel** kun je Overview als startpagina na inloggen kiezen; Communicatie blijft de standaard.

## Scan de dag op Overview

![Overview](/api/docs/assets/cockpit/overview.png)
*Overview toont open werk, beslissingen en recente runs.*

1. Open **Overview** in de linkerrail. Je landt op de scan. De ondertitel begroet je en toont de datum van vandaag. **Bijgewerkt** naast **Vernieuwen** is de laatste geslaagde load.
2. Scan de vier vaste blokken: **Jij bent nodig**, **Open signalen per type**, **Lopend** en **Traject**. Traject vergelijkt deze week met vorige week en linkt naar afgeronde runs, Govern-voorstellen en Verbruik.
3. Klik een rij om het gesprek, de run of een gefilterde lijst te openen. Overview zelf wijzigt geen operationele gegevens.

In een nieuwe workspace kan Overview nog setupvoortgang tonen. Rond die af via de [setupgids](/docs/getting-started/setup-guide).

## Open werk dat op jou wacht

![Overview-aandachtspunten](/api/docs/assets/cockpit/awaiting-decision.png)
*Wacht op beslissing springt naar dezelfde lijst als Agent-runs.*

1. Zoek het gesprek onder **Jij bent nodig**.
2. Open het. Je landt op het bijbehorende gesprek in Communicatie.
3. Handel de beslissing af in het gesprek en keer terug naar Overview.

## Lees Activiteit

1. Blijf op Overview en open **Recente gebeurtenissen**, of open **Activiteit** vanuit Communicatie als je de volledige stream nodig hebt.
2. Scan resultaten, niet elke denkstap.
3. Spring naar een gesprek of agent wanneer een rij follow-up vraagt.

## Check Verbruik

1. Open het tabblad **Verbruik** op Overview. De kaart **Budget (platformsleutels)** toont **Tokens vandaag** en **Factureerbare spend deze maand**, plus uitsplitsingen **Per model** en **Per agent**. Wissel de periode met **7 dagen**, **30 dagen** of **90 dagen**, of kies **CSV exporteren**.
2. Owners en admins kiezen **Plafonds bewerken**. Zet een **Dagelijks tokenplafond** en een **Maandelijks spendplafond (USD)**, of laat een veld leeg voor **Geen plafond**. Meldingen gaan af bij 80% en 100%.
3. Als het budget op is, pauzeren AI-calls op Bokito-platformkeys tot je het plafond verhoogt of de periode reset. Modellen op je eigen keys blijven werken (**Eigen sleutel (geen kosten)**). Lege beoordelingen zeggen **Nog geen klantbeoordelingen** met **Websitechat installeren**.
