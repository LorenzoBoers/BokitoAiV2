---
title: Zo werkt Rapportages
intro: Begin hier als je wilt weten of werk doorloopt en waar aandacht nodig is.
description: Gebruik Rapportages voor de dagelijkse scan, Activiteit voor het eventlog en Verbruik voor tokenbudget en kosten.
keywords: rapportages, cockpit, dashboard, overzicht, verbruik, budget, activiteit
sort: 50
related: communication,agent-runs,decisions,agenda
---

# Zo werkt Rapportages

Rapportages is de ochtendscan. Open die via **Instellingen → Rapportages** (of het workspacemenu) om open werk, wachtende beslissingen en wat agents al deden te zien, en spring daarna in het gesprek dat jou nodig heeft.

## Scan de dag op Overzicht

![Rapportages Overzicht](/api/docs/assets/cockpit/overview.png)
*Overzicht toont open werk, beslissingen en recente runs.*

1. Open **Instellingen**, daarna **Rapportages**. Je landt op **Overzicht**. De ondertitel begroet je en toont de datum van vandaag. **Bijgewerkt** naast **Vernieuwen** is de laatste geslaagde load.
2. Lees de ingebouwde kaarten: **Gesprekken 7d**, **Wacht op beslissing**, **Afgehandeld zonder jou**, **Vrijheid van agents**, **Vraagt aandacht**, **Vandaag op de agenda**, **Recente gebeurtenissen** en **Recente contacten**. **Vrijheid van agents** toont **Jij beslist**, **Vraagt eerst** of **Doet het zelf**. Elk cijfer heeft een korte hint. Lege tijd-bespaard-, afgehandeld-zonder-jou- en AI-verbruikkaarten leggen uit wanneer cijfers verschijnen. Als de uurlijkse scan uitstaat, zegt Overzicht **Uurlijkse inboxscan staat uit**.
3. Klik een kaart om Communicatie, [Agent-runs](/docs/inbox/agent-runs), [Agenda](/docs/ai/agenda) of [Contacten](/docs/inbox/contacts) te openen. Bij **Vraagt aandacht** kies je **Open de eerste** om naar het oudste wachtende gesprek te springen. De klok op een rij zet dat gesprek tot morgen 9:00 in Uitgesteld.

In een nieuwe workspace kan Overzicht nog setupvoortgang tonen. Rond die af via de [setupgids](/docs/getting-started/setup-guide).

## Voeg een cijfer toe dat telt

1. Scroll op Overzicht naar **Jouw cijfers**.
2. Kies **Cijfer toevoegen**. De dialoog heet **Nieuw cijfer**. Geef een **Naam**, een **Eenheid** (Getal, Aantal, Procent, Valuta (EUR) of Duur (minuten)), en optioneel een **Doel**.
3. Vul waarden zelf in, of laat [agents](/docs/ai/agents) het cijfer bijhouden. Platformcijfers worden dagelijks vastgelegd; die kun je niet met de hand vullen.

## Open werk dat op jou wacht

![Rapportages-aandachtspunten](/api/docs/assets/cockpit/awaiting-decision.png)
*Wacht op beslissing springt naar dezelfde lijst als Agent-runs.*

1. Zoek **Wacht op beslissing** op Overzicht.
2. Open die. Je landt op dezelfde lijst als [Agent-runs](/docs/inbox/agent-runs).
3. Handel de beslissing af in het gesprek en keer terug naar Overzicht.

## Lees Activiteit

1. Open de tab **Activiteit**. Dit is het workspace-eventlog (wat mensen en agents deden), niet de wachtrij Agent-runs.
2. Blijf op **Kopregels** om denk- en zoekruis te verbergen, of schakel naar **Volledig log**. Filter met **Agents**, **Mensen**, of **Filter gebeurtenissen...**. Die filters blijven in de URL. De lijst groepeert rijen onder **Vandaag**, **Gisteren** en **Eerder**. Laat **Spring naar nieuwste** aan om bij de laatste rij te blijven.
3. Klik een rij die bij agentwerk hoort om het bijbehorende Agent-runs-gesprek te openen.

## Zet Verbruik en budget

1. Open **Verbruik**. Wissel **7 dagen** / **30 dagen** / **90 dagen** voor de uitsplitsingen, of **CSV exporteren**. De kaart **Budget (platformsleutels)** toont **Tokens vandaag** en **Factureerbare spend deze maand**, plus uitsplitsingen per model, agent en gebruiker. Lege beoordelingen zeggen **Nog geen klantbeoordelingen** met **Websitechat installeren**.
2. Owners en admins kiezen **Plafonds bewerken**. Zet een **Dagelijks tokenplafond** en een **Maandelijks spendplafond (USD)**, of laat beide leeg (bevestigen) om de limieten te verwijderen.
3. Meldingen gaan af bij 80% en 100%. Als het budget op is, pauzeren AI-calls op Bokito-platformkeys tot je het plafond verhoogt of de periode reset. Modellen op je eigen keys blijven werken en tonen geen Bokito-kosten.

Autonome runs groeperen onder Agents / systeem. Chats die jij start, worden aan jou toegerekend.

## Wat nu

Klantmail staat in [Communicatie](/docs/inbox/communication). Terugkerende check-ins staan op de [Agenda](/docs/ai/agenda).
