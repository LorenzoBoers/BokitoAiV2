---
title: Modellen
intro: Bokito AI is de standaard voor je workspace. Voeg eigen modellen toe wanneer je plan dat toelaat.
description: Gebruik beheerde Bokito AI als vaste standaard, of koppel eigen providersleutels wanneer je workspace dat mag.
keywords: modellen, llm, providers, byok, api-keys, bokito ai, verbruik
sort: 30
related: govern,agents,integrations
---

# Modellen

Modellen staan onder **Instellingen** en daarna **Modellen**. De pagina toont een banner **Bokito AI** en een lijst met modellen die je kunt toevoegen of verwijderen. Verbruik staat op Cockpit **Verbruik**.

## Gebruik Bokito AI

![Modelinstellingen](/api/docs/assets/models/catalog.png)
*Bokito AI is de standaard voor de workspace.*

1. Open **Instellingen** en daarna **Modellen**. De banner **Bokito AI** toont **Actief** wanneer het platform live is.
2. Laat agents op Bokito AI staan tenzij je eigen sleutels nodig hebt. Bokito AI is de standaard zolang je geen ander model hebt ingesteld.
3. Open een [agent](/docs/ai/agents) om het model te bevestigen. De kiezer toont alleen Bokito AI totdat eigen modellen zijn toegestaan en aangezet.

## Voeg een model toe (wanneer gerechtigd)

1. Eigen modellen verschijnen alleen wanneer zowel de platformfeature als je workspace-entitlement aan staan. Anders zie je een korte notitie **Eigen sleutels op aanvraag**.
2. Zet **Gebruik eigen modellen** aan en kies **Model toevoegen**. Kies een provider (of **Aangepast (OpenAI-compatibel)** met een basis-URL), plak een **API-sleutel**, en kies **Opslaan en testen**.
3. Kies een voorgesteld model of vul een eigen model-id in, en sla op. Je modellen verschijnen in de lijst en in agent-kiezers. Ze worden door de provider gefactureerd. Bokito AI blijft de fallback wanneer je eigen modellen uitzet of verwijdert.

## Als AI zonder live sleutel draait

1. Open **Instellingen** en daarna **Modellen**. Toont Bokito AI **Niet geconfigureerd**, dan draaien calls in mock-modus.
2. Een workspacebanner legt uit dat antwoorden tijdelijke placeholders zijn en niet naar klanten gaan. De tijdlijn toont die bubbels als tijdelijk, nooit als **Verstuurd naar de klant**.
3. Neem contact op met Bokito-support (of schakel eigen modellen in met je eigen sleutel wanneer gerechtigd) voordat je **Autonoom** kiest op [Govern](/docs/govern/autonomy).

## Verbruik omzeilt geen goedkeuring

Tokenbudgetten zitten op Cockpit **Verbruik** (dagelijks tokenplafond en maandelijks spendplafond) en op projecten. Als het workspacebudget op is, pauzeren calls op platformkeys; je eigen keys blijven werken. [Govern](/docs/govern/govern) bepaalt nog steeds of een agent mag handelen.

## Als de provider weigert

Wijst een modelprovider calls voor de hele workspace af (tegoed op, ongeldige sleutel, rate limit), dan stopt Bokito met proberen in plaats van elke mail en wake één voor één te laten mislukken.

1. De eerste geweigerde run wordt vastgelegd als **Mislukt** met de reden van de provider in het resultaat, en er komt een melding in Communicatie.
2. De workspace pauzeert AI-calls één uur. Nieuwe mail in dat uur wordt op het gesprek gemarkeerd als **uitgesteld** en in de wachtrij gezet; geplande wakes melden **geblokkeerd** en schuiven door naar hun volgende moment.
3. Herstel de oorzaak: vul tegoed aan of vervang de sleutel onder **Modellen**. De eerstvolgende geslaagde run heft de pauze op en verwerkt de wachtende gesprekken op volgorde.
4. Mislukte runs tonen altijd hun reden onder **Runs**, zodat een leeg resultaat nooit stil blijft.

## Wat nu

Bevestig dat Bokito AI Actief is, en kijk daarna naar **Verbruik** op de [Cockpit](/docs/getting-started/cockpit).
