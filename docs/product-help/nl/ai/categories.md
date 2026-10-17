---
title: Labels en tickets
intro: Een label heeft kleur en een icoon alleen zolang er een flow aan hangt. Dat label vastleggen maakt van het gesprek een ticket dat door de fasen van de flow gaat.
description: Koppel een flow aan een label, leg een ticket vast via Labels toevoegen, bevestig wat de AI voorstelde, verplaats een ticket door zijn fasen en splits een gesprek als er een tweede verzoek in opduikt.
keywords: labels, flows, tickets, fasen, project, intake, gesprek splitsen
sort: 46
related: workstreams,communication,channels,folders,widget
---

# Labels en tickets

Een label met een flow is gewoon een label. Een gesprek heeft er hooguit één: vastleggen maakt van het gesprek een ticket dat door de fasen van die flow gaat. De map volgt uit de labels van het gesprek, inclusief labels op het contact. Hetzelfde label kan via **Opslaan als map** ook een map zijn. Kleur en icoon bestaan alleen zolang de flow eraan hangt, en stel je in op de flow. Haal je de flow weg, dan is het label meteen neutraal.

Als een kanaal een **AI-agent** heeft gekoppeld, leest die agent elk inkomend bericht (samenvatting, prioriteit, labels en tickets) in één run. Bij AI-afhandeling **Handmatig** leest de agent nog wel en mag die labels of tickets vastleggen, maar er komt geen conceptantwoord naar de klant. Zonder kanaalagent is er geen AI-lezing. Een zekere lezing legt het ticket vast wanneer die label automatisch labelen toestaat. Een zekere lezing op een label zonder automatisch labelen wordt een kaart **Dien in als naam** met **Dien in** en **Niet nu**. Een onzekere lezing wordt een bevestiging op het gesprek, en een verzoek dat nergens bij past telt mee onder **Wat we misten**. Vrije labels staan naast het label om te groeperen; zie [Communicatie](/docs/inbox/communication).

## Een flow aan een label koppelen

![Instellingen met één label](/api/docs/assets/categories/catalog.png)
*Eén Labels-lijst: gekleurde flow-labels, neutrale vrije labels en een telling. Open de flow vanaf de rij.*

1. Open **Instellingen**, dan **Labels**. De pagina toont één platte **Labels**-lijst (flow-labels eerst), dan **Wat we misten** en wie tickets mag bevestigen.
2. Kies **Nieuw label** en vul naam en beschrijving in. Op deze pagina staan geen kleur, icoon of groep. Vrije labels blijven neutraal.
3. Kies op een vrij label **Flow aanmaken**. Dat maakt of koppelt een flow met de labelnaam. Het label wordt een gekleurd flow-label in dezelfde lijst. Kies **Flow openen** om kleur, icoon, fasen en vastleggen op de flowpagina in te richten. Een nieuwe flow start met Open, Wachtend en Klaar, en een hemelsblauw label met het route-icoon.
4. Kies **Opslaan als map** om het label een plek in de mappenboom te geven. Het aantal gesprekken op een rij opent die gesprekken in Communicatie. Flow-labels verschijnen onder **Flows**.

## Een ticket op een gesprek vastleggen

![Ticketpaneel op een gesprek](/api/docs/assets/categories/ticket-panel.png)
*Het Ticketpaneel toont de flow, een fasebalk, het project en de eigen velden van de flow.*

1. Open een gesprek in **Communicatie**. Onder **Dit gesprek** kies je **Labels toevoegen**.
2. Typ met een zachte `#` en kies een label met een flow (gemarkeerd **Label**), of een vrije tag. Een onbekende naam vraagt of je die als tag toevoegt of **Flow koppelen**.
3. Vastleggen vraagt niet om een map. Het gesprek past bij elke bewaarde map waarvan het alle tags draagt; de kop toont die mappen. Canvas en docs staan op de maphub onder **Mappen**.
4. Het ticket start in de eerste fase van de flow. De lijstrij toont het label met fase en gekleurde stip. Een andere label kiezen vraagt om **Vervangen** (of splits het gesprek voor een tweede verzoek). Onder **Labels** haal je het label weg via het kruisje. Een dialoog toont het label en vraagt of je het zeker weet; **Loskoppelen** haalt het ticket van het gesprek.
5. In de composer legt `/ticket #naam` hetzelfde ticket vast.

## Bevestigen wat de AI voorstelde

1. Een onzekere lezing toont op het gesprek als "Lijkt op #klacht" met **Bevestigen** en **Afwijzen**.
2. Niets routeert en geen flow start voordat iemand bevestigt. Leden mogen zelf altijd een ticket vastleggen; **Wie mag tickets bevestigen** op **Instellingen** → **Labels** bepaalt wie een voorstel mag bevestigen.
3. Voorstellen tellen niet mee als vastgelegde tickets op Overview tot ze bevestigd zijn.
4. Stel de **Tickets**-houding in op [Govern](/docs/govern/govern) als agents moeten stoppen met tickets vastleggen.

## Een ticket door de fasen verplaatsen

1. Klik in het **Ticket**-paneel op een segment van de fasebalk om het ticket naar die fase te zetten; **Fase 2 van 3** toont waar het staat, gevolgd door de volgende check-up als de fase er een heeft. Op een flow- of projectbord sleep je de kaart naar een andere kolom; zie [Projecten](/docs/ai/folders). Op een bordkaart is de contactnaam een link naar dat contact zodra het gesprek aan een contact is gekoppeld.
2. Als de doelfase verplichte velden heeft die nog leeg zijn, vraagt een dialoog ze in te vullen. Het ticket blijft in de huidige fase tot die waarden er zijn. Dezelfde dialoog verschijnt bij slepen. Het gesprek sluiten zet het ticket in de klaar-fase. Mist die fase nog verplichte velden, dan blijft het ticket staan en sluit het gesprek toch.
3. Elke verplaatsing verschijnt in de tijdlijn, bijvoorbeeld **Ticket verplaatst naar Waiting**. De status van het ticket volgt altijd het soort van de fase: open, waiting of done.
4. Onder het project heeft elk eigen veld van de flow een eigen rij. Klik op een waarde om die te wijzigen; die wordt opgeslagen als je op Enter drukt, het veld verlaat of een optie kiest. Een `*` markeert een verplicht veld en kleurt oranje zolang het leeg is.
5. Beheerders zonder velden zien **Eigen velden toevoegen aan deze flow**; dat opent de flow in de bewerkmodus. Pas daar de fasen en velden aan; zie [Flows](/docs/ai/workstreams).

## Een nieuw verzoek afsplitsen

Als een klant iets nieuws in een oud thread opbrengt, krijgt dat verzoek een eigen gesprek zodat elk gesprek één label houdt.

1. Hover het bericht waar het nieuwe verzoek begint en kies **Vanaf hier splitsen**.
2. Kies de **Label voor het nieuwe gesprek**, of **Later beslissen**, dan **Splitsen**.
3. Dat bericht en alles erna gaan naar een nieuw gesprek met dezelfde contactpersoon en hetzelfde kanaal. Beide tijdlijnen tonen de link, en latere antwoorden op dezelfde e-mailthread of chat landen in het nieuwe gesprek.
4. Agents volgen de AI-afhandeling van het gesprek: op **Autonoom** splitsen ze zelf, op **Geassisteerd** stellen ze de split voor als beslissing, op **Handmatig** laten ze het aan jou.

## Een gemist patroon een flow geven

1. Open **Instellingen**, dan **Labels**, en lees **Wat we misten**. Daar staan verzoeken die bleven binnenkomen zonder passend label, met hoe vaak elk gezien is.
2. Stel **Stel een nieuwe label voor na** in op hoeveel waarnemingen je wilt voordat een patroon klaar staat.
3. Kies **Koppel er een flow aan** om die met de voorgestelde tag en omschrijving aan te maken, of **Geen flow** om hem te laten vallen. Agents maken zelf nooit een label met een flow.

## Wat daarna

Zet de flow op een [project](/docs/ai/folders) met **Flow toevoegen** op de projectpagina, zodat de tickets daar als bord verschijnen. Geef elke fase een eigenaar en een check-up-ritme op [Flows](/docs/ai/workstreams); openstaande check-ups staan op [Agenda](/docs/ai/agenda) en in het ticketpaneel.
