---
title: Zo werkt Govern
intro: Structurele wijziging en risico wonen hier. Dagelijkse antwoorden blijven in Communicatie.
description: Beoordeel openstaande platformwijzigingen, zet beleidssliders, maak toegepaste edits ongedaan en lees het auditlog in Govern.
keywords: govern, openstaande concepten, beleid, audit, ongedaan maken, toestemmingen
sort: 10
related: autonomy,agents,decisions
---

# Zo werkt Govern

Govern heeft twee onderdelen: **Ledger** legt workspace-wijzigingen en auditgebeurtenissen vast, terwijl **Autonomie** bepaalt wat agents mogen doen. Open **Instellingen** en daarna **Govern**. Keuzes op berichtniveau blijven in het gesprek.

## Beoordeel een platformwijziging

![Govern-conceptwachtrij](/api/docs/assets/govern/drafts.png)
*Structurele concepten wachten hier. Berichtbeslissingen blijven in het gesprek.*

1. Open onder **Ledger** de **Openstaande concepten**.
2. Lees wat de agent wil wijzigen. Kies **Bekijk wijzigingen** voor de diff.
3. **Accepteren** vraagt **Deze wijziging toepassen op je workspace?** **Afwijzen** vraagt **Deze wijziging afwijzen?** Klantbeslissingen blijven in [Communicatie](/docs/inbox/communication).

## Zet houding en toestemmingen

![Govern-beleid](/api/docs/assets/govern/posture.png)
*Kies Handmatig, Ondersteund of Autonoom, en stel daarna categorieën bij.*

1. Open onder **Autonomie** het **Beleid**. De kaart heet **Hoeveel agents mogen doen**.
2. Kies **Handmatig**, **Ondersteund** of **Autonoom**. Zie [Autonomie](/docs/govern/autonomy).
3. Onder **Toestemmingsniveaus** zet je elke categorie op **Weigeren**, **Eerst vragen** of **Toestaan**. Overschrijf één tool wanneer de categorie te breed is.
4. Categorieën zijn onder meer Berichten, Workspace, Agents, Kanalen, Triggers, Integraties, Govern en Overdracht. Externe bezoekerssessies muteren nooit automatisch.
5. Als learning veel geëscaleerde tool-gates of afgewezen toolbeslissingen ziet op een categorie die **Toestaan** stond, kan Bokito die slider automatisch aanscherpen naar **Eerst vragen**. Onder de sliders verschijnt een korte notitie. Losser maken blijft hier een handmatige edit.
6. Zet onder **Autonomie per type en draaiboek** elk actief Signaaltype en draaiboek op **Handmatig**, **Eerst vragen** of **Automatisch**.

Uitzonderingen per agent staan op de agentpagina onder Tools en toestemmingen.

## Autonome gesprekken bewaken

![Kaart Gesprekken op Govern](/api/docs/assets/govern/conversations.png)
*Het plafond voor AI-afhandeling, wat autonoom draait, en de noodrem.*

1. Open onder **Autonomie** het tabblad **Beleid** en zoek **Gesprekken**. Het **Plafond** volgt de Berichten-toestemming: **Eerst vragen** begrenst elk gesprek op Geassisteerd, **Weigeren** op Handmatig.
2. Kies **Autonome antwoorden pauzeren** om in een stap alles op Geassisteerd te begrenzen. **Autonome antwoorden toestaan** heft dat weer op.
3. **Draait autonoom** toont de workspace-standaard, kanalen, contacten en gesprekken die zelf antwoorden.
4. Zet onder **Signaaltypes die altijd controle nodig hebben** een type op **Altijd controleren**. Antwoorden in een gesprek met dat signaaltype worden een concept, ook als het gesprek autonoom is.
5. Stel onder **Noodrem** **Autonome antwoorden per uur per kanaal** en **Negatieve signalen per uur per kanaal** in en kies **Grenzen noodrem opslaan**. Een geactiveerd kanaal draait Geassisteerd tot iemand het hervat vanaf het kanaal of vanaf deze kaart.

Dagelijkse AI-afhandeling (workspace-standaard, uitzonderingen, waarborgen) staat onder [AI-afhandeling](/docs/inbox/inbox-ai).

## Ongedaan maken en audit

1. Onder **Ledger** toont **Versiegeschiedenis** geaccepteerde wijzigingen. **Ongedaan maken** is 30 dagen beschikbaar en past een compenserende wijziging toe; de oorspronkelijke ledgerregel blijft staan.
2. **Agenttoegang** is een overzicht van wat elke agent mag. Kies **Agent openen** om dat te wijzigen.
3. **Recente audit** is het eventlog. Rijen bieden **Gesprek openen**, **Run openen** of **Agent openen**.

## Wat nu

Lees [Autonomie](/docs/govern/autonomy) en open daarna [Agents](/docs/ai/agents) om te zien wie de regels erft.
