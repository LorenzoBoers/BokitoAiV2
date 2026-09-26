---
title: Zo werkt Agenda
intro: Geplande check-ins, eenmalige wakes, kijkmomenten op gesprekken en kalenderblokken delen één tijdlijn, met wie kijkt op elk item.
description: Bekijk wat er gepland staat, plan agent-wakes en toon gekoppelde kalenderafspraken naast kijkmomenten.
keywords: agenda, planning, check-in, wake, kijkmoment, google calendar, outlook calendar
sort: 50
related: agents,projects,communication,agent-runs,integrations,workstreams
---

# Zo werkt Agenda

Agenda is wat er gepland staat. Die combineert aankomende momenten met voorbije uitvoeringen en noemt de verantwoordelijke agent of persoon.

## Bekijk wat er gepland staat

![Agenda-weekweergave](/api/docs/assets/agenda/week.png)
*Week toont geplande wakes, kijkmomenten en kalenderafspraken per dag.*

1. Open **Agenda**. **Tijdlijn** toont de vorige zeven dagen en de volgende drie weken.
2. Elk item toont status en actor: **Agent** voor een geplande wake of **Persoon** voor een menselijk kijkmoment of kalenderblok. Kies een item om de run, het gesprek, de kalenderafspraak of het schema te openen.
3. Filter met **Alles**, **Wakes**, **Kijkmomenten** of **Kalender**. Kies **Week** wanneer een dagrooster handiger is.

## Sync Google of Outlook Calendar

1. Kies op Agenda **Google Calendar** of **Outlook Calendar** in de connect-strip, of open **Marketplace** en filter op **Kalender**.
2. Rond OAuth af. Afspraken verschijnen op het weekrooster (in lokale development verschijnen demo-events).
3. Kies **Sync** om te verversen. Kies **Kalenderblok** om een afspraak op een gekoppelde kalender te zetten. Klik op een kalenderchip voor details — **Bewerken** voor titel, tijden, locatie of beschrijving, of **Verwijderen** om te wissen.

Agents met kalendertools kunnen aankomende afspraken tonen (met vaste ids) en nieuwe blokken of verplaatsingen voorstellen die op jouw goedkeuring in Berichten wachten.

## Hang een wake aan een agent

1. Kies **Plannen**. De dialoog heet **Nieuw schema**. Je kunt ook **Plannen** openen vanuit [Agents](/docs/ai/agents). Later bewerken opent **Schema bewerken**.
2. Vul **Naam** in, kies een **Type**, een **Doel**-agent, **Wanneer**, en **Instructies voor de agent** (behalve **Event**, dat geen run start). Kies **Opslaan**. **Verwijderen** haalt het item weg.
3. Types:
   - **Eenmalig** — wekt één keer op het moment dat je zet, en is daarna klaar.
   - **Event** — een herinnering op de agenda. Geen agent-run.
   - **Terugkerend schema** — **Cron-expressie (UTC)** (bijvoorbeeld ochtenden op weekdagen).
   - **Herhalend** — **Elke (minuten)**.
   - **Check-in** — een heartbeat. De gezaaide check-in is hoe de assistent de workspace bewaakt. Die meldt zich alleen wanneer iets aandacht nodig heeft, in het eigen kanaal van die assistent in Communicatie.
   - **Inkomend** — een extern systeem POSTet JSON naar de **Hook-URL**. Na opslaan kopieer je **Inkomend geheim (eenmalig zichtbaar)**. Stuur het als header `X-Bokito-Secret` of `?secret=`. Gebruik later **Testping** en **Geheim vernieuwen**. Inkomende hooks zijn beperkt tot 60 POSTs per minuut.

Laat **Ingeschakeld** aan. Uitgeschakelde items blijven op de agenda maar starten nooit.

## Laat agents hun eigen opvolging plannen

Agents kunnen zelf werk plannen: vraag in een gesprek aan een agent om "dit vrijdag opnieuw te checken" of "het team te herinneren aan het voorstel".

1. De agent gebruikt zijn planningstools om een wake te maken (eenmalig, cron, of elke N minuten) voor zichzelf of een collega-agent.
2. Afhankelijk van je [autonomie-houding](/docs/govern/autonomy) wordt de planning direct gemaakt of verschijnt die eerst als beslissingskaart in Berichten ter goedkeuring.
3. Goedgekeurde wakes verschijnen op de Agenda-tijdlijn. Kijkmomenten van **Wat nu** op een gesprek verschijnen hier ook als persoonsitems — open ze om terug te gaan naar dat gesprek.

## Wat daarna

Afgeronde runs verschijnen onder [Agent-runs](/docs/inbox/agent-runs). Langer werk over dagen hoort in [Projects](/docs/ai/projects). Meer apps koppelen via [Integraties](/docs/integrations/integrations).
