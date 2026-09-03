---
title: Beslissingen goedkeuren en afwijzen
intro: Agents vragen in het gesprek om jouw oordeel. Elke open goedkeuring deelt één Beslissingen-blad.
description: Keur goed, bewerk of wijs af via de keuzekaart in het gesprek, via Beslissingen, Cockpit of een notificatie.
keywords: beslissingen, goedkeuringen, decision requests, notificaties, human in the loop
sort: 20
related: communication,agent-runs,autonomy,govern
---

# Beslissingen goedkeuren en afwijzen

Een DecisionRequest is een bericht in het gesprek. Communicatie heeft één blad **Beslissingen** met elk gesprek dat een open kaart heeft — klant en intern samen. Je handelt nog steeds af op de kaart in het gesprek.

Automatische mail (bonnen, nieuwsbrieven, no-reply-afzenders) vult Beslissingen niet. De agent noteert die stil in het gesprek. Als tipkaarten van eerdere mail zich hebben opgestapeld, open [Agents](/docs/ai/agents) en gebruik **Tipkaarten wissen**.

## Vind een wachtende beslissing

![Een wachtende beslissing in het gesprek](/api/docs/assets/decisions/approve.png)
*Open het gesprek via Beslissingen, Cockpit of een notificatie.*

1. Open **Communicatie** → **Beslissingen**, of open Cockpit **Wacht op beslissing** / **Vraagt aandacht**. Beide landen op dezelfde lijst.
2. Selecteer een gesprek en scroll naar de keuzekaart. Die toont de voorgestelde actie en waarom de agent stopte.
3. Het bel-menu in de topbalk wijst naar dezelfde kaart.

## Goedkeuren, bewerken of afwijzen

1. Lees het voorstel in de context van het gesprek.
2. Kaarten gebruiken de actie die nodig is: **Goedkeuren**, **Afwijzen**, **Bewerken**, **Escaleren**, **Uitstellen**, **Later**, **Gesprek sluiten**, **Taak aanmaken** of **Open houden**. Conceptantwoord-kaarten van [Inbox AI](/docs/inbox/inbox-ai) gebruiken **Versturen**, **Bewerken** of **Escaleren**.
3. Onder agentberichten markeren kleine iconen **Klopt** of **Niet nuttig**, en het tekstballon-icoon (**Corrigeer dit**) leert de agent — hover voor het label. Escaleren pauzeert AI op het gesprek en wijst jou toe.

## Antwoorden vanuit een notificatie

1. Kies de beslissing in het belmenu, of open de pushmelding op je telefoon. Beide openen het gesprek en springen direct naar de wachtende kaart.
2. Lees de bronregel op de kaart: die noemt waar de vraag vandaan komt — een projectwachtrij-item, een agentrun of een voorgestelde workspacewijziging — en linkt ernaartoe.
3. Antwoord in het gesprek. Inbox AI-voorstellen hebben nog een menselijke verzending nodig tenzij autonomie meer toestaat.
4. Zet notificaties per gebeurtenis aan of uit onder **Instellingen**, dan **Notificaties**.

## Wanneer agents vragen

De workspace-[autonomiehouding](/docs/govern/autonomy) zet de standaard. Op [Govern](/docs/govern/govern) **Beleid** is elke toolcategorie **Weigeren**, **Eerst vragen** of **Toestaan**. **Eerst vragen** maakt de kaart die je in het gesprek ziet. Overrides per agent op de agentpagina winnen van de categorie.

Begin met **Assisted**. Verplaats stappen die je altijd goedkeurt naar **Toestaan**. Houd **Eerst vragen** voor de risicovolle.

## Wat nu

Structurele workspace-wijzigingen wachten op Govern **Openstaande reviews**, niet in het gesprek. Audit later onder Govern **Recente audit**.
