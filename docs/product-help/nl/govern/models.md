---
title: Modellen
intro: Stel de workspace Bokito AI-standaard in (of Automatisch), kies daarna een modus per agent. Voeg eigen modellen toe wanneer je plan dat toelaat.
description: Gebruik Bokito AI-modellen als workspace-standaard, kies Automatisch zodat Bokito een niveau kiest, of koppel eigen providersleutels wanneer gerechtigd.
keywords: modellen, llm, providers, byok, api-keys, Bokito, maki, kong, automatisch, workspace-standaard, verbruik
sort: 30
related: govern,agents,integrations
---

# Modellen

Modellen staan onder **Instellingen** en daarna **Modellen**. De pagina toont **Bokito AI-modellen** (Automatisch plus Maki, Bokito en Kong) en, wanneer gerechtigd, modellen die je met eigen sleutels toevoegt. Verbruik staat op Cockpit **Verbruik**.

## Stel de workspace Bokito AI-standaard in

![Modelinstellingen](/api/docs/assets/models/catalog.png)
*Bokito AI-modellen — klik op een kaart om de workspace-standaard in te stellen.*

1. Open **Instellingen** en daarna **Modellen**. Het blok **Bokito AI-modellen** toont **Actief** wanneer het platform live is.
2. Klik op één kaart om de **Workspace-standaard** in te stellen:
   - **Automatisch** — Bokito kiest Maki, Bokito of Kong per actie op basis van de taak.
   - **Maki** — lichter, goed voor alledaagse taken. Gebruikt minder tokens, dus goedkoper. Groter contextvenster voor lange threads.
   - **Bokito** — standaard en gebalanceerd voor het meeste agentwerk.
   - **Kong** — zwaarder, voor lang of complex werk. Denkt altijd na voordat hij antwoordt, dus gebruikt meer tokens.
3. Op elke modelkaart staan het contextvenster (en tools / vision wanneer ondersteund) en de prijs per 1 miljoen tokens (invoer en uitvoer). Onder de kaarten: **EU-gehost**, **Altijd actueel**, **Traint niet op jouw data**, en **Bij met toonaangevende modellen**.
4. Nieuwe workspaces starten op **Automatisch**. Agents op **Workspace-standaard** vallen terug op deze keuze. Agents met een eigen modus (Automatisch of een vastgezet niveau) negeren die.

## Kies een modus op een agent

1. Open een [agent](/docs/ai/agents). Onder **Model en runtime** kies je:
   - **Workspace-standaard** — volgt **Instellingen → Modellen**.
   - **Automatisch** — Bokito kiest het niveau per actie.
   - **Maki**, **Bokito** of **Kong** — altijd dat niveau voor deze agent.
2. Later kan een flowstadium of Agenda-taak een model forceren voor dat item; die override gaat voor de agentmodus en de workspace-standaard.

## Voeg een model toe (wanneer gerechtigd)

1. Eigen modellen verschijnen alleen wanneer zowel de platformfeature als je workspace-entitlement aan staan. Anders zie je een korte notitie **Eigen sleutels op aanvraag**.
2. Zet **Gebruik eigen modellen** aan en kies **Model toevoegen**. Kies een provider (of **Aangepast (OpenAI-compatibel)** met een basis-URL), plak een **API-sleutel**, en kies **Opslaan en testen**.
3. Kies een voorgesteld model of vul een eigen model-id in, en sla op. Je modellen verschijnen in de lijst en in agent-kiezers. Ze worden door de provider gefactureerd. Beheerde modellen blijven de fallback wanneer je eigen modellen uitzet of verwijdert.

## Als AI zonder live sleutel draait

1. Open **Instellingen** en daarna **Modellen**. Toont een beheerd model **Niet geconfigureerd**, dan kunnen calls voor dat niveau in mock-modus draaien.
2. Een workspacebanner legt uit dat antwoorden tijdelijke placeholders zijn en niet naar klanten gaan. De tijdlijn toont die bubbels als tijdelijk, nooit als **Verstuurd naar de klant**.
3. Neem contact op met Bokito-support (of schakel eigen modellen in met je eigen sleutel wanneer gerechtigd) voordat je **Autonoom** kiest op [Govern](/docs/govern/autonomy).

## Verbruik omzeilt geen goedkeuring

Tokenbudgetten zitten op Cockpit **Verbruik** (dagelijks tokenplafond en maandelijks spendplafond) en op projecten. Als het workspacebudget op is, pauzeren calls op platformkeys; je eigen keys blijven werken. [Govern](/docs/govern/govern) bepaalt nog steeds of een agent mag handelen.

## Als de provider weigert

Wanneer een modelprovider calls voor de hele workspace weigert (geen tegoed, ongeldige sleutel, rate limit), stopt Bokito met hammeren in plaats van elke mail en wake één voor één te laten falen.

1. De eerste geweigerde run wordt **Mislukt** met de reden van de provider in het resultaat, en er landt een alert in Communicatie.
2. De workspace pauzeert AI-calls één uur. Nieuwe mail in dat uur wordt **uitgesteld** op de thread en in de wachtrij gezet; geplande wakes melden **geblokkeerd** en schuiven naar hun volgende tijd.
3. Los de oorzaak op: tegoed bijvullen of de sleutel vervangen onder **Modellen**. De volgende geslaagde run heft de pauze op en verwerkt de wachtende gesprekken op volgorde.
4. Mislukte runs tonen altijd hun reden onder **Runs**, zodat een leeg resultaat nooit stil blijft.

## Wat nu

Stel de workspace-standaard in op **Bokito AI-modellen**, kies een modus per [agent](/docs/ai/agents), en bekijk **Verbruik** op de [Cockpit](/docs/getting-started/cockpit).
