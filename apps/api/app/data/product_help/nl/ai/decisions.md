---
title: Beslissingen goedkeuren en afwijzen
intro: Agents vragen in het gesprek wanneer een stap jouw oordeel nodig heeft.
description: Keur keuzekaarten in het gesprek goed, pas ze aan of wijs ze af, vanuit Cockpit of vanuit Slack als die gekoppeld is.
keywords: beslissingen, goedkeuringen, keuzekaarten, slack, human in the loop
sort: 20
related: communication,agent-runs,autonomy,govern
---

# Beslissingen goedkeuren en afwijzen

Een beslisverzoek is een bericht in het gesprek, geen aparte wachtrij. Open Communicatie of Agent-runs wanneer iets op jou wacht.

## Vind een wachtende beslissing

![Een wachtende beslissing in het gesprek](/api/docs/assets/decisions/approve.png)
*Open het gesprek vanuit Communicatie, Agent-runs of Cockpit.*

1. Open het gesprek vanuit Communicatie, [Agent-runs](/docs/inbox/agent-runs) **Beslissingen**, of Cockpit **Wacht op beslissing**.
2. Scroll naar de keuzekaart. Die toont de voorgestelde actie en waarom de agent stopte.
3. Het belmenu in de topbalk wijst naar dezelfde kaart.

## Goedkeuren, aanpassen of afwijzen

1. Lees het voorstel in de context van het gesprek.
2. Kaarten gebruiken de actie die nodig is: **Goedkeuren**, **Afwijzen**, **Bewerken**, **Escaleren**, **Uitstellen**, **Later**, **Gesprek sluiten**, **Taak aanmaken** of **Open laten**. Conceptkaarten van [Inbox AI](/docs/inbox/inbox-ai) gebruiken **Versturen**, **Bewerken** of **Escaleren**.
3. Op agentberichten kun je **Goed** of **Niet behulpzaam** zetten, of **Corrigeer** om de agent te leren. Escaleren pauzeert AI op het gesprek en wijst jou toe.

## Antwoord vanuit Slack

1. Koppel Slack onder **Instellingen** en daarna **E-mail en berichten**. Zie [Kanalen](/docs/inbox/channels). Keuzekaarten kunnen daar binnenkomen met **Goedkeuren** en **Weigeren**.
2. Gebruik die knoppen wanneer je niet in Bokito zit. Het gesprek in Communicatie werkt hetzelfde bij.
3. Inbox AI-voorstellen hebben nog een menselijke verzending nodig, tenzij autonomie meer toestaat.

## Wanneer agents vragen

De workspace-[autonomiehouding](/docs/govern/autonomy) zet de standaard. Op [Govern](/docs/govern/govern) **Beleid** is elke toolcategorie **Weigeren**, **Eerst vragen** of **Toestaan**. **Eerst vragen** maakt de kaart die je in het gesprek ziet. Uitzonderingen per agent op de agentpagina winnen van de categorie.

Begin met **Ondersteund**. Verplaats stappen die je altijd goedkeurt naar **Toestaan**. Houd **Eerst vragen** voor de risicovolle.

## Wat nu

Structurele workspace-bewerkingen wachten op Govern **Openstaande concepten**, niet in het gesprek. Audit later onder Govern **Recente audit**.
