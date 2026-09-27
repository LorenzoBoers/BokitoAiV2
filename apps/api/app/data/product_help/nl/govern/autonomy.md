---
title: Autonomiehouding instellen
intro: Zet hoeveel agents zelf mogen doen, van volledig toezicht tot alleen uitzonderingen.
description: Zet hoe zelfstandig agents werken met de autonomiehouding: handmatig, ondersteund of autonoom.
keywords: autonomie, houding, handmatig, ondersteund, autonoom, apply-modi
sort: 20
related: govern,agents,inbox-ai
---

# Autonomiehouding instellen

Autonomiehouding is de vertrouwensdraaiknop van de workspace. Die staat op [Govern](/docs/govern/govern) en vormt het plafond voor het beleid eronder.

## Kies een preset

![Autonomiehouding-presets](/api/docs/assets/autonomy/presets.png)
*Het preset staat op Govern.*

1. Open **Instellingen**, daarna **Govern**, daarna **Beleid**. De kaart heet **Hoeveel agents mogen doen**.
2. Kies **Handmatig** (agents concepten, jij past toe), **Ondersteund** (laag risico gaat door, de rest vraagt), of **Autonoom** (agents handelen binnen toestemmingen). **Autonoom** blijft uit tot de workspace een live model heeft én minstens één verzendklaar kanaal.
3. De instelling slaat op zodra je kiest. Beleid per type of draaiboek mag strenger zijn, nooit ruimer. Zonder live model zijn AI-antwoorden tijdelijk en worden ze nooit als verstuurd naar de klant getoond.

## Stel de drie lagen in

1. Blijf op Govern, daarna **Beleid**.
2. Stel eerst de workspace-houding in en maak daarna waar nodig strenger beleid voor een Signaaltype of Draaiboek.
3. Gebruik op elke agent de tool-allowlist om te bepalen welke tools die mag aanroepen. Er zijn geen autonomie-overschrijvingen per tool.
4. **Eerst vragen** maakt de [beslissingskaart](/docs/ai/decisions) in het gesprek.

## Begin voorzichtig

1. Gebruik **Handmatig** of **Ondersteund** terwijl je leert hoe de workspace zich gedraagt.
2. Kijk welke beslissingen je altijd goedkeurt.
3. Verruim één toolcategorie in plaats van meteen naar **Autonoom** te springen.

## Externe sessies blijven veilig

Websitebezoekers muteren de workspace nooit automatisch, ongeacht de houding. [Inbox AI](/docs/inbox/inbox-ai) bepaalt nog steeds wanneer een klantconcept verschijnt.

## Eén draaiknop begrenst ook kanaal-AI

De AI-modus per kanaal (voorstellen, automatisch, uit) is een weergave van de Berichten-toestemming: kanalen kunnen nooit meer dan Govern toestaat.

1. Staat Berichten op **Eerst vragen**, dan gedragen kanalen op **Automatisch** zich als **Voorstellen**: antwoorden wachten op goedkeuring.
2. Staat Berichten op **Weigeren**, dan staat AI uit op elk kanaal.
3. Staat Berichten op **Toestaan**, dan geldt de eigen modus van elk kanaal.

## Wat nu

Vergrendel tools op [Govern](/docs/govern/govern). Controleer of elke [agent](/docs/ai/agents) de houding erfde.
