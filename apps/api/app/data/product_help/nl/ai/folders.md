---
title: Zo werken Mappen
intro: Een map is een benoemde plek in je boom met optionele labelregels — passende gesprekken landen hier, met canvas, docs en borden op dezelfde hub.
description: Maak benoemde mappen, nest ze vrij, stel labelregels in voor lidmaatschap, archiveer gesprekken en houd canvas en docs op de maphub.
keywords: mappen, folders, labels, tags, filterset, canvas, tickets, flows, borden, documentatie, communicatie, nesten
sort: 40
related: workstreams,categories,agenda,knowledge,communication
---

# Zo werken Mappen

Een map heeft een **naam** en een plek in een vrije boom. Optionele **labels** bepalen welke gesprekken matchen: één van die labels op het gesprek is genoeg. Nesten verandert alleen de boom — labels blijven gelijk. Open **Mappen** voor de hub: gesprekken, tickets, canvas, docs en bestanden. Er is geen map-agent, budget of repository.

## Maak of open een map

![Projectenlijst](/api/docs/assets/folders/project.png)
*Elke kaart is een map met open werk.*

1. Open **Mappen**. Het linkermenu toont de boom. Kies **Nieuwe map**, geef een naam en kies optioneel labels voor lidmaatschap.
2. Bevestig. De map verschijnt in de boom op het hoogste niveau (of onder een ouder als je die koos).
3. Open een kaart. Je landt op **Overzicht**. Beheerders hoveren de mapnaam: die wordt een pil met een pennetje, en een klik hernoemt de map. Labels staan in één veld naast de naam; **+** voegt labels toe, de kruisjes op een pil halen die weg. Leden kunnen lezen; ze kunnen niet verwijderen.

## Nest een map onder een andere

1. Op **Mappen** sleep je een map. De lijst blijft staan. Een lijn toont waar ze landt: omhoog of omlaag voor de plek, verder naar rechts om één niveau dieper te nesten, verder naar links om een niveau omhoog te gaan. Loslaten verplaatst de map. **Nieuwe map** (de plus naast zoeken) maakt een map op het hoogste niveau.
2. Laat los als hij op de goede plek zit. Labels veranderen niet — alleen de plek in de boom.
3. Gebruik **Ongedaan maken** op de toast, of Ctrl/Cmd+Z, om de laatste nest, herschikking of unnest terug te draaien.

## Verplaats een map naar het hoogste niveau

1. Op **Mappen** sleep je een geneste map verder naar links tot ze op het gewenste niveau staat. Ver genoeg naar links wordt ze een map op het hoogste niveau.
2. De map komt tussen de andere wortelmapen. Labels blijven gelijk.
3. Gebruik **Ongedaan maken** op de toast, of Ctrl/Cmd+Z, als je het wilt terugdraaien.

## Verplaats één label tussen mappen

1. Op **Mappen** hover je een label in een boomrij — het krijgt een pill zodat je ziet dat het los van de andere labels op die rij staat.
2. Sleep dat label naar een andere map, of naar **Bovenste laag**. Het label verlaat de bronset en komt bij het doel.
3. Gebruik **Ongedaan maken** op de toast, of Ctrl/Cmd+Z, als je het wilt terugdraaien.

## Archiveer een gesprek in een map

1. Open het gesprek in [Communicatie](/docs/inbox/communication).
2. Gebruik **In map archiveren** (of sluiten-en-archiveren) en kies de map. Bokito zet de labels van die map op de thread.
3. Het gesprek matcht daarna die map (en elke andere map waarvan het ook de labels draagt).

## Lees het Overzicht

1. De kop toont de mapnaam en daarnaast het labelveld met de pills. **Open in Communicatie** springt naar dezelfde scope in de Communicatie-rail.
2. Hover een boomrij voor de labels en **Onder:** de oudermap wanneer genest.
3. **Flows** toont automatisch elk bord waarvan een gesprek in deze map (of een map eronder) een ticket is — fasen als kolommen, tickets als kaarten. Sleep een kaart om de fase te wijzigen, of open het tabblad **Tickets** voor hetzelfde bord. **Recente gesprekken** toont de matches; **Alle gesprekken** opent het tabblad Gesprekken. Wat een agent deed, staat in dat gesprek. Canvas, docs en bestanden blijven op deze hub.

## Zie gesprekken in een map

1. Open het tabblad **Gesprekken**, of gebruik **Mappen** in Communicatie. Alle mappen staan in de rail, ook lege.
2. Elke rij matcht deze map of een map eronder (via labels of via de gearchiveerde thuismap). Archiveren in een map voegt die labels toe.
3. Contactlabels gelden automatisch (getoond als overgenomen); ze worden niet op de thread gekopieerd.

## Verplaats een ticket op een bord

![Flow-borden op een project](/api/docs/assets/folders/boards.png)
*Eén bord per flow op de map, met de stages van die flow als kolommen.*

1. Open de map op **Overzicht**, of het tabblad **Tickets**.
2. Sleep een kaart naar een andere kolom om de fase te wijzigen. Klik een kaart om hem in [Communicatie](/docs/inbox/communication) te openen.
3. Flows blijven het label-as; de map toont alleen flows met tickets die hier matchen. Zie [Flows](/docs/ai/workstreams) en [Labels](/docs/ai/categories).

## Vraag een agent om een canvas

1. Open het tabblad **Canvas** en kies **Canvas toevoegen**. Kies de agent die het beheert.
2. Dat opent een gesprek: de agent vraagt wat je wilt zien, stelt een kort plan voor (titel, widgets, verversing), bouwt daarna de snapshot en zet het verversingsritme. Blijf in die thread praten om het te wijzigen. Op de canvas-werkbalk staan beheeragent (avatar en naam), bijgewerkt en verversperiode op één regel; gebruik het vernieuw-icoon, of verwijder via het **⋯**-menu. Workspace-canvassen staan ook op Overzicht **Canvas**.

## Volg documentatie

1. Open het tabblad **Documentatie** voor docs bij deze map. Maak of bewerk zoals bij Knowledge; agents wijzigen projectdocs alleen binnen een [flow](/docs/ai/workstreams)-run.
2. Kies **Open in Knowledge-hub** om hetzelfde document onder Knowledge te bewerken.

## Agenda en de rail

1. In Communicatie en Agenda **Wat** delen mappen één `#`-boom met dezelfde structuur als Mappen.
2. Tellers en filters volgen de map-subtree die je selecteert.
