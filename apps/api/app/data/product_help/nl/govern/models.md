---
title: Modellen
intro: Kies Maki, Bokito AI of Kong voor agents. Voeg eigen modellen toe wanneer je plan dat toelaat.
description: Gebruik beheerde Bokito-modellen als standaard voor de workspace, of koppel eigen providersleutels wanneer je workspace dat mag.
keywords: modellen, llm, providers, byok, api-keys, bokito ai, maki, kong, verbruik
sort: 30
related: govern,agents,integrations
---

# Modellen

Modellen staan onder **Instellingen** en daarna **Modellen**. De pagina toont drie beheerde modellen en, wanneer gerechtigd, een lijst met modellen die je met eigen sleutels kunt toevoegen. Verbruik staat op Cockpit **Verbruik**.

## Gebruik beheerde modellen

![Modelinstellingen](/api/docs/assets/models/catalog.png)
*Beheerde modellen zijn de standaard voor de workspace.*

1. Open **Instellingen** en daarna **Modellen**. Het blok met beheerde modellen toont **Actief** wanneer het platform live is.
2. Er zijn altijd drie modellen. Op elke kaart staat de prijs per 1 miljoen tokens (invoer en uitvoer):
   - **Maki** — lichter, goed voor alledaagse taken. Gebruikt minder tokens, dus goedkoper.
   - **Bokito AI** — standaard en gebalanceerd. Default voor nieuwe agents.
   - **Kong** — zwaarder, voor lang of complex werk. Gebruikt meer tokens.
3. Open een [agent](/docs/ai/agents) en kies het model. De kiezer toont deze drie totdat eigen modellen zijn toegestaan en aangezet.

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

Wijst een modelprovider calls voor de hele workspace af (tegoed op, ongeldige sleutel, rate limit), dan stopt Bokito met proberen in plaats van elke mail en wake één voor één te laten mislukken.

1. De eerste geweigerde run wordt vastgelegd als **Mislukt** met de reden van de provider in het resultaat, en er komt een melding in Communicatie.
2. De workspace pauzeert AI-calls één uur. Nieuwe mail in dat uur wordt op het gesprek gemarkeerd als **uitgesteld** en in de wachtrij gezet; geplande wakes melden **geblokkeerd** en schuiven door naar hun volgende moment.
3. Herstel de oorzaak: vul tegoed aan of vervang de sleutel onder **Modellen**. De eerstvolgende geslaagde run heft de pauze op en verwerkt de wachtende gesprekken op volgorde.
4. Mislukte runs tonen altijd hun reden onder **Runs**, zodat een leeg resultaat nooit stil blijft.

## Wat nu

Bevestig dat beheerde modellen Actief zijn, kies per agent een niveau, en kijk daarna naar **Verbruik** op de [Cockpit](/docs/getting-started/cockpit).
