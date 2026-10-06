---
title: Autonomiehouding instellen
intro: Zet hoeveel agents zelf mogen doen, van volledig toezicht tot alleen uitzonderingen.
description: Zet hoe zelfstandig agents werken met de autonomiehouding: handmatig, geassisteerd of autonoom.
keywords: autonomie, houding, handmatig, geassisteerd, autonoom, apply-modi
sort: 20
related: govern,agents,inbox-ai
---

# Autonomiehouding instellen

Autonomiehouding is de vertrouwensdraaiknop van de workspace. Die staat op [Govern](/docs/govern/govern) en vormt het plafond voor het beleid eronder.

## Kies een preset

![Autonomiehouding-presets](/api/docs/assets/autonomy/presets.png)
*Het preset staat op Govern.*

1. Open **Instellingen**, daarna **Govern**, daarna **Beleid**. De kaart heet **Workspace-plafond voor agents**.
2. Kies **Handmatig** (agents concepten, jij past toe), **Geassisteerd** (laag risico gaat door, de rest vraagt), of **Autonoom** (agents handelen binnen toestemmingen). Bij **Autonoom** vraagt de UI eerst **Overschakelen naar Autonoom?**. **Autonoom** blijft uit tot er een live model onder **Providers en modellen** is én minstens één verzendklaar kanaal — anders zie je **Koppel eerst een live model onder Providers en modellen…** of **Koppel eerst een kanaal dat kan versturen…**.
3. De instelling slaat op zodra je kiest. Beleid per actietag of flow mag strenger zijn, nooit ruimer. Zonder live model zijn AI-antwoorden tijdelijk en worden ze nooit als verstuurd naar de klant getoond.

## Stel de drie lagen in

1. Blijf op Govern, daarna **Beleid**.
2. Stel eerst de workspace-houding in en maak daarna waar nodig strenger beleid voor een categorie of draaiboek.
3. Zet op elke agent **Autonomieniveau** (**Handmatig — altijd vragen**, **Goedkeuring — begrensde acties**, **Automatisch — zelfstandig handelen**, of **Workspace-standaard**) en de tool-allowlist. Er zijn geen autonomie-overschrijvingen per tool.
4. **Eerst vragen** maakt de [beslissingskaart](/docs/ai/decisions) in het gesprek.

## Begin voorzichtig

1. Gebruik **Handmatig** of **Geassisteerd** terwijl je leert hoe de workspace zich gedraagt.
2. Kijk welke beslissingen je altijd goedkeurt.
3. Verruim één toolcategorie in plaats van meteen naar **Autonoom** te springen.

## Externe sessies blijven veilig

Websitebezoekers muteren de workspace nooit automatisch, ongeacht de houding. [AI-afhandeling](/docs/inbox/inbox-ai) bepaalt nog steeds wanneer een klantconcept verschijnt.

## Eén draaiknop begrenst ook AI-afhandeling

AI-afhandeling op gesprekken (Autonoom, Geassisteerd, Handmatig) valt onder de Berichten-toestemming: een workspace, kanaal, contact of gesprek kan nooit meer dan Govern toestaat.

1. Staat Berichten op **Eerst vragen**, dan is elk gesprek begrensd op **Geassisteerd**: antwoorden wachten op goedkeuring.
2. Staat Berichten op **Weigeren**, dan is elk gesprek **Handmatig**.
3. Staat Berichten op **Toestaan**, dan geldt de meest specifieke instelling voor AI-afhandeling.
4. Autonome antwoorden pauzeren, de noodrem en actietags die altijd controle nodig hebben staan onder [AI-afhandeling](/docs/inbox/inbox-ai).

## Wat nu

Vergrendel tools op [Govern](/docs/govern/govern). Controleer of elke [agent](/docs/ai/agents) de houding erfde.
