---
title: Labels en tickets
intro: Een label heeft kleur en een icoon alleen zolang er een werk aan hangt. Dat label vastleggen maakt van het gesprek een ticket dat door de fasen van het werk gaat.
description: Koppel een werk aan een label, leg een ticket vast via Labels toevoegen, bevestig wat de AI voorstelde, verplaats een ticket door zijn fasen en splits een gesprek als er een tweede verzoek in opduikt.
keywords: labels, werk, tickets, fasen, map, intake, gesprek splitsen
sort: 46
related: flows,communication,channels,folders,widget
---

# Labels en tickets

Een label met een werk is gewoon een label. Een gesprek heeft er hooguit één: vastleggen maakt van het gesprek een ticket dat door de fasen van dat werk gaat. De map volgt uit de labels van het gesprek, inclusief labels op het contact. Hetzelfde label kan via **Opslaan als map** ook een map zijn. Kleur en icoon bestaan alleen zolang het werk eraan hangt, en stel je in op het werk. Haal je het werk weg, dan is het label meteen neutraal.

Als een kanaal een **AI-agent** heeft gekoppeld, leest die agent elk inkomend bericht (samenvatting, prioriteit, labels en tickets) in één run. Bij Autonomie **Handmatig** leest de agent nog wel en mag die labels of tickets vastleggen, maar er komt geen conceptantwoord naar de klant. Zonder kanaalagent is er geen AI-lezing. Een zekere lezing legt het ticket vast wanneer dat label automatisch labelen toestaat. Een zekere lezing op een label zonder automatisch labelen wordt een kaart **Dien in als naam** met **Dien in** en **Niet nu**. Een onzekere lezing wordt een bevestiging op het gesprek, en een verzoek dat nergens bij past telt mee onder **Wat we misten**. Vrije labels staan naast het label om te groeperen; zie [Communicatie](/docs/inbox/communication).

## Een werk aan een label koppelen

![Instellingen met één label](/api/docs/assets/categories/catalog.png)
*Eén Labels-lijst: gekleurde werk-labels, neutrale vrije labels en een telling. Open het werk vanaf de rij.*

1. Open **Instellingen**, dan **Labels**. De pagina toont één platte **Labels**-lijst (werk-labels eerst), dan **Wat we misten** en wie tickets mag bevestigen.
2. Kies **Nieuw label** en vul naam en beschrijving in. Op deze pagina staan geen kleur, icoon of groep. Vrije labels blijven neutraal.
3. Kies op een vrij label **Werk aanmaken**. Dat maakt of koppelt een werk met de labelnaam. Het label wordt een gekleurd werk-label in dezelfde lijst. Kies **Werk openen** om kleur, icoon, fasen en vastleggen op de werkpagina in te richten. Een nieuw werk start met Open, Wachtend en Klaar, en een hemelsblauw label met het route-icoon.
4. Kies **Opslaan als map** om het label een plek in de boom van mappen te geven. Het aantal gesprekken op een rij opent die gesprekken in Communicatie. Werk-labels verschijnen onder **Werk**.

## Een ticket op een gesprek vastleggen

![Ticketpaneel op een gesprek](/api/docs/assets/categories/ticket-panel.png)
*Het Ticketpaneel toont het werk, een fasebalk, de map en de eigen velden van het werk.*

1. Open een gesprek in **Communicatie**. Onder **Dit gesprek** kies je **Labels toevoegen**.
2. Typ de naam en kies een label met een werk (gemarkeerd **Label**), of een vrij label. Een onbekende naam vraagt of je die als label toevoegt of **Werk koppelen**.
3. Vastleggen vraagt niet om een map. Het gesprek past bij elke map waarvan het alle labels draagt; de kop toont die mappen. Canvas en docs staan op de map onder **Mappen**.
4. Het ticket start in de eerste fase van het werk. De lijstrij toont het label met fase en gekleurde stip. Een ander label kiezen vraagt om **Vervangen** (of splits het gesprek voor een tweede verzoek). Onder **Labels** haal je het label weg via het kruisje. Een dialoog toont het label en vraagt of je het zeker weet; **Loskoppelen** haalt het ticket van het gesprek.
5. In de composer legt `/ticket naam` hetzelfde ticket vast.

## Bevestigen wat de AI voorstelde

1. Een onzekere lezing toont op het gesprek als "Lijkt op klacht" met **Bevestigen** en **Afwijzen**.
2. Niets routeert en geen werk start voordat iemand bevestigt. Leden mogen zelf altijd een ticket vastleggen; **Wie mag tickets bevestigen** op **Instellingen** → **Labels** bepaalt wie een voorstel mag bevestigen. Op dezelfde kaart zet **Fasewissels door agents** de standaard voor werken zonder eigen instelling, en **Deadline nadert** hoeveel dagen voor een deadline een ticket als dichtbij telt.
3. Voorstellen tellen niet mee als vastgelegde tickets op Vandaag tot ze bevestigd zijn.
4. Stel de **Tickets**-houding in op [Govern](/docs/govern/govern) als agents moeten stoppen met tickets vastleggen.

## Een ticket door de fasen verplaatsen

1. Klik in het **Ticket**-paneel op een segment van de fasebalk om het ticket naar die fase te zetten; **Fase 2 van 3** toont waar het staat, gevolgd door de volgende check-up als de fase er een heeft. Op een werkbord, of op het maptabblad van de afdeling, sleep je de kaart naar een andere kolom; zie [Workforce](/docs/getting-started/team). Op een bordkaart is de contactnaam een link naar dat contact zodra het gesprek aan een contact is gekoppeld.
2. Als de doelfase verplichte velden heeft die nog leeg zijn, vraagt een dialoog ze in te vullen. Het ticket blijft in de huidige fase tot die waarden er zijn. Dezelfde dialoog verschijnt bij slepen. Het gesprek sluiten zet het ticket in dezelfde stap in de klaar-fase. Mist die fase nog verplichte velden, dan vraagt een dialoog ze in te vullen; gesprek en ticket sluiten pas als die er zijn.
3. Elke verplaatsing verschijnt in de tijdlijn, bijvoorbeeld **Ticket verplaatst naar Waiting**. De status van het ticket volgt altijd het soort van de fase: open, waiting of done.
4. Onder de map heeft elk eigen veld van het werk een eigen rij. Klik op een waarde om die te wijzigen; die wordt opgeslagen als je op Enter drukt, het veld verlaat of een optie kiest. Een `*` markeert een verplicht veld en kleurt oranje zolang het leeg is.
5. Beheerders zonder velden zien **Eigen velden toevoegen aan dit werk**; dat opent het werk in de bewerkmodus. Pas daar de fasen en velden aan; zie [Werk](/docs/ai/flows).
6. Verplaatst een agent het ticket, dan geldt de instelling **Fasewissels door agents** van het werk. Bij **Voorstellen, een mens bevestigt** toont het ticketpaneel **1 voorstel wacht op een beslissing in het gesprek** tot iemand de kaart beantwoordt.

## Een deadline zetten en de volgende stap volgen

Een ticket kan een deadline hebben met waar die vandaan komt. Het paneel en de bordkaart zeggen waar het ticket op wacht en hoeveel tijd er nog is.

1. Kies in het **Ticket**-paneel een datum bij **Deadline**. Kies de bron: **Wettelijk**, **Gevraagd**, **Afgesproken** of **Handmatig**, en typ de **Grondslag**, bijvoorbeeld het artikel of het verzoek van de klant.
2. Een deadline die een agent vindt, is altijd een voorstel: een beslissingskaart in het gesprek met **Deadline zetten** en **Geen deadline**. Zelf een datum kiezen beantwoordt die kaart.
3. De regel boven de deadline toont de volgende stap, bijvoorbeeld **Wacht op klant · 1 punt ontbreekt · 1 te bevestigen**. Ga er met de muis over om te zien welke punten ontbreken.
4. Binnen de periode waarin de deadline nadert toont de kaart **Deadline over 3 dagen**; na de datum **2 dagen te laat**, en de map telt het ticket als te laat. De check-up van de fase komt eerder bij de deadline en dagelijks als die voorbij is. Deadlines staan ook op [Agenda](/docs/ai/agenda).
5. **Deadline wissen** haalt de datum weg.

## Een nieuw verzoek afsplitsen

Als een klant iets nieuws in een oud thread opbrengt, krijgt dat verzoek een eigen gesprek zodat elk gesprek één label houdt.

1. Hover het bericht waar het nieuwe verzoek begint en kies **Vanaf hier splitsen**.
2. Kies de **Label voor het nieuwe gesprek**, of **Later beslissen**, dan **Splitsen**.
3. Dat bericht en alles erna gaan naar een nieuw gesprek met dezelfde contactpersoon en hetzelfde kanaal. Beide tijdlijnen tonen de link, en latere antwoorden op dezelfde e-mailthread of chat landen in het nieuwe gesprek.
4. Agents volgen de Autonomie van het gesprek: op **Autonoom** splitsen ze zelf, op **Geassisteerd** stellen ze de split voor als beslissing, op **Handmatig** laten ze het aan jou.

## Labels laten voorstellen

Agents stellen labels voor als één plan dat je één keer goedkeurt; elke regel zegt waar het label komt.

1. Vraag een agent om labels voor te stellen, of kies **Labels voorstellen** op een knooppunt in het Grid van [Workforce](/docs/getting-started/team).
2. De kaart toont elk label met **nieuw** of **bestaand**, hoeveel gesprekken het dekt en waar het komt: op de gesprekken, **op bedrijf** (elk gesprek van dat bedrijf toont het), of **regel op** een afzender of domein (de volgende mail krijgt het label vanzelf).
3. Vink de regels aan die je wilt en kies **Geselecteerde goedkeuren**, of **Alles goedkeuren**. Daarvoor verandert er niets.
4. Agents hergebruiken eerst bestaande labels en houden één idee per label: een leverancier hoort op het bedrijf, het soort werk (bijvoorbeeld `facturen`) is het label. Ze bedenken geen label per factuur of per documentsoort, en het platform weigert namen die een bedrijf en een onderwerp aan elkaar plakken.
5. Zelfstandig koppelen agents alleen labels die al bestaan. Een verzoek waar niets bij past, verschijnt onder **Wat we misten**.

## Twee labels samenvoegen

Twee labels die hetzelfde betekenen worden er één. Alles wat het overtollige label droeg, verhuist.

1. Open **Instellingen**, dan **Labels**.
2. Kies **Samenvoegen** op het overtollige label. Een werk-label heeft geen samenvoegen: die naam is de titel van het werk.
3. Kies het label dat blijft en bevestig. Gesprekken, contacten, bedrijven, mappen en regels die het overtollige label gebruikten, gebruiken nu het label dat je hield. De oude naam verdwijnt.
4. Vraag een agent hetzelfde. Die stelt **Merge labels** voor en wacht op goedkeuring. Een label verwijderen doet dit niet: verwijderen haalt het label overal af in plaats van de items te verplaatsen. Een agent kan een label ook hernoemen: de nieuwe naam vervangt de oude overal, en ook dat wacht op goedkeuring. Een werk-label hernoemen hernoemt het werk.

## Een gemist patroon een werk geven

1. Open **Instellingen**, dan **Labels**, en lees **Wat we misten**. Daar staan verzoeken die bleven binnenkomen zonder passend label, met hoe vaak elk gezien is.
2. Stel **Stel een nieuwe label voor na** in op hoeveel waarnemingen je wilt voordat een patroon klaar staat.
3. Kies **Koppel er een werk aan** om die met de voorgestelde tag en omschrijving aan te maken, of **Geen werk** om hem te laten vallen. Agents maken zelf nooit een label met een werk.

## Wat daarna

Zet het actielabel van het werk in de filterset van een [map](/docs/ai/folders), zodat die map een baan op het werkbord wordt; tickets in die map verschijnen ook onder **Werk** op de mappagina. Geef elke fase een eigenaar en een check-up-ritme op [Werk](/docs/ai/flows); openstaande check-ups staan op [Agenda](/docs/ai/agenda) en in het ticketpaneel.
