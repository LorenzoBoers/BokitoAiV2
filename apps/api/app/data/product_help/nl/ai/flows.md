---
title: Hoe Flows werken
intro: Een flow hoort bij precies één label. De lijst en pagina tonen een titel met dat label (`#klacht`) ernaast, en een live bord met de tickets, met een baan per werkmap. Het label is alleen gekleurd zolang de flow bestaat.
description: Maak een flow voor een label, volg de tickets per fase en per werkmap, bewerk of voeg fasen toe op het bord, en verwijder hem.
keywords: flows, workstreams, draaiboeken, levert op in, bestemming, fasen, eigenaar, check-up, pijplijn, tickets, hashtags, labels, werkmappen, bord, banen
sort: 45
related: categories,folders,agenda,agents,knowledge
---

# Hoe Flows werken

Een flow is de pijplijn voor werk dat onder één label terugkomt: een klacht, een reparatie, een aangifte. Elke flow heeft precies één label. De Flows-lijst en de flowpagina tonen een operator-titel met het workflow-icoon links en rechts het label (`#klacht`); het bord toont tickets per fase, en werkmappen tonen dezelfde fasen als bord.

## Een flow aanmaken

1. Open **Flows** (groep Werk) en kies **Nieuwe flow**. De dialoog toont eerst de bestaande flowlabels; die pillen zijn uitgeschakeld. Typ in het zoekveld om te versmallen tot tags die nog vrij zijn, of typ een nieuwe hashtag.
2. Kies een vrije tag, of **Tag aanmaken** als niets overeenkomt. Onderaan verschijnt een label-instelling: kies een kleur en een icoon. Een nieuw label start blauw met het flow-teken. **Aanmaken** koppelt die hashtag aan de flow; een bestaande vrije hashtag wordt hergebruikt. Een hashtag die al bij een andere flow hoort, blijft uitgeschakeld en kan geen tweede flow starten.
3. De lijst **Flows** toont per flow het pad-icoon, de titel en rechts het label, plus de fasen, open tickets per fase, werkmappen waarin hij gebruikt wordt en de laatste activiteit.

## Tickets volgen op het flowbord

![Flowbord met fasen als kolommen en een baan per werkmap](/api/docs/assets/flows/board.png)
*Fasen zijn de kolommen; elke werkmap die de flow gebruikt is een baan.*

1. Open een flow. Naast de titel staat het label. Beheerders klikken die pil om een kleur en een icoon te kiezen; de pil blijft een pil, met een gekleurd icoontegel links van de naam. Daaronder zie je tellers zoals **Open tickets** en **Langst stil**, en de werkmappen waarin de flow **Gebruikt in** is.
2. Het bord heeft een kolom per fase en een baan per werkmap, plus **Geen werkmap** voor tickets zonder werkmap. Klap een baan in via de kop, of kies **Werkmap openen** om naar die werkmap te gaan.
3. Een kaart toont de gesprekstitel, het contact, maximaal twee invoervelden, de volgende stap (bijvoorbeeld **Wacht op klant · 1 punt ontbreekt**), het kanaal, het tijdstip van het laatste bericht, de deadline (**Deadline over 3 dagen**, **2 dagen te laat**), de behandelaar en de volgende check-up. Klik op een kaart om het gesprek te openen.
4. Als fasen invoervelden hebben, kun je met **Filter** boven het bord tickets beperken op die waarden (keuzelijst kiest een optie; tekst en getal matchen wat op het ticket staat). **Filters wissen** toont het hele bord weer; kolomtellers volgen het filter.
5. Sleep een kaart naar een andere fase in dezelfde baan. De verplaatsing staat in de tijdlijn van het gesprek; de werkmap wijzig je alleen vanuit het gesprek. Als de doelfase verplichte velden heeft die nog leeg zijn, vraagt een dialoog ze eerst in te vullen en blijft de kaart staan tot ze er zijn.

## Fasen bewerken op het bord

1. Beheerders wijzigen de flownaam door op de titel te hoveren: die wordt een pil met een pennetje, en Enter slaat de naam op. De beschrijving staat eronder en slaat op als je het veld verlaat. De titel is alleen de flownaam; hernoem het label onder **Labels** als de hashtag zelf moet wijzigen.
2. Elke kolomkop toont de fasenaam met het aantal tickets ernaast. Hover over de kop en het tandwiel verschijnt naast de naam. Het opent een venster om de naam, het soort (niet gestart, wachtend, klaar, gesloten) en de invoervelden te wijzigen, of om de fase te verwijderen. Houd minstens één klaar-fase. **Naar links** en **Naar rechts** blijven alleen beschikbaar als de fase in zijn groep blijft. **Opslaan** schrijft die fase meteen weg.
3. Hover over de koppen en in elke tussenruimte verschijnt een plus. Eén klik voegt een fase in van hetzelfde soort als de kolom links, met die soortnaam tot je hem hernoemt. **Fase toevoegen** rechts voegt nog een fase toe van het soort van de laatste kolom. Niet gestart staat nooit na Wachtend, en Klaar nooit ervoor. Elke flow start met Niet gestart, Wachtend en Klaar, in de taal van de werkruimte.
4. In **Invoervelden** voeg je tekst-, lange-tekst-, getal- of keuzelijstvelden toe, en kies je **Eigenaar** en **Check-up**. Op een klaar-fase zet je **Gesprek automatisch sluiten** aan als binnenkomen in die fase de thread moet sluiten. Velden op de eerste fase worden gevraagd bij het vastleggen van het label. Verplichte velden op een latere fase moeten ingevuld zijn voordat een ticket die fase in kan. **Opslaan** in dat venster schrijft de fase meteen weg. Klaar-fasen checken nooit; een check-up verschijnt op [Agenda](/docs/ai/agenda) voor de eigenaar.

## Bepalen wie fasen verplaatst

Een agent die een gesprek leest, kan zeggen in welke fase een ticket hoort. De flow bepaalt of die wissel direct gebeurt of op een mens wacht.

1. Open de flow. Naast **Altijd controle** staat **Fasewissels door agents**. Eigenaren en beheerders kiezen een van vier opties.
2. **Standaard van de werkruimte** volgt de instelling onder [Labels](/docs/ai/categories). **Voorstellen, een mens bevestigt** zet een beslissingskaart in het gesprek; het ticket verplaatst als iemand **Naar** die fase kiest.
3. **Verplaatsen als zeker genoeg** verplaatst direct als de zekerheid van de agent minstens het getal bij **Zekerheid vanaf** is. Daaronder stelt hij voor.
4. **Mensen verplaatsen fases** weigert elke wissel door een agent; de agent zegt in het gesprek welke fase past.
5. Een mens die de kaart sleept of een fase kiest, beantwoordt het open voorstel. Bokito legt vast of de agent gelijk had, zodat volgende voorstellen beter worden.

## Een checklist aan een fase toevoegen

Een fase kan opsommen wat er moet zijn voordat het werk verder gaat, en zeggen op wie het wacht.

1. Open de fase met het tandwiel op de kolomkop. Kies onder **Wacht op** voor **Wacht op klant**, **Wacht op ons** of **Wacht op derde**. **Volgt beurt** kijkt wie het laatst schreef.
2. Kies onder **Checklist** voor **Punt toevoegen** en typ het punt, bijvoorbeeld **ID ontvangen**. Kies het bewijs (**Met de hand afvinken**, **Bijlage nodig**, **Antwoord nodig**) en zet **Verplicht** aan waar het af moet.
3. Zet **Verplichte punten voor de volgende fase** aan als een ticket pas naar een latere fase mag als elk verplicht punt is bevestigd. Terug kan altijd.
4. Op het ticket in het gesprek vinken mensen punten direct af. Een vinkje van een agent staat half gevuld met **Bevestigen**; het telt pas als een mens het bevestigt.

## Werkmappen en banen op het flowbord

1. Een werkmap wordt een baan op de flow wanneer de labels van die werkmap het actielabel van de flow bevatten. Op **Flows** toont elke rij die gedeelde werkmappen als chips; een chip opent die werkmap, de rest van de rij opent de flow.
2. Lege banen (werkmappen zonder tickets) blijven verborgen. Zet **Toon lege werkmappen** aan op de flowpagina om ze te zien.
3. Op een [werkmap](/docs/ai/folders) verschijnt een flow onder **Flows** zodra een gesprek in die werkmap (of een werkmap daarin) het label van de flow als ticket heeft.

## Antwoorden van een flow altijd laten controleren

Een flow kan een mens elk antwoord op zijn tickets laten bevestigen.

![Altijd controle op een flow](/api/docs/assets/flows/always-review.png)
*De schakelaar staat onder de flowtitel.*

1. Open de flow. Zet onder de titel **Altijd controle** aan. Alleen een eigenaar of beheerder kan dit wijzigen.
2. Elk antwoord op een ticket van deze flow wordt een concept dat een mens verstuurt, ook als het gesprek en de [Autonomie](/docs/govern/autonomy)-dial op Autonoom staan.
3. Ga met de muis over de modus in de gesprekskop: daar staat **Deze flow staat op Altijd controle, dus een mens verstuurt.**
4. Zet het uit wanneer autonome antwoorden voor deze tickets goed zijn.

## Kiezen waar een flow oplevert

Een flow kan de werkmap noemen, en eventueel de plek onder [Werkt in](/docs/ai/folders), waar afgeronde tickets landen, bijvoorbeeld **Levert op in Administratie › Exact**.

1. Open de flow. Onder de titel toont **Levert op in** de bestemming; eigenaren en beheerders kiezen **Bestemming kiezen** of **Wijzigen**.
2. Kies een werkmap, daarna **De werkmap zelf** of een van de plekken onder Werkt in, en kies **Opslaan**.
3. Bereikt een ticket van deze flow een fase van soort klaar, dan toont het gesprek **Opgeleverd in** die plek, tenzij het werk al in een werkmap was opgeleverd.
4. **Verwijderen** haalt de bestemming weg; tickets leveren dan alleen op waar hun agents schreven.

## Een flow verwijderen

1. Open het ···-menu rechtsboven en kies **Verwijderen**. Verwijderen zet de flow in de prullenbak.

## Wat daarna

Leg een label met een flow vast via **Hashtags toevoegen** op een gesprek in [Communicatie](/docs/inbox/communication); zie [Labels en tickets](/docs/ai/categories).
