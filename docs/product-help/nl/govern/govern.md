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
*Kies Handmatig, Geassisteerd of Autonoom, en stel daarna categorieën bij.*

1. Open onder **Autonomie** het **Beleid**. De kaart heet **Workspace-plafond voor agents**.
2. Kies **Handmatig**, **Geassisteerd** of **Autonoom**. Zie [Autonomie](/docs/govern/autonomy). Dit plafond begrenst wat agents mogen doen; dagelijkse klantantwoorden staan onder [AI-afhandeling](/docs/inbox/inbox-ai).
3. Onder **Toestemmingsniveaus** zet je elke categorie op **Weigeren**, **Eerst vragen** of **Toestaan**. Overschrijf één tool wanneer de categorie te breed is.
4. Categorieën zijn onder meer Berichten, Workspace, Agents, Kanalen, Triggers, Integraties, Govern en Overdracht. Externe bezoekerssessies muteren nooit automatisch. Berichten op **Eerst vragen** of **Weigeren** begrenst ook AI-afhandeling op gesprekken.
5. Als learning veel geëscaleerde tool-gates of afgewezen toolbeslissingen ziet op een categorie die **Toestaan** stond, kan Bokito die slider automatisch aanscherpen naar **Eerst vragen**. Onder de sliders verschijnt een korte notitie. Losser maken blijft hier een handmatige edit.
6. Zet onder **Autonomie per actietag en flow** elke actieve actietag en flow op **Handmatig**, **Geassisteerd** of **Autonoom**.

Uitzonderingen per agent staan op de agentpagina onder Tools en toestemmingen.

## Stel regels voor alle agents in

1. Zoek onder **Autonomie** **Regels voor alle agents**. Elke agent volgt deze naast zijn eigen regels.
2. Voeg een regel toe zoals op een agent: de situatie, **Wat de agent doet** en de **Soort regel**. Kies **Regel toevoegen**.
3. Gebruik **Probeer uit** om een actie te controleren voordat je erop vertrouwt.
4. Voorgestelde regels (van een agent of van de knoppen **Volgende keer:** op een kaart) en voorgestelde routeringsregels (*Vragen over facturen naar Lisa*) komen als kaart om te bevestigen en worden vastgelegd onder **Ledger**.
5. **Per agent: altijd, vragen, nooit** toont de oordelen die op actiekaarten in gesprekken zijn gegeven, één agent en één actie per regel (**Altijd**, **Vragen** of **Nooit**). Het oordeel van een owner of admin geldt direct en staat hier meteen; dat van een member komt eerst als concept. Kies het prullenbak-icoon om een regel te verwijderen zodat de agent weer vraagt. Iedereen mag een **Altijd**-regel verwijderen; **Vragen** of **Nooit** verwijderen maakt de agent losser en vraagt een owner of admin.

Versturen naar klanten vraagt altijd. Zie [Agents](/docs/ai/agents) voor regels op één agent.

Autonome antwoorden pauzeren, de noodrem en actietags die altijd controle nodig hebben staan onder [AI-afhandeling](/docs/inbox/inbox-ai), niet op deze pagina.

## Ongedaan maken en audit

1. Onder **Ledger** toont **Versiegeschiedenis** geaccepteerde wijzigingen. **Ongedaan maken** is 30 dagen beschikbaar en past een compenserende wijziging toe; de oorspronkelijke ledgerregel blijft staan.
2. **Agenttoegang** is een overzicht van wat elke agent mag. Kies **Agent openen** om dat te wijzigen.
3. **Recente audit** is het eventlog. Rijen bieden **Gesprek openen**, **Run openen** of **Agent openen**.

## Wat nu

Lees [Autonomie](/docs/govern/autonomy) en open daarna [Agents](/docs/ai/agents) om te zien wie de regels erft.
