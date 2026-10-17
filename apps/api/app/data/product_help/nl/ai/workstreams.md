---
title: Hoe Flows werken
intro: Een flow hoort bij precies één label. De lijst en pagina tonen een titel met dat label (`#klacht`) ernaast, en een live bord met de tickets, met een baan per project. Het label is alleen gekleurd zolang de flow bestaat.
description: Maak een flow voor een label, volg de tickets per fase en project, bewerk of voeg fasen toe op het bord, en deactiveer of verwijder hem.
keywords: flows, workstreams, draaiboeken, fasen, eigenaar, check-up, pijplijn, tickets, hashtags, labels, projecten, bord, banen
sort: 45
related: categories,folders,agenda,agents,knowledge
---

# Hoe Flows werken

Een flow is de pijplijn voor werk dat onder één label terugkomt: een klacht, een reparatie, een aangifte. Elke flow heeft precies één label. De Flows-lijst en de flowpagina tonen een operator-titel met het workflow-icoon links en rechts het label (`#klacht`); het bord toont tickets per fase, en projecten tonen dezelfde fasen als bord.

## Een flow aanmaken

1. Open **Flows** (groep Werk) en kies **Nieuwe flow**. De dialoog toont eerst de bestaande flowlabels; die pillen zijn uitgeschakeld. Typ in het zoekveld om te versmallen tot tags die nog vrij zijn, of typ een nieuwe hashtag.
2. Kies een vrije tag, of **Tag aanmaken** als niets overeenkomt. Onderaan verschijnt een label-instelling: kies een kleur en een icoon. Een nieuw label start blauw met het flow-teken. **Aanmaken** koppelt die hashtag aan de flow; een bestaande vrije hashtag wordt hergebruikt. Een hashtag die al bij een andere flow hoort, blijft uitgeschakeld en kan geen tweede flow starten.
3. De lijst **Flows** toont per flow het pad-icoon, de titel en rechts het label, plus de fasen, open tickets per fase, projecten waarin hij gebruikt wordt en de laatste activiteit.

## Tickets volgen op het flowbord

![Flowbord met fasen als kolommen en een baan per project](/api/docs/assets/workstreams/board.png)
*Fasen zijn de kolommen; elk project dat de flow gebruikt is een baan.*

1. Open een flow. Naast de titel staat het label. Beheerders klikken die pil om een kleur en een icoon te kiezen; de pil blijft een pil, met een gekleurd icoontegel links van de naam. Daaronder zie je tellers zoals **Open tickets** en **Langst stil**, en de projecten waarin de flow **Gebruikt in** is.
2. Het bord heeft een kolom per fase en een baan per project, plus **Geen project** voor tickets zonder project. Klap een baan in via de kop, of kies **Project openen** om naar dat project te gaan.
3. Een kaart toont de gesprekstitel, het contact, maximaal twee invoervelden, het kanaal, het tijdstip van het laatste bericht, de behandelaar en de volgende check-up. Klik op een kaart om het gesprek te openen.
4. Sleep een kaart naar een andere fase in dezelfde baan. De verplaatsing staat in de tijdlijn van het gesprek; het project wijzig je alleen vanuit het gesprek. Als de doelfase verplichte velden heeft die nog leeg zijn, vraagt een dialoog ze eerst in te vullen en blijft de kaart staan tot ze er zijn.

## Fasen bewerken op het bord

1. Beheerders wijzigen de flownaam door op de titel te hoveren: die wordt een pil met een pennetje, en Enter slaat de naam op. De beschrijving staat eronder en slaat op als je het veld verlaat. De titel is alleen de flownaam; hernoem het label onder **Labels** als de hashtag zelf moet wijzigen.
2. Elke kolomkop toont de fasenaam met het aantal tickets ernaast. Hover over de kop en het tandwiel verschijnt naast de naam. Het opent een venster om de naam, het soort (niet gestart, actief, klaar, gesloten) en de invoervelden te wijzigen, of om de fase te verwijderen. Houd minstens één klaar-fase. **Naar links** en **Naar rechts** blijven alleen beschikbaar als de fase in zijn groep blijft. **Opslaan** schrijft die fase meteen weg.
3. Hover over de koppen en in elke tussenruimte verschijnt een plus. Eén klik voegt een fase in van hetzelfde soort als de kolom links, met die soortnaam tot je hem hernoemt. **Fase toevoegen** rechts voegt nog een fase toe van het soort van de laatste kolom. Niet gestart staat nooit na Actief, en Klaar nooit ervoor. Elke flow start met Niet gestart, Actief en Klaar.
4. In **Invoervelden** voeg je tekst-, lange-tekst-, getal- of keuzelijstvelden toe, en kies je **Eigenaar** en **Check-up**. Op een klaar-fase zet je **Gesprek automatisch sluiten** aan als binnenkomen in die fase de thread moet sluiten. Velden op de eerste fase worden gevraagd bij het vastleggen van het label. Verplichte velden op een latere fase moeten ingevuld zijn voordat een ticket die fase in kan. **Opslaan** in dat venster schrijft de fase meteen weg. Klaar-fasen checken nooit; een check-up verschijnt op [Agenda](/docs/ai/agenda) voor de eigenaar.

## De flow op een project tonen

1. Projecten kiezen hun flows. Open het [project](/docs/ai/folders) en kies **Flow toevoegen**. Op **Flows** toont elke rij de projecten waarop hij gebruikt wordt als mapchips; een chip opent dat project, de rest van de rij opent de flow.
2. **Ontkoppelen** op een projectbord haalt de flow van dat project af. De tickets houden hun project, maar staan niet meer op dat bord.
3. Bij vastleggen van een ticket wordt gevraagd bij welk project van de flow het hoort, of **Geen project**.

## Een flow deactiveren of verwijderen

1. Kies rechtsboven **Deactiveren** om nieuw werk op de flow te stoppen. De status toont **Gedeactiveerd**.
2. Een gedeactiveerde flow toont **Activeren** en **Verwijderen**. Verwijderen zet hem in de prullenbak; zolang de flow actief is, kan dat niet.

## Wat daarna

Leg een label met een flow vast via **Hashtags toevoegen** op een gesprek in [Communicatie](/docs/inbox/communication); zie [Labels en tickets](/docs/ai/categories).
