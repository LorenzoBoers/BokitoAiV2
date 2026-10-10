---
title: Actietags en tickets
intro: Een actietag is een hashtag die een ticketflow start. Leg je haar vast op een gesprek, dan wordt dat gesprek een ticket dat door de fasen van de flow gaat.
description: Maak van een tag een actietag, leg een ticket vast met een projectkeuze via Tags toevoegen, bevestig wat de AI voorstelde, verplaats een ticket door zijn fasen en splits een gesprek als er een tweede verzoek in opduikt.
keywords: actietags, tickets, hashtags, fasen, flow, project, intake, gesprek splitsen, categorieën
sort: 46
related: workstreams,communication,channels,projects,widget
---

# Actietags en tickets

Een actietag is een tag met een flow. Een gesprek heeft hooguit één actietag: vastleggen maakt van het gesprek een ticket dat door de fasen van die flow gaat, op een van de projecten van de flow of op geen project.

Als een kanaal een **AI-agent** heeft gekoppeld, leest die agent elk inkomend bericht (samenvatting, prioriteit, tags en tickets) in één run. Bij AI-afhandeling **Handmatig** leest de agent nog wel en mag die tags of tickets vastleggen, maar er komt geen conceptantwoord naar de klant. Zonder kanaalagent is er geen AI-lezing. Een zekere lezing legt het ticket vast wanneer die actietag automatisch taggen toestaat. Een zekere lezing op een tag zonder automatisch taggen wordt een kaart **Dien in als #naam** met **Dien in** en **Niet nu**. Een onzekere lezing wordt een bevestiging op het gesprek, en een verzoek dat nergens bij past telt mee onder **Wat we misten**. Vrije tags staan naast de actietag om te groeperen; zie [Communicatie](/docs/inbox/communication).

## Een tag tot actietag maken

![Instellingen met één actietag](/api/docs/assets/categories/catalog.png)
*Eén Tags-lijst: elke rij ziet er hetzelfde uit; flow aanmaken of openen vanaf de rij.*

1. Open **Instellingen**, dan **# Tags**. De pagina toont één **Tags**-lijst (actietags eerst, met accent-`#`), dan **Wat we misten** en wie tickets mag bevestigen.
2. Kies **Nieuwe tag** om een vrije tag toe te voegen, daarna **Flow aanmaken** op die rij. Dat maakt of koppelt een flow met titel `#naam`. De tag wordt een actietag in dezelfde lijst.
3. Op een actietag kies je **Flow openen** om fasen, vastleggen en projecten op de flowpagina in te richten. Een nieuwe flow start met Open, Wachtend en Klaar.
4. Gebruik de punaise op elke tag voor een rij in de zijbalk van Communicatie. Met de AI-schakelaar zet je aan of triage deze tag automatisch mag toepassen.

## Een ticket op een gesprek vastleggen

![Ticketpaneel op een gesprek](/api/docs/assets/categories/ticket-panel.png)
*Het Ticketpaneel toont de flow, een fasebalk, het project en de eigen velden van de flow.*

1. Open een gesprek in **Communicatie**. Onder **Dit gesprek** kies je **Tags toevoegen**.
2. Typ met een zachte `#` en kies een actietag (gemarkeerd **Actietag**), of een vrije tag. Een onbekende naam vraagt of je die als tag toevoegt of **Actietag maakt**.
3. Als de flow op een of meer projecten staat, kies er een of **Geen project**. Vastleggen vraagt dit altijd; agents kiezen ook, of laten het ticket voorgesteld.
4. Het ticket start in de eerste fase van de flow. De lijstrij toont de actietag met fase en gekleurde stip. Een andere actietag kiezen vraagt om **Vervangen** (of splits het gesprek voor een tweede verzoek).
5. In de composer legt `/ticket #naam` hetzelfde ticket vast. Bij projecten stuurt Bokito je naar het **Ticket**-paneel om er een te kiezen.

## Bevestigen wat de AI voorstelde

1. Een onzekere lezing toont op het gesprek als "Lijkt op #klacht" met **Bevestigen** en **Afwijzen**. Bij projecten opent bevestigen de projectkeuze.
2. Niets routeert en geen flow start voordat iemand bevestigt. Leden mogen zelf altijd een ticket vastleggen; **Wie mag tickets bevestigen** op **Instellingen** → **# Tags** bepaalt wie een voorstel mag bevestigen.
3. Voorstellen tellen niet mee als vastgelegde tickets op Overview tot ze bevestigd zijn.
4. Stel de **Tickets**-houding in op [Govern](/docs/govern/govern) als agents moeten stoppen met tickets vastleggen.

## Een ticket door de fasen verplaatsen

1. Klik in het **Ticket**-paneel op een segment van de fasebalk om het ticket naar die fase te zetten; **Fase 2 van 3** toont waar het staat, gevolgd door de volgende check-up als de fase er een heeft. Op een flow- of projectbord sleep je de kaart naar een andere kolom; zie [Projecten](/docs/ai/projects).
2. Als de doelfase verplichte velden heeft die nog leeg zijn, vraagt een dialoog ze in te vullen. Het ticket blijft in de huidige fase tot die waarden er zijn. Dezelfde dialoog verschijnt bij slepen. Het gesprek sluiten zet het ticket in de klaar-fase. Mist die fase nog verplichte velden, dan blijft het ticket staan en sluit het gesprek toch.
3. Elke verplaatsing verschijnt in de tijdlijn, bijvoorbeeld **Ticket verplaatst naar Waiting**. De status van het ticket volgt altijd het soort van de fase: open, waiting of done.
4. Onder het project heeft elk eigen veld van de flow een eigen rij. Klik op een waarde om die te wijzigen; die wordt opgeslagen als je op Enter drukt, het veld verlaat of een optie kiest. Een `*` markeert een verplicht veld en kleurt oranje zolang het leeg is.
5. Beheerders zonder velden zien **Eigen velden toevoegen aan deze flow**; dat opent de flow in de bewerkmodus. Pas daar de fasen en velden aan; zie [Flows](/docs/ai/workstreams).

## Een nieuw verzoek afsplitsen

Als een klant iets nieuws in een oud thread opbrengt, krijgt dat verzoek een eigen gesprek zodat elk gesprek één actietag houdt.

1. Hover het bericht waar het nieuwe verzoek begint en kies **Vanaf hier splitsen**.
2. Kies de **Actietag voor het nieuwe gesprek**, of **Later beslissen**, dan **Splitsen**.
3. Dat bericht en alles erna gaan naar een nieuw gesprek met dezelfde contactpersoon en hetzelfde kanaal. Beide tijdlijnen tonen de link, en latere antwoorden op dezelfde e-mailthread of chat landen in het nieuwe gesprek.
4. Agents volgen de AI-afhandeling van het gesprek: op **Autonoom** splitsen ze zelf, op **Geassisteerd** stellen ze de split voor als beslissing, op **Handmatig** laten ze het aan jou.

## Een gemist patroon tot actietag maken

1. Open **Instellingen**, dan **# Tags**, en lees **Wat we misten**. Daar staan verzoeken die bleven binnenkomen zonder passende actietag, met hoe vaak elk gezien is.
2. Stel **Stel een nieuwe actietag voor na** in op hoeveel waarnemingen je wilt voordat een patroon klaar staat.
3. Kies **Maak er een actietag van** om die met de voorgestelde tag en omschrijving aan te maken, of **Geen actietag** om hem te laten vallen. Agents maken zelf nooit een actietag.

## Wat daarna

Zet de flow op een [project](/docs/ai/projects) met **Flow toevoegen** op de projectpagina, zodat de tickets daar als bord verschijnen. Geef elke fase een eigenaar en een check-up-ritme op [Flows](/docs/ai/workstreams); openstaande check-ups staan op [Agenda](/docs/ai/agenda) en in het ticketpaneel.
