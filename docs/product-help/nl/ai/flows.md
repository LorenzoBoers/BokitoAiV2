---
title: Zo werkt Werk
intro: Een werk hoort bij precies één label. De lijst en pagina tonen een titel met dat label (`klacht`) ernaast, en een live bord met de tickets, met een baan per map. Het label is alleen gekleurd zolang het werk bestaat.
description: Maak een werk voor een label, volg de tickets per fase en per map, bewerk of voeg fasen toe op het bord, en verwijder hem.
keywords: werk, workstreams, draaiboeken, fasen, eigenaar, check-up, pijplijn, tickets, labels, labels, mappen, bord, banen
sort: 45
related: categories,folders,agenda,agents,knowledge
---

# Zo werkt Werk

Een werk is de pijplijn voor werk dat onder één label terugkomt: een klacht, een reparatie, een aangifte. Elk werk heeft precies één label. De lijst Werk en de werkpagina tonen een operator-titel met het workflow-icoon links en rechts het label (`klacht`); het bord toont tickets per fase, en mappen tonen dezelfde fasen als bord.

## Een werk aanmaken

1. Open **Werk** (groep Werk) en kies **Nieuw werk**. De dialoog toont eerst de bestaande werklabels; die pillen zijn uitgeschakeld. Typ in het zoekveld om te versmallen tot tags die nog vrij zijn, of typ een nieuwe label.
2. Kies een vrije tag, of **Tag aanmaken** als niets overeenkomt. Onderaan verschijnt een label-instelling: kies een kleur en een icoon. De iconenlijst is lang en scrollbaar (eerst populair, daarna de hele Lucide-set); typ om te filteren op naam of Nederlandse/Engelse trefwoorden. Een nieuw label start blauw met het werk-teken. **Aanmaken** koppelt dat label aan het werk; een bestaand vrij label wordt hergebruikt. Een label dat al bij een ander werk hoort, blijft uitgeschakeld en kan geen tweede werk starten.
3. De lijst **Werk** toont per werk het pad-icoon, de titel en rechts het label, plus de fasen, open tickets per fase, mappen waarin hij gebruikt wordt en de laatste activiteit.

## Tickets volgen op het werkbord

![Werkbord met fasen als kolommen en een baan per map](/api/docs/assets/flows/board.png)
*Fasen zijn de kolommen; elke map die het werk gebruikt is een baan.*

1. Open een werk. Naast de titel staat het label. Beheerders klikken die pil om een kleur en een icoon te kiezen; de pil blijft een pil, met een gekleurd icoontegel links van de naam. Daaronder zie je tellers zoals **Open tickets** en **Langst stil**, en de mappen waarin het werk **Gebruikt in** is.
2. Het bord heeft een kolom per fase en een baan per map, plus **Geen map** voor tickets zonder map. Klap een baan in via de kop, of kies **Map openen** om naar die map te gaan.
3. Een kaart toont de gesprekstitel, het contact, maximaal twee invoervelden, de volgende stap (bijvoorbeeld **Wacht op klant · 1 punt ontbreekt**), het kanaal, het tijdstip van het laatste bericht, de deadline (**Deadline over 3 dagen**, **2 dagen te laat**), de behandelaar en de volgende check-up. Klik op een kaart om het gesprek te openen.
4. Als fasen invoervelden hebben, kun je met **Filter** boven het bord tickets beperken op die waarden (keuzelijst kiest een optie; tekst en getal matchen wat op het ticket staat). **Filters wissen** toont het hele bord weer; kolomtellers volgen het filter.
5. Sleep een kaart naar een andere fase in dezelfde baan. De verplaatsing staat in de tijdlijn van het gesprek; de map wijzig je alleen vanuit het gesprek. Als de doelfase verplichte velden heeft die nog leeg zijn, vraagt een dialoog ze eerst in te vullen en blijft de kaart staan tot ze er zijn.

## Fasen bewerken op het bord

1. Beheerders wijzigen de werknaam door op de titel te hoveren: die wordt een pil met een pennetje, en Enter slaat de naam op. De beschrijving staat eronder en slaat op als je het veld verlaat. De titel is alleen de werknaam; hernoem het label onder **Labels** als het label zelf moet wijzigen.
2. Elke kolomkop toont de fasenaam met het aantal tickets ernaast. Hover over de kop en het tandwiel verschijnt naast de naam. Het opent een venster om de naam, het soort (niet gestart, wachtend, klaar, gesloten) en de invoervelden te wijzigen, of om de fase te verwijderen. Houd minstens één klaar-fase. **Naar links** en **Naar rechts** blijven alleen beschikbaar als de fase in zijn groep blijft. **Opslaan** schrijft die fase meteen weg.
3. Hover over de koppen en in elke tussenruimte verschijnt een plus. Eén klik voegt een fase in van hetzelfde soort als de kolom links, met die soortnaam tot je hem hernoemt. **Fase toevoegen** rechts voegt nog een fase toe van het soort van de laatste kolom. Niet gestart staat nooit na Wachtend, en Klaar nooit ervoor. Elk werk start met Niet gestart, Wachtend en Klaar, in de taal van de werkruimte.
4. In **Invoervelden** voeg je tekst-, lange-tekst-, getal- of keuzelijstvelden toe, en kies je **Eigenaar** en **Check-up**. Op een klaar-fase zet je **Gesprek automatisch sluiten** aan als binnenkomen in die fase de thread moet sluiten. Velden op de eerste fase worden gevraagd bij het vastleggen van het label. Verplichte velden op een latere fase moeten ingevuld zijn voordat een ticket die fase in kan. **Opslaan** in dat venster schrijft de fase meteen weg. Klaar-fasen checken nooit; een check-up verschijnt op [Agenda](/docs/ai/agenda) voor de eigenaar.

## Bepalen wie fasen verplaatst

Een agent die een gesprek leest, kan zeggen in welke fase een ticket hoort. Het werk bepaalt of die wissel direct gebeurt of op een mens wacht.

1. Open het werk. Naast **Autonomie** staat **Fasewissels door agents**. Eigenaren en beheerders kiezen een van vier opties.
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

## Mappen en banen op het werkbord

1. Een map wordt een baan op het werk wanneer de labels van die map het actielabel van het werk bevatten. Op **Werk** toont elke rij die gedeelde mappen als chips; een chip opent die map, de rest van de rij opent het werk.
2. Lege banen (mappen zonder tickets) blijven verborgen. Zet **Toon lege mappen** aan op de werkpagina om ze te zien.
3. Op het maptabblad van de [afdeling](/docs/getting-started/team) verschijnt een werk als bord zodra een gesprek in die map (of een map daarin) het label van het werk als ticket heeft.

## De flow van start tot eind tekenen

De stappen en de pijlen ertussen staan in één editor. Een pijl zegt wanneer hij geldt en wat hij meeneemt.

1. Open het werk en kies **Bewerken** rechtsboven, naast **Open in Grid**.
2. Het diagram houdt altijd de hele flow in beeld, ook nadat je een stap toevoegt of verplaatst. Elke fase toont het voortgangsicoon en het aantal tickets, net als op het bord.
3. Klik een stap om rechts wie, stand, max, tools, krijgt, geeft, faalt en stil in te stellen. Klik een pijl om in te stellen wanneer hij geldt en wat hij meeneemt, of richt hem op een andere stap. Rechtsklik op een stap, een pijl of de achtergrond voor een menu met **Nieuwe stap hierna**, **Pijl naar**, wie en stand, **Richting omdraaien**, **Nieuwe stap hier** en **Verwijderen**.
4. Sleep vanaf de stip rechts op een stap naar een andere stap voor een nieuwe pijl. Laat je los op een lege plek, dan komt daar een nieuwe stap met die pijl. **Stap** en **Pijl toevoegen naar** in het paneel doen hetzelfde zonder slepen. Een losse stap sleep je naar een andere kolom, boven of onder een stap; **Automatisch plaatsen** zet hem terug. **Notatie** toont dezelfde flow als tekst en controleert die terwijl je typt.
5. **Opslaan** bewaart de notatie op het werk. Het bord houdt de kolommen tot de overgangen daarop worden toegepast.

## Beschrijven hoe het werk zijn werk afhandelt

Een werk is ook de aanpak voor één soort werk: het label zegt wat het is, het werk zegt hoe de agent werkt en wat klaar oplevert.

1. Open het werk en kies het tandwiel rechtsboven. Schrijf bij **Klaar betekent** in een zin wat klaar oplevert, bijvoorbeeld **De posts van de maand staan ingepland**.
2. Schrijf bij **Werkwijze** in een paar zinnen hoe de agent dit werk afhandelt. Het slaat op als je het veld verlaat. Agents op de gesprekken van dit werk krijgen de werkwijze, de tools en koppelingen die hij gebruikt (**Gebruikt**) en wat klaar betekent.
3. Een werk zonder wachtfase heeft geen bord in mappen. De fases zelf bepalen of er een wachtstap is.
4. Een agent kan dezelfde wijzigingen in een gesprek voorstellen met `update_flow`; het voorstel volgt [Govern](/docs/govern/govern).

## Autonomie en afdeling van een werk instellen

Elk werk heeft een eigen knop onder het plafond van de workspace. De afdeling staat op het label van het werk.

1. Open het werk en kies het tandwiel rechtsboven. **Autonomie** toont **Standaard van de workspace**, **Handmatig**, **Geassisteerd** of **Autonoom**. Eigenaren en beheerders kiezen er een.
2. Strenger dan de workspace geldt meteen. Losser wacht op akkoord in [Govern](/docs/govern/autonomy); het venster zegt **Losser dan nu gaat via Govern**. Op **Geassisteerd** wordt elk antwoord op een ticket van dit werk een concept dat een mens verstuurt, ook als het gesprek op Autonoom staat. De modus in de gesprekskop zegt dan dat hij op het werk is ingesteld.
3. Kies bij **Afdeling** de afdeling van het label. De leidende agent neemt de tickets van het werk mee in de ochtendbriefing, en de [afdelingspagina](/docs/getting-started/team) toont het werk met zijn scorekaart.
4. Laat de scorekaart van een werk genoeg schone uitkomsten zien, dan stelt de afdelingsleider in het afdelingsgesprek een lossere stand voor (zie het volgende deel).

## De afdelingsleider een werk laten verbeteren

Eens per dag leest de leidende agent van een afdeling de scorekaarten van zijn werk en stelt verbeteringen voor in het afdelingsgesprek.

1. Open de afdeling in het menu links. Onder **Verbetervoorstellen** toont elk open voorstel wat het wijzigt: **Autonomie**, **Instructies**, **Capabilities** of **Nieuw werk**. Kies **Openen** om naar het afdelingsgesprek te gaan.
2. **Autonomie:** na genoeg tickets zonder correctie of afgewezen beslissing stelt de leider **Autonoom** voor; hebben veel tickets een correctie nodig, dan stelt die een stap terug naar **Geassisteerd** voor. Het aantal schone tickets is een werkruimte-instelling (standaard 20).
3. **Instructies:** corrigeert het team drie of meer concepten op het label van het werk, dan stelt de leider voor om toe te voegen hoe het team die antwoorden schreef aan de **Werkwijze**.
4. **Capabilities:** wijst het team dezelfde tool drie of meer keer af op tickets van het werk, dan stelt de leider voor om die uit **Gebruikt** te halen, of een regel toe te voegen dat de agent eerst vraagt.
5. **Nieuw werk:** komt hetzelfde soort werk steeds binnen zonder passend label, dan stelt de leider van de afdeling die het zag een werk met een nieuw label voor die afdeling voor.
6. Keur de kaart goed of wijs hem af in het gesprek. Er verandert niets voordat iemand goedkeurt. Hetzelfde voorstel komt 30 dagen niet terug, en hoe vaak de voorstellen van een leider worden goedgekeurd telt mee op de scorekaart van die agent.

## Elke periode een ticket openen

Werk dat terugkomt, zoals maandcontent of een weekrapport, opent zichzelf als ticket op het werk.

1. Vraag het een agent in een gesprek, bijvoorbeeld: **Open elke eerste van de maand een maandcontent-ticket in map Klanten/Studio Veluwe.**
2. De agent zet een regel met het werklabel, de map, de titel (bijvoorbeeld **Maandcontent {maand}**) en het schema. Een regel per werk en map: opnieuw vragen past hem aan.
3. Op die datum opent Bokito een gesprek, legt het vast op het werk in die map en geeft het aan de agent. Heeft de regel instructies, dan begint de agent meteen.
4. De regel staat in de [Agenda](/docs/ai/agenda) onder routines. Pauzeer of verwijder hem daar.

## Akkoord van de klant in een fase

Een fase die op de klant wacht, gaat verder op het antwoord van de klant.

1. Geef de akkoordfase **Wacht op klant** (zie de checklist hierboven).
2. De agent stuurt het werk als concept naar de klant. Antwoordt de klant, dan leest de agent het antwoord.
3. **Akkoord** zet het ticket naar de volgende fase. **Aanpassingen gevraagd** zet het een fase terug en voegt de feedback toe aan het mapdoc **Afspraken**, zodat de volgende ronde het volgt.
4. Het oordeel staat in de tijdlijn van het gesprek en telt als correctie op de scorekaart van het werk.

## Een werk verwijderen

1. Open het ···-menu rechtsboven en kies **Verwijderen**. Verwijderen zet het werk in de prullenbak.

## Wat daarna

Leg een label met een werk vast via **Labels toevoegen** op een gesprek in [Communicatie](/docs/inbox/communication); zie [Labels en tickets](/docs/ai/categories).
