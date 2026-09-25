---
title: Hoe Signalen werken
intro: Een signaal is getypte intake op een gesprek — één intentie, één signaal, daarna een werkstroom of project als je het koppelt.
description: Beheer signaaltypes in Instellingen, koppel types aan werkstromen, bevestig een bezoeker wanneer dat nodig is, en houd meerdere signalen op één gesprek.
keywords: signalen, intake, case, gesprek, werkstroom, binding, bevestigen, websitechat
sort: 46
related: workstreams,communication,widget,projects,integrations
---

# Hoe Signalen werken

Een signaal is getypte herkenning op een gesprek, geen apart inboxitem. Signalen blijven op het gesprek waaruit ze komen; beheer de typecatalogus onder **Instellingen** → **Signaaltypes**. Elk binnenkomend bericht wordt tegen deze catalogus gelezen voordat er een antwoord wordt opgesteld, dus herkenning gebeurt ook wanneer AI-antwoorden gepauzeerd zijn.

Elk type heeft een **Uitkomst**: **Alleen label** legt de herkenning vast, **Volgen** houdt die zichtbaar op het gesprek, en **Draaiboek uitvoeren** routeert naar een gekoppelde werkstroom. Een zekere lezing legt het signaal direct vast; een onzekere lezing wordt een bevestigingschip op het gesprek, en een bericht dat bij geen enkel type past wordt geteld onder **Wat we misten** in plaats van dat er een type wordt verzonnen.

## Voeg een intake-type toe

1. Open **Instellingen** en daarna **Signaaltypes**.
2. Kies **Nieuw type**, geef het een naam (bijvoorbeeld Factuurvraag), en kies **Uitkomst**: Alleen label, Volgen of Draaiboek uitvoeren.
3. Omschrijf precies wanneer het type van toepassing is — agents volgen die omschrijving bij het classificeren van binnenkomende berichten, dus benoem ook wanneer het niet geldt.
4. Laat het type aan. Zet de schakelaar uit wanneer agents dat type niet meer mogen openen.
5. Kies voor draaiboektypes de werkstroom die moet draaien, en kies een **Project** wanneer elk signaal van dit type bij hetzelfde project hoort. Een type verwijderen dat al signalen heeft archiveert het in plaats van gespreksgeschiedenis te breken.

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

## Bevestig of voeg signalen toe op een gesprek

1. Open een gesprek in **Communicatie**. Bekijk onder **Dit gesprek** de signalen die het systeem vond.
2. Een onzekere lezing leest als "Dit lijkt op Factuurvraag — bevestigen?". Kies **Bevestigen** om er werk van te maken, of **Afwijzen** wanneer de lezing fout was. Er routeert niets en er start geen draaiboek voordat je bevestigt.
3. Kies **Voeg toe wat we misten** wanneer er een tweede intentie in hetzelfde gesprek verschijnt.
4. Elk signaal houdt een eigen status en draaiboek- of projectkoppeling. Houd verschillende intenties als verschillende signalen.

## Maak van een gemist patroon een type

1. Open **Instellingen**, daarna **Signaaltypes**, en lees de kaart **Wat we misten**. Die toont verzoeken die bleven binnenkomen zonder passend type, met hoe vaak elk is gezien.
2. Zet **Stel een nieuw type voor na** op het aantal keren dat je wilt zien voordat een patroon klaarstaat.
3. Kies **Maak er een type van** om het aan te maken met de voorgestelde naam en omschrijving, en stel daarna de uitkomst in. Kies **Geen type** om het te laten vallen. Agents maken nooit zelf een type aan.
4. Bepaal met **Een signaal accepteren** op dezelfde pagina wie een voorgesteld signaal mag bevestigen: alleen owners en admins, of iedereen in de workspace. Leden kunnen altijd zelf een signaal toevoegen.

## Wat nu

Zet de schuif **Signalen** op [Govern](/docs/govern/govern) als agents geen intake meer mogen openen. Plan terugkerend werk op de [Agenda](/docs/ai/agenda).
