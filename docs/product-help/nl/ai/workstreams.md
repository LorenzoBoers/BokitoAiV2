---
title: Hoe Flows werken
intro: Een flow is de fasenpijplijn van precies één actietag. De pagina heet naar die hashtag (`#klacht`) en toont een live bord met de tickets, met een baan per project.
description: Maak een flow voor een actietag, volg de tickets per fase en project, bewerk de fasen in de bewerkmodus, en deactiveer of verwijder hem.
keywords: flows, workstreams, draaiboeken, fasen, eigenaar, check-up, pijplijn, tickets, hashtags, actietags, projecten, bord, banen, bewerkmodus
sort: 45
related: categories,projects,agenda,agents,knowledge
---

# Hoe Flows werken

Een flow is de pijplijn voor werk dat onder één actietag terugkomt: een klacht, een reparatie, een aangifte. Elke flow heeft precies één actietag en heet naar die hashtag (`#klacht`); de flowpagina toont de tickets per fase, en projecten tonen dezelfde fasen als bord.

## Een flow aanmaken

1. Open **Flows** (groep Werk), typ een hashtag in **Hashtag voor nieuwe flow** en kies **Aanmaken**. Die hashtag wordt de actietag van de flow; een bestaande vrije hashtag wordt hergebruikt.
2. Een hashtag die al bij een andere flow hoort, kan geen tweede flow starten. Je kunt ook een actietag maken via **Hashtags toevoegen** op een gesprek of onder Instellingen; dat maakt de flow.
3. De lijst **Flows** toont per flow de fasen, het aantal open tickets per fase, de projecten waarin hij gebruikt wordt en de laatste activiteit.

## Tickets volgen op het flowbord

![Flowbord met fasen als kolommen en een baan per project](/api/docs/assets/workstreams/board.png)
*Fasen zijn de kolommen; elk project dat de flow gebruikt is een baan.*

1. Open een flow. Onder de titel zie je de **Actietag**, de projecten waarin hij **Gebruikt in** is, en tellers zoals **Open tickets** en **Langst stil**.
2. Het bord heeft een kolom per fase en een baan per project, plus **Geen project** voor tickets zonder project. Klap een baan in via de kop, of kies **Project openen** om naar dat project te gaan.
3. Een kaart toont de gesprekstitel, het contact, maximaal twee invoervelden, het kanaal, het tijdstip van het laatste bericht, de behandelaar en de volgende check-up. Klik op een kaart om het gesprek te openen.
4. Sleep een kaart naar een andere fase in dezelfde baan. De verplaatsing staat in de tijdlijn van het gesprek; het project wijzig je alleen vanuit het gesprek.

## De fasen bewerken in de bewerkmodus

1. Beheerders kiezen rechtsboven **Bewerken**. Het bord verdwijnt en de balk **Bewerkmodus** verschijnt; titel, beschrijving en fasen zijn dan bewerkbaar. Een andere titel hernoemt de actietag op elk gesprek; de balk toont de oude en nieuwe hashtag voordat je opslaat.
2. Kies in **Ticketfases** voor elke stap **Nieuwe fase toevoegen** (bijvoorbeeld Nieuw, Wacht op onderdelen, Gerepareerd). Zet elk **Soort fase** op open, waiting, done of closed, en houd minstens één klaar-fase. Sleep fasen om te herordenen.
3. Op een klaar-fase zet je **Gesprek automatisch sluiten** aan als binnenkomen in die fase de thread moet sluiten.
4. Open **Invoervelden** op een fase om tekst-, lange-tekst-, getal- of keuzelijstvelden toe te voegen. Velden op de eerste fase worden gevraagd bij het vastleggen van de actietag.
5. Kies per fase een **Eigenaar** (een persoon, agent of team, of **Huidige eigenaar houden**) en een **Check-up**-ritme. Tickets in die fase krijgen een check-up op [Agenda](/docs/ai/agenda) voor hun eigenaar; klaar-fasen checken nooit.
6. Er wordt niets opgeslagen tot je **Opslaan** kiest; intussen toont de balk **Niet-opgeslagen wijzigingen**. **Annuleren** vraagt of je wilt **Weggooien** en brengt je ongewijzigd terug naar het bord. Een hashtag die een andere tag al gebruikt, kun je niet opslaan.

## De flow op een project tonen

1. Projecten kiezen hun flows; de flowpagina toont alleen waar hij gebruikt wordt. Open het [project](/docs/ai/projects) en kies **Flow toevoegen**.
2. **Ontkoppelen** op een projectbord haalt de flow van dat project af. De tickets houden hun project, maar staan niet meer op dat bord.
3. Bij vastleggen van een ticket wordt gevraagd bij welk project van de flow het hoort, of **Geen project**.

## Een flow deactiveren of verwijderen

1. Kies rechtsboven **Deactiveren** om nieuw werk op de flow te stoppen. De status toont **Gedeactiveerd**.
2. Een gedeactiveerde flow toont **Activeren** en **Verwijderen**. Verwijderen zet hem in de prullenbak; zolang de flow actief is, kan dat niet.

## Wat daarna

Leg een actietag vast via **Hashtags toevoegen** op een gesprek in [Communicatie](/docs/inbox/communication); zie [Actietags en tickets](/docs/ai/categories).
