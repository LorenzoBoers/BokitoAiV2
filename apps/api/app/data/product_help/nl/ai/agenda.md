---
title: Zo werkt Agenda
intro: Alles wat op een klok of een inbound event moet gebeuren, plan je hier.
description: Plan eenmalige, terugkerende, herhalende, check-in- en inkomende webhook-wakes, en pauzeer of start ze nu.
keywords: agenda, planner, automatiseringen, cron, webhook, heartbeat
sort: 50
related: agents,projects,communication,agent-runs
---

# Zo werkt Agenda

Agenda is wanneer agents wakker worden. Dit is geen vergaderkalender. Open die om een wake te hangen, een automatisering te pauzeren of te zien wat als volgende afgaat.

## Bekijk de week

![Agenda-weekweergave](/api/docs/assets/agenda/week.png)
*Week toont geplande wakes per dag.*

1. Open **Agenda**. **Week** toont geplande runs per dag.
2. Wissel naar **Lijst** voor dezelfde planning als feed.
3. Vandaag is gemarkeerd zodat je ziet wat als volgende afgaat.

## Hang een wake aan een agent

1. Kies **Nieuw**. De dialoog heet **Nieuw schema**. Je kunt ook **Plannen** openen vanuit [Agents](/docs/ai/agents). Later bewerken opent **Schema bewerken**.
2. Vul **Naam** in, kies een **Type**, een **Doel**-agent, **Wanneer**, en **Instructies voor de agent** (behalve **Event**, dat geen run start). Kies **Opslaan**. **Verwijderen** haalt het item weg.
3. Types:
   - **Eenmalige taak** — wekt één keer op het moment dat je zet, en is daarna klaar.
   - **Event** — een herinnering op de agenda. Geen agent-run.
   - **Terugkerend schema** — **Cron-expressie (UTC)** (bijvoorbeeld ochtenden op weekdagen).
   - **Herhalend** — **Elke (minuten)**.
   - **Check-in** — een heartbeat. De gezaaide **Platform check-in** is hoe de assistent de workspace bewaakt. Die meldt zich alleen wanneer iets aandacht nodig heeft, in één gesprek in Berichten.
   - **Inkomende trigger** — een extern systeem POSTet JSON naar de **Hook-URL**. Na opslaan kopieer je **Inkomend geheim (eenmalig zichtbaar)**. Stuur het als header `X-Bokito-Secret` of `?secret=`. Gebruik later **Testping** en **Geheim vernieuwen**. Inkomende hooks zijn beperkt tot 60 POSTs per minuut.

Laat **Ingeschakeld** aan. Uitgeschakelde items blijven op de agenda maar starten nooit.

## Pauzeer of start een automatisering

![Agenda-automatiseringen](/api/docs/assets/agenda/automations.png)
*Pauzeer, bewerk of start een automatisering nu.*

1. Open **Automatiseringen**. Een lege lijst biedt **Automatisering maken**. Een lege weekdag biedt **Plannen**. Het typefilter blijft in de URL als `kind`.
2. Kies **Pauzeren**, bewerk, of **Nu uitvoeren**.
3. Heartbeats controleren workspace-docs op een timer. Chats op verzoek horen in Activiteit, niet hier.

Als de gekoppelde agent gepauzeerd is, wacht de wake tot je die agent hervat.

## Wat nu

Afgeronde runs verschijnen onder [Agent-runs](/docs/inbox/agent-runs). Langer werk over dagen hoort in [Projecten](/docs/ai/projects).
