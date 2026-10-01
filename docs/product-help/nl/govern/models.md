---
title: Modellen
intro: Bokito AI draait je workspace standaard op een EU-gehost model. Eigen modellen zijn een optionele uitzondering.
description: Gebruik beheerde Bokito AI (standaard EU), bepaal of US-gehoste platformmodellen mogen draaien, of koppel eigen providersleutels wanneer je workspace dat mag.
keywords: modellen, llm, providers, byok, api-keys, bokito ai, verbruik, dataregio, eu, mistral, avg
sort: 30
related: govern,agents,integrations
---

# Modellen

Modellen staan onder **Instellingen** en daarna **Modellen**. Bokito AI verwerkt gesprekken op een EU-gehost model tenzij jij anders beslist; verbruik en het EU-aandeel staan op Cockpit **Verbruik**.

## Gebruik Bokito AI

![Modelinstellingen](/api/docs/assets/models/catalog.png)
*Bokito AI is de standaard beheerde intelligentie voor de workspace.*

1. Open **Instellingen** en daarna **Modellen**. De kaart **Bokito AI** toont **Actief** wanneer de platformsleutel live is.
2. Lees de regels **Chatmodel** en **Embeddingmodel**: elk toont het onderliggende model, de provider en een regiobadge (**EU** of **VS**).
3. Laat agents op Bokito AI staan tenzij je eigen sleutels nodig hebt. Verbruik wordt gemeten voor deze workspace en telt mee voor het budget.
4. Open een [agent](/docs/ai/agents) om het model te bevestigen. De kiezer toont alleen Bokito AI totdat eigen modellen zijn toegestaan en aangezet, en elke optie draagt zijn regio.

## Controleer waar data wordt verwerkt

![Dataregio](/api/docs/assets/models/data-region.png)
*De kaart Dataregio toont het EU-aandeel van de laatste 30 dagen en of US-gehoste platformmodellen mogen draaien.*

1. Open **Instellingen**, daarna **Modellen**, en scrol naar **Dataregio**.
2. Het percentage toont hoeveel live tokens van de laatste 30 dagen op EU-gehoste modellen draaiden. Kennis-embeddings draaien nog op een US-gehost model; een EU-alternatief volgt met een herindexeringsstap.
3. Toont de kaart Bokito AI een oranje melding, dan is het EU-gehoste model tijdelijk niet beschikbaar en draait Bokito AI op een fallback in de VS. Bokito schakelt automatisch terug; niets wordt verborgen.
4. Voor de tokenverdeling per regio open je de [Cockpit](/docs/getting-started/cockpit)-pagina **Verbruik** en lees je **Per dataregio**.

## Sta US-gehoste platformmodellen toe

1. Open **Instellingen**, daarna **Modellen**, daarna **Dataregio**. De schakelaar **US-gehoste platformmodellen toestaan** staat standaard uit.
2. Zolang hij uit staat, draait een agent die naar een US-gehost platformmodel (Anthropic, OpenAI) wijst in plaats daarvan op Bokito AI. De kaart toont die modellen onder **US-gehoste modellen gekozen door actieve agents**.
3. Zet de schakelaar alleen aan als je verwerkersovereenkomst doorgifte naar de VS dekt. Eigenaren en beheerders kunnen hem wijzigen; de wijziging wordt vastgelegd.
4. Je eigen providersleutels worden nooit omgeleid: een BYOK-model draait waar zijn provider draait en toont die regio.

## Voeg een eigen model toe (wanneer gerechtigd)

1. Eigen modellen verschijnen alleen wanneer zowel de platformfeature als je workspace-entitlement aan staan. Anders zie je een korte notitie **Eigen sleutels op aanvraag**.
2. Zet **Gebruik eigen modellen** aan en kies **Model toevoegen**. Kies een provider (**Mistral (EU)**, **Anthropic (US)**, **OpenAI (US)** of **OpenAI-compatibel**), plak een **API-sleutel**, en kies **Opslaan en testen**.
3. Kies een voorgesteld model of vul een eigen model-id in, en sla op. Je modellen verschijnen in agent-kiezers met hun regiobadge en worden door de provider gefactureerd. Bokito AI blijft de fallback wanneer je eigen modellen uitzet of verwijdert.

## Als AI zonder live sleutel draait

1. Open **Instellingen** en daarna **Modellen**. Toont Bokito AI **Niet geconfigureerd**, dan draaien calls in mock-modus.
2. Een workspacebanner legt uit dat antwoorden tijdelijke placeholders zijn en niet naar klanten gaan. De tijdlijn toont die bubbels als tijdelijk, nooit als **Verstuurd naar de klant**.
3. Neem contact op met Bokito-support (of schakel eigen modellen in met je eigen sleutel wanneer gerechtigd) voordat je **Autonoom** kiest op [Govern](/docs/govern/autonomy).

## Verbruik omzeilt geen goedkeuring

Tokenbudgetten zitten op Cockpit **Verbruik** (dagelijks tokenplafond en maandelijks spendplafond) en op projecten. Als het workspacebudget op is, pauzeren calls op platformkeys; je eigen keys blijven werken. [Govern](/docs/govern/govern) bepaalt nog steeds of een agent mag handelen.

## Wat nu

Bevestig dat Bokito AI Actief en EU is, en kijk daarna naar **Verbruik** op de [Cockpit](/docs/getting-started/cockpit).
