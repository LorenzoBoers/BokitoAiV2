---
title: Zo werken Werkmappen
intro: Een werkmap in Bokito is de plek waar al het werk over één onderwerp samenkomt en terechtkomt, zoals een klant, een project of een afdelingstaak.
description: Maak werkmappen, nest ze vrij, stel labelregels in voor lidmaatschap, berg gesprekken op en houd canvas, documenten en borden in de werkmap.
keywords: werkmappen, werkmap, labels, filterset, werkt in, algemeen, canvas, tickets, flows, borden, documentatie, communicatie, nesten
sort: 40
related: flows,categories,agenda,knowledge,communication
---

# Zo werken Werkmappen

Een werkmap heeft een **naam** en een plek in een vrije boom, en verzamelt het werk over één onderwerp: gesprekken, tickets, canvas, documenten en bestanden. Optionele **labels** bepalen welke gesprekken erin landen; nesten verandert alleen de boom, de labels blijven gelijk.

Een werkmap in Bokito is iets anders dan een Excel-werkmap.

## Maak of open een werkmap

![Lijst met werkmappen](/api/docs/assets/folders/project.png)
*Elke kaart is een werkmap met open werk.*

1. Open **Werkmappen**. Het linkermenu toont de boom. Kies **Nieuwe werkmap**, geef een naam en kies optioneel labels voor lidmaatschap.
2. Bevestig. De werkmap verschijnt in de boom op het hoogste niveau, of onder de werkmap die je koos. De kaart telt open en gesloten gesprekken in de werkmap en de werkmappen eronder, hetzelfde getal als in de Communicatie-zijbalk. Een werkmap zonder naam toont de labels die hem onderscheiden van de bovenliggende werkmap, of **Naamloze werkmap**.
3. Open een kaart. Je landt op **Overzicht**. Beheerders hoveren de naam: die wordt een pil met een pennetje, en een klik hernoemt de werkmap. Labels staan in één veld naast de naam; **+** voegt labels toe, het kruisje op een pil haalt die weg. Leden kunnen lezen, niet verwijderen.

## Nest een werkmap onder een andere

1. Sleep op **Werkmappen** een werkmap. Een lijn toont waar hij landt: omhoog of omlaag voor de plek, verder naar rechts om een niveau dieper te nesten, verder naar links om een niveau omhoog te gaan.
2. Laat los als hij op de goede plek zit. Labels veranderen niet, alleen de plek in de boom.
3. Gebruik **Ongedaan maken** op de melding, of Ctrl/Cmd+Z, om de laatste verplaatsing terug te draaien.

## Verplaats een werkmap naar het hoogste niveau

1. Sleep op **Werkmappen** een geneste werkmap verder naar links tot hij op het gewenste niveau staat. Ver genoeg naar links komt hij op het hoogste niveau.
2. De werkmap komt tussen de andere werkmappen op dat niveau. Labels blijven gelijk.
3. Gebruik **Ongedaan maken** op de melding, of Ctrl/Cmd+Z, als je het wilt terugdraaien.

## Verplaats één label tussen werkmappen

1. Hover op **Werkmappen** een label in een boomrij. Het krijgt een pil, zodat je ziet dat het los van de andere labels op die rij staat.
2. Sleep dat label naar een andere werkmap, of naar **Bovenste laag**. Het label verlaat de bronset en komt bij het doel.
3. Gebruik **Ongedaan maken** op de melding, of Ctrl/Cmd+Z, als je het wilt terugdraaien.

## Berg een gesprek op in een werkmap

1. Open het gesprek in [Communicatie](/docs/inbox/communication).
2. Kies **Opbergen in werkmap** (of **Sluiten en opbergen**) en kies de werkmap. Bokito zet de labels van die werkmap op het gesprek.
3. Het gesprek hoort daarna bij die werkmap, en bij elke andere werkmap waarvan het ook de labels draagt.

## Lees het Overzicht

1. De kop toont de naam en daarnaast het labelveld met de pillen. **Open in Communicatie** springt naar dezelfde werkmap in de Communicatie-rail.
2. Hover een boomrij voor de labels en **Onder:** de bovenliggende werkmap.
3. **Flows** toont elk bord waarvan een gesprek in deze werkmap (of een werkmap daarin) een ticket is: fasen als kolommen, tickets als kaarten. **Recente gesprekken** toont de passende gesprekken; **Alle gesprekken** opent het tabblad Gesprekken.

## Voeg een plek toe aan Werkt in

**Werkt in** staat bovenaan het **Overzicht** en toont elke plek waar werk uit deze werkmap terechtkomt: het bord en de bestanden (in Bokito, zodra er iets in staat), elk canvas (in Bokito) en koppelingen of bestandsmappen buiten Bokito.

1. Open de werkmap. Elke kaart toont de naam en of hij in **Bokito** zit of een **Koppeling** is; een klik opent hem.
2. Beheerders kiezen **Toevoegen aan Werkt in** en kiezen **Canvas**, **Koppeling** of **Bestandsmap**.
3. Geef een canvas een naam; kies bij een koppeling een van de actieve koppelingen; geef een bestandsmap een naam en de URL of map-ID. Kies **Toevoegen**.
4. Een koppeling of bestandsmap haal je weg met het prullenbakicoon op de kaart. Werk zonder werkmap komt in de werkmap **Algemeen**; de module Boekhouding maakt bij installatie de werkmap **Administratie** met de koppeling, of met een canvas **Cijfers** als er nog geen koppeling is.
5. Schrijft een agent via een koppeling, werkt hij een canvas bij, of rondt een codetool een pull request voor deze werkmap af, dan toont het gesprek **Opgeleverd in {werkmap} › {plek}**; een klik opent die plek. Een koppeling die in geen werkmap staat levert niets op en verschijnt als aandachtspunt.

## Zie gesprekken in een werkmap

1. Open het tabblad **Gesprekken**, of gebruik **Werkmappen** in Communicatie. Alle werkmappen staan in de rail, ook lege.
2. Elke rij hoort bij deze werkmap of een werkmap daarin, via labels of omdat het gesprek hier is opgeborgen.
3. Labels van het contact tellen automatisch mee (getoond als overgenomen); ze worden niet op het gesprek gekopieerd.

## Verplaats een ticket op een bord

![Flowborden in een werkmap](/api/docs/assets/folders/boards.png)
*Eén bord per flow in de werkmap, met de fasen van die flow als kolommen.*

1. Open de werkmap op **Overzicht**, of het tabblad **Tickets**.
2. Sleep een kaart naar een andere kolom om de fase te wijzigen. Klik een kaart om het gesprek in [Communicatie](/docs/inbox/communication) te openen.
3. De werkmap toont alleen flows met tickets die hier passen. Zie [Flows](/docs/ai/flows) en [Labels](/docs/ai/categories).

## Vraag een agent om een canvas

1. Open het tabblad **Canvas** en kies **Canvas toevoegen**. Kies de agent die het beheert.
2. Dat opent een gesprek: de agent vraagt wat je wilt zien, stelt een kort plan voor (titel, widgets, verversing), bouwt de snapshot en zet het verversingsritme. Blijf in dat gesprek praten om het te wijzigen.
3. De werkbalk van het canvas toont de beheeragent, wanneer het is bijgewerkt en de verversperiode. Gebruik het vernieuw-icoon, of verwijder via het **⋯**-menu. Elk canvas hoort bij een werkmap en staat ook onder **Werkt in**.

## Volg documentatie

1. Open het tabblad **Documentatie** voor documenten in deze werkmap. Maak of bewerk ze zoals in Kennis; agents wijzigen ze alleen binnen een [flow](/docs/ai/flows)-run.
2. Kies **Openen in Kennishub** om hetzelfde document daar te bewerken.

## Agenda en de rail

1. In Communicatie en Agenda **Wat** delen werkmappen één `#`-boom met dezelfde structuur als Werkmappen.
2. Tellers en filters volgen de werkmap die je kiest, met alle werkmappen daarin.
