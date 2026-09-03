---
title: Zo werkt Agenda
intro: Alles wat op een klok of een inbound event moet gebeuren, plan je hier, naast gesynchroniseerde kalenderafspraken.
description: Plan agent-wakes, sync Google- of Outlook-kalenders in dezelfde weekweergave, pauzeer automatiseringen of start ze nu.
keywords: agenda, planner, automatiseringen, cron, webhook, heartbeat, google calendar, outlook calendar
sort: 50
related: agents,projects,communication,agent-runs,integrations
---

# Zo werkt Agenda

Agenda is wanneer agents wakker worden, en waar gekoppelde kalenders afspraken tonen. Open die om een wake te hangen, Google of Outlook te syncen, een automatisering te pauzeren of te zien wat als volgende afgaat.

## Bekijk de week

![Agenda-weekweergave](/api/docs/assets/agenda/week.png)
*Week toont geplande wakes en kalenderafspraken per dag.*

1. Open **Agenda**. **Week** toont geplande runs en kalenderafspraken per dag.
2. Wissel naar **Lijst** voor dezelfde planning als feed. Filter met **Alles**, **Wakes** of **Kalender**.
3. Vandaag is gemarkeerd zodat je ziet wat als volgende afgaat.

## Sync Google of Outlook Calendar

1. Kies op Agenda **Google Calendar** of **Outlook Calendar** in de connect-strip, of open **Marketplace** en filter op **Kalender**.
2. Rond OAuth af. Afspraken verschijnen op het weekrooster (in lokale development verschijnen demo-events).
3. Kies **Sync** om te verversen. Kies **Kalenderblok** om een afspraak op een gekoppelde kalender te zetten. Klik op een kalenderchip voor details — **Bewerken** voor titel, tijden, locatie of beschrijving, of **Verwijderen** om te wissen.

Agents met kalendertools kunnen aankomende afspraken tonen (met vaste ids) en nieuwe blokken of verplaatsingen voorstellen die op jouw goedkeuring in Berichten wachten.

## Hang een wake aan een agent

1. Kies **Plannen**. De dialoog heet **Nieuw schema**. Je kunt ook **Plannen** openen vanuit [Agents](/docs/ai/agents). Later bewerken opent **Schema bewerken**.
2. Vul **Naam** in, kies een **Type**, een **Doel**-agent, **Wanneer**, en **Instructies voor de agent** (behalve **Event**, dat geen run start). Kies **Opslaan**. **Verwijderen** haalt het item weg.
3. Types:
   - **Eenmalige taak** — wekt één keer op het moment dat je zet, en is daarna klaar.
   - **Event** — een herinnering op de agenda. Geen agent-run.
   - **Terugkerend schema** — **Cron-expressie (UTC)** (bijvoorbeeld ochtenden op weekdagen).
   - **Herhalend** — **Elke (minuten)**.
   - **Check-in** — een heartbeat. De gezaaide check-in is hoe de assistent de workspace bewaakt. Die meldt zich alleen wanneer iets aandacht nodig heeft, in het eigen kanaal van die assistent in Communicatie.
   - **Inkomende trigger** — een extern systeem POSTet JSON naar de **Hook-URL**. Na opslaan kopieer je **Inkomend geheim (eenmalig zichtbaar)**. Stuur het als header `X-Bokito-Secret` of `?secret=`. Gebruik later **Testping** en **Geheim vernieuwen**. Inkomende hooks zijn beperkt tot 60 POSTs per minuut.

Laat **Ingeschakeld** aan. Uitgeschakelde items blijven op de agenda maar starten nooit.

## Pauzeer of start een automatisering

![Agenda-automatiseringen](/api/docs/assets/agenda/automations.png)
*Pauzeer, bewerk of start een automatisering nu.*

1. Open **Automatiseringen**. Een lege lijst biedt **Automatisering maken**. Een lege weekdag biedt **Plannen**. Het typefilter blijft in de URL als `kind`.
2. **Pauzeer**, bewerk, of **Nu uitvoeren**.
3. Heartbeats checken workspace-docs op een timer. On-demand chatruns horen in Activiteit, niet hier.

Als de gekoppelde agent is gearchiveerd, faalt de wake tot je een andere agent kiest.

## Laat agents hun eigen opvolging plannen

Agents kunnen zelf werk plannen: vraag in een gesprek aan een agent om "dit vrijdag opnieuw te checken" of "het team te herinneren aan het voorstel".

1. De agent gebruikt zijn planningstools om een wake te maken (eenmalig, cron, of elke N minuten) voor zichzelf of een collega-agent, of om een taak voor later te plannen — ook taken toegewezen aan een persoon.
2. Afhankelijk van je [autonomie-houding](/docs/govern/autonomy) wordt de planning direct gemaakt of verschijnt die eerst als beslissingskaart in Berichten ter goedkeuring.
3. Goedgekeurde wakes verschijnen op de Agenda als elke andere planning; geplande taken worden wakker op het ingestelde moment. Een taak voor een persoon verschijnt als notificatie zodra die actueel is.

## Wat daarna

Afgeronde runs verschijnen onder [Agent-runs](/docs/inbox/agent-runs). Langer werk over dagen hoort in [Projects](/docs/ai/projects). Meer apps koppelen via [Integraties](/docs/integrations/integrations).
