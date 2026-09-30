---
title: Modellen
intro: Bokito AI draait standaard je workspace. Eigen modellen zijn een optionele uitzondering.
description: Gebruik beheerde Bokito AI, of koppel eigen providersleutels wanneer je workspace dat mag.
keywords: modellen, llm, providers, byok, api-keys, bokito ai, verbruik
sort: 30
related: govern,agents,integrations
---

# Modellen

Modellen staan onder **Instellingen** en daarna **Modellen**. Verbruik blijft zichtbaar op Cockpit **Verbruik**.

## Gebruik Bokito AI

![Modelinstellingen](/api/docs/assets/models/catalog.png)
*Bokito AI is de standaard beheerde intelligentie voor de workspace.*

1. Open **Instellingen** en daarna **Modellen**. De kaart **Bokito AI** toont **Actief** wanneer de platformsleutel live is.
2. Laat agents op Bokito AI staan tenzij je eigen sleutels nodig hebt. Verbruik wordt gemeten voor deze workspace en telt mee voor het budget.
3. Open een [agent](/docs/ai/agents) om het model te bevestigen. De kiezer toont alleen Bokito AI totdat eigen modellen zijn toegestaan en aangezet.

## Voeg een eigen model toe (wanneer gerechtigd)

1. Eigen modellen verschijnen alleen wanneer zowel de platformfeature als je workspace-entitlement aan staan. Anders zie je een korte notitie **Eigen sleutels op aanvraag**.
2. Zet **Gebruik eigen modellen** aan en kies **Model toevoegen**. Kies een provider (Anthropic, OpenAI of OpenAI-compatibel), plak een **API-sleutel**, en kies **Opslaan en testen**.
3. Kies een voorgesteld model of vul een eigen model-id in, en sla op. Je modellen verschijnen in agent-kiezers en worden door de provider gefactureerd. Bokito AI blijft de fallback wanneer je eigen modellen uitzet of verwijdert.

## Als AI zonder live sleutel draait

1. Open **Instellingen** en daarna **Modellen**. Toont Bokito AI **Niet geconfigureerd**, dan draaien calls in mock-modus.
2. Een workspacebanner legt uit dat antwoorden tijdelijke placeholders zijn en niet naar klanten gaan. De tijdlijn toont die bubbels als tijdelijk, nooit als **Verstuurd naar de klant**.
3. Neem contact op met Bokito-support (of schakel eigen modellen in met je eigen sleutel wanneer gerechtigd) voordat je **Autonoom** kiest op [Govern](/docs/govern/autonomy).

## Verbruik omzeilt geen goedkeuring

Tokenbudgetten zitten op Cockpit **Verbruik** (dagelijks tokenplafond en maandelijks spendplafond) en op projecten. Als het workspacebudget op is, pauzeren calls op platformkeys; je eigen keys blijven werken. [Govern](/docs/govern/govern) bepaalt nog steeds of een agent mag handelen.

## Wat nu

Bevestig dat Bokito AI Actief is, en kijk daarna naar **Verbruik** op de [Cockpit](/docs/getting-started/cockpit).
