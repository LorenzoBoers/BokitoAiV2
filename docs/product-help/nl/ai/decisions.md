---
title: Beslissingen goedkeuren en afwijzen
intro: Agents vragen goedkeuring in het gesprek wanneer een stap jouw oordeel vraagt.
description: Hoe beslisverzoeken in Bokito werken: waar ze verschijnen, hoe je goedkeurt of afwijst, en hoe apply modes en autonomy posture bepalen wanneer agents vragen.
keywords: beslissingen, goedkeuringen, beslisverzoeken, apply modes, human in the loop
sort: 20
related: autonomy,govern,communication
---

# Beslissingen goedkeuren en afwijzen

Wanneer een agent bij een stap komt die hij niet alleen hoort te zetten - een gevoelig antwoord versturen, configuratie wijzigen, geld uitgeven - plaatst hij een beslisverzoek. Jij keurt goed of wijst af, en de agent gaat verder.

## Waar beslissingen verschijnen

Beslisverzoeken zijn berichten in het gesprek waar ze bij horen, geen aparte wachtrij om te bewaken. Je ziet de redenering van de agent, de voorgestelde actie en het omliggende gesprek op een plek. Openstaande beslissingen verschijnen ook op de Cockpit en in notificaties, zodat niets ongezien blijft wachten.

## Goedkeuren en afwijzen

Open het verzoek, lees het voorstel en kies goedkeuren of afwijzen. Bij goedkeuring voert de agent de actie direct uit. Afwijzen stopt de actie; voeg een korte notitie toe zodat de agent (en je collega's) weten waarom. Afwijzingen voeden hoe agents zich gedragen, dus die tien seconden voor een reden zijn het waard.

## Wanneer agents vragen

Twee instellingen bepalen dit:

- **Apply mode** per resource: `draft` (agent bereidt voor, past nooit toe), `decision` (agent vraagt eerst) of `yolo` (agent past direct toe).
- **Autonomy posture** voor de workspace: `manual`, `assisted` of `autonomous`. De posture zet de standaard; per-resource-overrides in Govern winnen van de posture.

In de praktijk: begin met `assisted`, kijk welke verzoeken je altijd goedkeurt, zet die op `yolo` en houd beslissingen voor de echt risicovolle stappen.

## Achteraf terugkijken

Elke beslissing - wie vroeg, wie antwoordde, wat er gebeurde - staat in Govern onder audit. Structurele wijzigingen (een agent die configuratie aanpast) verschijnen ook als platformwijzigingen die je kunt beoordelen en terugdraaien.
