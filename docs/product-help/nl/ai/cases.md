---
title: Hoe Signalen werken
intro: Een signaal is getypte intake op een gesprek — één intentie, één signaal, daarna een werkstroom of project als je het koppelt.
description: Beheer intake-types en de signaalwachtrij op de pagina Signalen, koppel types aan werkstromen, bevestig een bezoeker wanneer dat nodig is, en houd meerdere signalen op één thread.
keywords: signalen, intake, case, wachtrij, werkstroom, binding, bevestigen, websitechat
sort: 46
related: workstreams,communication,widget,projects,integrations
---

# Hoe Signalen werken

Een signaal is een gelabeld stuk werk op een gesprek, niet het gesprek zelf. De pagina **Signalen** in de zijbalk (onder Besturing) bevat de wachtrij met open signalen en de catalogus met intake-types. Signalen vervangen de oude gesprekkentags: agents classificeren binnenkomende berichten tegen je typecatalogus en openen een signaal in plaats van een tag.

Elk type heeft een **opvolging**-modus: **Alleen label** stempelt het gesprek en komt nooit in de wachtrij (Spam of misbruik gebruikt dit standaard), **Volgen in wachtrij** opent een wachtrij-item zonder verplichte route, en **Routeren naar werk** verwacht een koppeling naar werkstroom of project.

## Werk de signaalwachtrij weg

1. Open **Signalen**. Het tabblad **Wachtrij** toont opvolg-signalen met type, titel, gespreksonderwerp, leeftijd en status. Alleen-label stempels blijven op het gesprek en buiten deze lijst.
2. Gebruik de statuspillen — **Voor jou**, **Open**, **Wachtend**, **Gekoppeld** en **Klaar** — om te beginnen bij wat een beslissing nodig heeft. Het zoekveld zoekt op titel, samenvatting en typenaam; type-chips filteren op één intake-type.
3. Klik op een rij voor het detailpaneel: wijzig de status, pas titel of samenvatting aan, of koppel het signaal aan een werkstroom of project.
4. Kies **Gesprek openen** om naar het gesprek in [Communicatie](/docs/inbox/communication) te springen. Een signaal sluiten sluit nooit het gesprek — ze staan los van elkaar.
5. Beweeg door de rijen met **J**/**K** en open er een met **Enter**.

## Voeg een intake-type toe

1. Open **Signalen** en daarna het tabblad **Types**.
2. Kies **Nieuw type**, geef het een naam (bijvoorbeeld Factuurvraag), en kies **Opvolging**: Alleen label, Volgen in wachtrij of Routeren naar werk.
3. Omschrijf precies wanneer het type van toepassing is — agents volgen die omschrijving bij het classificeren van binnenkomende berichten, dus benoem ook wanneer het niet geldt.
4. Laat het type aan. Zet de schakelaar uit wanneer agents dat type niet meer mogen openen.
5. Koppel Route-types daarna aan een werkstroom of project. Een type verwijderen dat al signalen heeft archiveert het (uitzetten en open wachtrij-rijen sluiten) in plaats van geschiedenis te breken.

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

1. Open een gesprek in **Berichten**. Het zijpaneel toont **Signalen**. Alleen-label types tonen een **Label**-chip; actieve wachtrij-signalen houden hun statusbadge.
2. Kies **Bug report toevoegen** of **Feature request toevoegen** wanneer er een tweede intentie in dezelfde chat verschijnt.
3. Elk signaal houdt een eigen status en werkstroomkoppeling. Stop twee issues niet in één signaal.

## Wat nu

Zet de schuif **Signalen** op [Govern](/docs/govern/govern) als agents geen intake meer mogen openen. Plan terugkerend werk op de [Agenda](/docs/ai/agenda).
