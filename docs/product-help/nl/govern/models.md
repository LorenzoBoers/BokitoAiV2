---
title: Modellen kiezen
intro: Kies welke taal- en embeddingmodellen deze workspace mag gebruiken.
description: Kies welke AI-modellen je workspace aandrijven en koppel je eigen providerkeys.
keywords: modellen, llm, providers, byok, api-keys, verbruik
sort: 30
related: govern,agents,integrations
---

# Modellen kiezen

Providers en modellen staan onder **Instellingen** en daarna **Providers en modellen**. Verbruik blijft zichtbaar op Cockpit **Verbruik**.

## Zet een workspacemodel aan

![Modelinstellingen](/api/docs/assets/models/catalog.png)
*Zet de chat- en embeddingmodellen aan die deze workspace nodig heeft.*

1. Open **Instellingen** en daarna **Providers en modellen**. De kaart **Bokito AI** is standaard **Actief**: Bokito kiest chat- en embeddingmodellen. Verbruik telt mee voor het workspacebudget.
2. Zet extra chat- en embeddingmodellen aan. Op een provider die je zelf toevoegde gebruik je **Voorgestelde modellen inschakelen** (eerst bevestigen) of een eigen model. Filter de lijst, kopieer een model-id, en lees **Lage kosten** / **Gemiddelde kosten** / **Hoge kosten** (hover voor prijs per miljoen).
3. Open een [agent](/docs/ai/agents) en bevestig of overschrijf het model. De agentpagina linkt **Providers en modellen openen**.

## Voeg je eigen key toe

1. Blijf op Providers en modellen. Onder **Eigen providers** kies je **Provider toevoegen**.
2. Kies een **Providertype**, plak een **API-sleutel** (tonen of verbergen), en optioneel een **Label** of **Basis-URL** (voor OpenAI-compatibele endpoints). Druk op Enter of **Provider opslaan**, daarna **Testen**. Een werkende sleutel toont **Verbinding OK** in groen en **Sleutel ingesteld ····** plus de laatste vier tekens. **Verwijderen** vraagt om bevestiging.
3. Modellen op je sleutels gaan voor op Bokito AI; de kaart Bokito AI toont dan **Stand-by**. De provider factureert die calls. Verwijder de sleutels en Bokito AI is weer de fallback.

## Verbruik omzeilt geen goedkeuring

Tokenbudgetten zitten op Cockpit **Verbruik** (dagelijks tokenplafond en maandelijks spendplafond) en op projecten. Als het workspacebudget op is, pauzeren calls op platformkeys; je eigen keys blijven werken. [Govern](/docs/govern/govern) bepaalt nog steeds of een agent mag handelen.

## Wat nu

Bevestig dat een chatmodel aan staat, en kijk daarna naar **Verbruik** op de [Cockpit](/docs/getting-started/cockpit).
