---
title: Hoe Signalen werken
intro: Een signaal is getypte intake op een gesprek — één intentie, één signaal, daarna een werkstroom of project als je het koppelt.
description: Label werk dat in chat binnenkomt, koppel types aan werkstromen, bevestig een bezoeker wanneer dat nodig is, en houd meerdere signalen op één thread.
keywords: signalen, intake, case, werkstroom, binding, bevestigen, websitechat
sort: 46
related: workstreams,communication,widget,projects,integrations
---

# Hoe Signalen werken

Een signaal is een gelabeld stuk werk op een gesprek, niet het gesprek zelf. Open **Werkstromen** om types te beheren, koppel ze aan een werkstroom of project, en zie ze in het zijpaneel van een gesprek in [Berichten](/docs/inbox/communication).

## Voeg een intake-type toe

1. Open **Werkstromen**.
2. Typ onder **Intake-types** een naam (bijvoorbeeld Factuurvraag) en kies **Type toevoegen**.
3. Laat het type aan. Zet de schakelaar uit wanneer agents dat type niet meer mogen openen.
4. Koppel het daarna aan een werkstroom of project — een type zonder koppeling blijft op het gesprek.

## Koppel een type aan een werkstroom

1. Open een werkstroom en daarna de kaart **Over**.
2. Zet onder **Geaccepteerde intake-types** de types aan die dit proces mag ontvangen.
3. Zet bij een werkstroom **Start een run bij koppelen** aan wanneer een nieuw signaal een run moet starten. De run-input is het signaal, niet het gesprek.
4. Dezelfde lijst staat op de Orchestratie-kaart van een [project](/docs/ai/projects) wanneer het type op dat project moet landen.

## Open een signaal vanuit websitechat

1. Een bezoeker beschrijft een bug in de [websitewidget](/docs/inbox/widget). De agent opent het type **Bug report** met een zekerheidsscore.
2. Als het type de bezoeker vraagt, bevestigt de agent eerst. Als het het team vraagt, ziet de bezoeker een korte statusregel en krijg jij een beslissingskaart in Berichten.
3. Bij precies één koppeling met automatisch linken gaat het signaal naar die werkstroom. Bij meerdere koppelingen kies jij.

## Bevestig een bezoeker voor factuurgegevens

1. Zet op de module Boekhouding **Klantchat-tools** aan wanneer de widget de eigen facturen van die bezoeker mag opzoeken na een korte e-maillink.
2. Installeer het intake-type **Billing inquiry** vanuit de modulelijst **Intake-types** wanneer je dat type in de workspace wilt.
3. De agent zegt nooit of een account bestaat. De bezoeker krijgt een link, bevestigt, en het gesprek blijft open.

## Houd meerdere signalen op één gesprek

1. Open een gesprek in **Berichten**. Het zijpaneel toont **Signalen**.
2. Kies **Bug report toevoegen** of **Feature request toevoegen** wanneer er een tweede intentie in dezelfde chat verschijnt.
3. Elk signaal houdt een eigen status en werkstroomkoppeling. Stop twee issues niet in één signaal.

## Wat nu

Zet de schuif **Signalen** op [Govern](/docs/govern/govern) als agents geen intake meer mogen openen. Plan terugkerend werk op de [Agenda](/docs/ai/agenda).
