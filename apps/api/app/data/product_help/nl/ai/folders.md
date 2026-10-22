---
title: Zo werken Mappen
intro: Een map in Bokito is de plek waar al het werk over één onderwerp samenkomt en terechtkomt, zoals een klant, een project of een afdelingstaak.
description: Maak mappen, nest ze vrij, stel labelregels in voor lidmaatschap, berg gesprekken op en houd canvas, documenten en borden in de map.
keywords: mappen, map, labels, filterset, werkt in, algemeen, canvas, tickets, werken, borden, documentatie, communicatie, nesten
sort: 40
related: flows,categories,agenda,knowledge,communication
---

# Zo werken Mappen

Een map heeft een **naam** en een plek in een vrije boom, en verzamelt het werk over één onderwerp: gesprekken, tickets, canvas, documenten en bestanden. Optionele **labels** bepalen welke gesprekken erin landen; nesten verandert alleen de boom, de labels blijven gelijk.


## Maak of open een map

![Lijst met mappen](/api/docs/assets/folders/project.png)
*Elke kaart is een map met open werk.*

1. Open **Mappen**. Het linkermenu toont de boom. Kies **Nieuwe map**, geef een naam en kies optioneel labels voor lidmaatschap.
2. Bevestig. De map verschijnt in de boom op het hoogste niveau, of onder de map die je koos. De kaart telt open en gesloten gesprekken in de map en de mappen eronder, hetzelfde getal als in de Communicatie-zijbalk. Een map zonder naam toont de labels die hem onderscheiden van de bovenliggende map, of **Naamloze map**.
3. Open een kaart. Je landt op **Overzicht**. Beheerders hoveren de naam: die wordt een pil met een pennetje, en een klik hernoemt de map. Labels staan in één veld naast de naam; **+** voegt labels toe, het kruisje op een pil haalt die weg. Leden kunnen lezen, niet verwijderen.

## Nest een map onder een andere

1. Sleep op **Mappen** een map. Een lijn toont waar hij landt: omhoog of omlaag voor de plek, verder naar rechts om een niveau dieper te nesten, verder naar links om een niveau omhoog te gaan.
2. Laat los als hij op de goede plek zit. Labels veranderen niet, alleen de plek in de boom.
3. Gebruik **Ongedaan maken** op de melding, of Ctrl/Cmd+Z, om de laatste verplaatsing terug te draaien.

## Verplaats een map naar het hoogste niveau

1. Sleep op **Mappen** een geneste map verder naar links tot hij op het gewenste niveau staat. Ver genoeg naar links komt hij op het hoogste niveau.
2. De map komt tussen de andere mappen op dat niveau. Labels blijven gelijk.
3. Gebruik **Ongedaan maken** op de melding, of Ctrl/Cmd+Z, als je het wilt terugdraaien.

## Verplaats één label tussen mappen

1. Hover op **Mappen** een label in een boomrij. Het krijgt een pil, zodat je ziet dat het los van de andere labels op die rij staat.
2. Sleep dat label naar een andere map, of naar **Bovenste laag**. Het label verlaat de bronset en komt bij het doel.
3. Gebruik **Ongedaan maken** op de melding, of Ctrl/Cmd+Z, als je het wilt terugdraaien.

## Berg een gesprek op in een map

1. Open het gesprek in [Communicatie](/docs/inbox/communication).
2. Kies **Opbergen in map** (of **Sluiten en opbergen**) en kies de map. Bokito zet de labels van die map op het gesprek.
3. Het gesprek hoort daarna bij die map, en bij elke andere map waarvan het ook de labels draagt.

## Lees het Overzicht

1. De kop toont de naam en daarnaast het labelveld met de pillen. **Open in Communicatie** springt naar dezelfde map in de Communicatie-rail. **Wie werkt hier** noemt de afdeling waar de map bij hoort, gemarkeerd als **Thuisafdeling van deze map**, en elke afdeling met open tickets in de map of de mappen daarin. Kies er een om de afdelingspagina te openen.
2. Hover een boomrij voor de labels en **Onder:** de bovenliggende map.
3. **Werken** toont elk bord waarvan een gesprek in deze map (of een map daarin) een ticket is: fasen als kolommen, tickets als kaarten. **Recente gesprekken** toont de passende gesprekken; **Alle gesprekken** opent het tabblad Gesprekken.

## Voeg een plek toe aan Werkt in

**Werkt in** staat bovenaan het **Overzicht** en toont elke plek waar werk uit deze map terechtkomt: het bord en de bestanden (in Bokito, zodra er iets in staat), elk canvas (in Bokito) en koppelingen of bestandsmappen buiten Bokito.

1. Open de map. Elke kaart toont de naam en of hij in **Bokito** zit of een **Koppeling** is; een klik opent hem.
2. Beheerders kiezen **Toevoegen aan Werkt in** en kiezen **Canvas**, **Koppeling** of **Bestandsmap**.
3. Geef een canvas een naam; kies bij een koppeling een van de actieve koppelingen; geef een bestandsmap een naam en de URL of map-ID. Kies **Toevoegen**.
4. Een koppeling of bestandsmap haal je weg met het prullenbakicoon op de kaart. Werk zonder map komt in de map **Algemeen**; de module Boekhouding maakt bij installatie de map **Administratie** met de koppeling, of met een canvas **Cijfers** als er nog geen koppeling is.
5. Schrijft een agent via een koppeling, werkt hij een canvas bij, of rondt een codetool een pull request voor deze map af, dan toont het gesprek **Opgeleverd in {map} › {plek}**; een klik opent die plek. Een koppeling die in geen map staat levert niets op en verschijnt als aandachtspunt.

## Zie gesprekken in een map

1. Open het tabblad **Gesprekken**, of gebruik **Mappen** in Communicatie. Alle mappen staan in de rail, ook lege.
2. Elke rij hoort bij deze map of een map daarin, via labels of omdat het gesprek hier is opgeborgen.
3. Labels van het contact tellen automatisch mee (getoond als overgenomen); ze worden niet op het gesprek gekopieerd.

## Verplaats een ticket op een bord

![Werkborden in een map](/api/docs/assets/folders/boards.png)
*Eén bord per werk in de map, met de fasen van dat werk als kolommen.*

1. Open de map op **Overzicht**, of het tabblad **Tickets**.
2. Sleep een kaart naar een andere kolom om de fase te wijzigen. Klik een kaart om het gesprek in [Communicatie](/docs/inbox/communication) te openen.
3. De map toont alleen werken met tickets die hier passen. Zie [Werken](/docs/ai/flows) en [Labels](/docs/ai/categories).

## Vraag een agent om een canvas

1. Open het tabblad **Canvas** en kies **Canvas toevoegen**. Kies de agent die het beheert.
2. Dat opent een gesprek: de agent vraagt wat je wilt zien, stelt een kort plan voor (titel, widgets, verversing), bouwt de snapshot en zet het verversingsritme. Blijf in dat gesprek praten om het te wijzigen.
3. Boven het canvas staan de beheeragent, wanneer het is bijgewerkt en de verversperiode. Het canvas zit in een venster: de titelbalk noemt het soort en de versie en bevat **Voorbeeld** / **Code**, kopiëren, downloaden, vernieuwen en het **⋯**-menu met **Verwijderen**. Elk canvas hoort bij een map en staat ook onder **Werkt in**. Alleen een **Dashboard** heeft een verversperiode.

## Bewaar meer dan een dashboard op een canvas

Een canvas hoort bij zijn gesprek. De map van dat gesprek is waar het canvas op het tabblad Canvas staat (inclusief submappen). Dat gesprek kan meerdere canvases bevatten. De agent kiest het soort: **Document** (een rapport in Markdown), **Diagram** (een Mermaid-werk), **Tekening** (een SVG, eventueel met een plaatje dat in Bokito is opgeslagen), **Beeld** (een gegenereerde foto bij het gesprek), **Code** (een script dat je kunt downloaden), **E-mail** (een brief met onderwerp en body) of **Sheet** (een tabel). Logo en kleuren blijven in Instellingen. Een kort antwoord blijft in de chat.

1. Vraag in het canvasgesprek om het stuk, bijvoorbeeld een diagram, een plaatje om te bewaren of een tabel.
2. Open het tabblad **Canvas**, of het venster onder het antwoord van de agent. De titelbalk toont het soort. Elk soort gebruikt hetzelfde venster; het vergroot-icoon opent het canvas naast het gesprek. Het gesprek blijft links, het canvas vult rechts, en de verdeling ertussen is te slepen. Sluiten keert terug naar het gesprek.
3. Gebruik het download-icoon in de titelbalk. Een document downloadt als Markdown, een diagram als Mermaid, een tekening als SVG, code als eigen bestandstype. Op een sheet kies je **CSV**, **Excel** of **Google Sheets**. CSV en Excel downloaden een bestand. Google Sheets maakt een spreadsheet in de gekoppelde Google Drive en opent die. Koppel Google Drive onder Koppelingen wanneer die export daarom vraagt.
4. Wijzig het in datzelfde gesprek. Het canvas krijgt geen tweede gesprek.

## Volg documentatie

1. Open het tabblad **Documentatie** voor documenten in deze map. Maak of bewerk ze zoals in Kennis; agents wijzigen ze alleen binnen een [werk](/docs/ai/flows)-run.
2. Kies **Openen in Kennishub** om hetzelfde document daar te bewerken.

## Posts plannen op een contentkalender

Een klantmap houdt zijn posts als items, en Bokito houdt een Google Sheet daarmee gelijk.

1. Koppel **Google Drive** onder [Koppelingen](/docs/integrations/integrations). Vraag in een gesprek een agent de Google Sheet van de contentkalender aan de map toe te voegen, bijvoorbeeld: **Zet deze sheet als contentkalender van Klanten/Studio Veluwe** met de link van de sheet. Die staat dan in **Werkt in** als **Spreadsheet**. Bokito schrijft naar het tabblad **Kalender**, tenzij je een ander tabblad noemt.
2. Een agent op een contentticket zet elke post als item in de map, met datum, kanaal, caption en beeld.
3. Bij elke post die erbij komt, verandert of verschuift, schrijft Bokito de sheet opnieuw met alle posts van de map: datum, kanaal, titel, caption, beeld en status.
4. Staat de werkruimte op Handmatig, dan verandert de sheet alleen als je een agent vraagt hem bij te werken. Publiceren doet een mens.

## Agenda en de rail

1. In Communicatie en Agenda **Wat** delen mappen één `#`-boom met dezelfde structuur als Mappen.
2. Tellers en filters volgen de map die je kiest, met alle mappen daarin.
