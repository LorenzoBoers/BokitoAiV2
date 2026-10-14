---
title: Zo werken Mappen
intro: Een map is een bewaard tagfilter — gesprekken die alle tags in de set dragen landen hier, met canvas, docs en borden op dezelfde hub.
description: Maak mappen als AND-tagfiltersets, nest door tags toe te voegen, open passende gesprekken en houd canvas en docs op de maphub.
keywords: mappen, tags, filterset, canvas, tickets, flows, borden, documentatie, communicatie, nesten
sort: 40
related: workstreams,categories,agenda,knowledge,communication
---

# Zo werken Mappen

Een map is een bewaarde set tags. Een gesprek past als het **elke** tag in die set heeft (inclusief tags van het contact). Hetzelfde gesprek kan in meerdere mappen staan; smallere sets nesten onder bredere in de rail. Open **Mappen** voor de hub: gesprekken, tickets, canvas, docs en bestanden. Er is geen agent, budget of repository per map.

## Maak of open een map

![Projectenlijst](/api/docs/assets/folders/project.png)
*Elke kaart is een tagset (bijvoorbeeld `#2026 · #facturen`) met open werk.*

1. Open **Mappen**. Links zie je de afgeleide boom (smallere mappen onder bredere). Kies **Nieuwe map** en kies of maak de tags van het filter — er is geen aparte naam.
2. Terwijl je tags kiest, toont het dialoog de volledige filterset en of de nieuwe map **onder** een bestaande bredere map komt.
3. Open een kaart. Je landt op **Overzicht**. Beheerders wijzigen de tagset ter plekke (bredere tags blijven vergrendeld als de map al onder een andere hangt). Leden kunnen lezen, niet verwijderen.

## Maak een smallere map onder deze

1. Open een map en kies **Nieuwe map**.
2. Tags van de open map blijven verplicht (vergrendeld). Voeg één of meer **extra tags** toe — die extra's zie je als rij onder de ouder in de boom.
3. Bevestig. Gesprekken matchen alleen als ze elke tag van de nieuwe set dragen. De map verschijnt onder de bredere in Mappen en in Communicatie **Wat**.

## Nest een map onder een bredere

1. Op **Mappen** sleep je een map over de **rechterhelft** van een andere rij (of gebruik **Nesten** in het mapmenu). De **linkerhelft** van de boom wijzigt alleen de volgorde tussen siblings.
2. Lees de preview: de resulterende filterset en onder welke bredere map die komt. Deelden de mappen geen tags, bevestig dan de waarschuwing — matchende gesprekken moeten daarna ook de bredere tags dragen.
3. Bevestig **Nesten**. Gebruik **Ongedaan maken** in de melding, of Ctrl/Cmd+Z, om de laatste nest, herordening, unnest of tagverplaatsing terug te draaien.

## Verplaats een map of tag naar de bovenste laag

1. Op **Mappen** sleep je een geneste map (of een losse tag-chip) op de zone **Bovenste laag** die boven de boom verschijnt.
2. Een geneste map laat de bredere tags los en komt naast de andere root-mappen. Een tag verlaat de bron-filterset; bestaat er nog geen topmap voor die tag alleen, dan maakt Bokito die aan.
3. Gebruik **Ongedaan maken** in de melding, of Ctrl/Cmd+Z, om dit terug te draaien.

## Verplaats een losse tag tussen mappen

1. Op **Mappen** hover je een tag in een boomrij — die krijgt een pil zodat je ziet dat die los staat van de andere tags op die rij.
2. Sleep die tag op een andere map (of de zone **Nesten**), of op **Bovenste laag**. De tag verlaat de bron-filterset en komt bij het doel. Een map houdt altijd minstens één tag.
3. Gebruik **Ongedaan maken** in de melding, of Ctrl/Cmd+Z, om dit terug te draaien.

## Lees het Overzicht

1. De kop toont de volledige filtertags (`#2026 · #facturen`). Boomrijen tonen alleen de tags die nieuw zijn ten opzichte van de ouder. **Open in communicatie** springt naar hetzelfde filter in de Communicatie-rail.
2. Hover een boomrij voor de volledige set en **Onder:** de bredere map.
3. **Recente gesprekken** toont matches; **Alle gesprekken** opent het tabblad Gesprekken. Canvas, docs en bestanden blijven op deze hub.

## Zie gesprekken in een map

1. Open het tabblad **Gesprekken**, of gebruik **Mappen** in Communicatie. Lege mappen blijven in de rail verborgen tot er open werk is of je ze vastzet.
2. Elke rij is een gesprek dat alle tags van deze map draagt. Indelen in een map voegt die tags toe.
3. Contacttags gelden automatisch (als overgenomen); ze worden niet op de thread gekopieerd.

## Verplaats een ticket op een bord

![Flowborden op een project](/api/docs/assets/folders/boards.png)
*Eén bord per flow op de map, met de stages van die flow als kolommen.*

1. Open het tabblad **Tickets** wanneer er flows aan deze map hangen.
2. Sleep een kaart naar een andere kolom om de stage te wijzigen. Klik een kaart om die in [Communicatie](/docs/inbox/communication) te openen.
3. Flows blijven de actietag-as; een map filtert alleen wat je ziet. Zie [Flows](/docs/ai/workstreams) en [Actietags](/docs/ai/categories).

## Vraag een agent een canvas te schrijven

1. Open het tabblad **Canvas** en kies **Canvas toevoegen**. Kies de agent die het beheert.
2. Dat opent een gesprek: de agent vraagt wat je wilt zien, stelt een kort plan voor (titel, widgets, verversen), bouwt daarna de snapshot en zet de verversperiode. Blijf in dat gesprek om het te wijzigen. Workspace-canvassen staan ook op Overview **Canvas**.

## Houd documentatie bij

1. Open het tabblad **Documentatie** voor docs van deze map. Maak of bewerk zoals in Kennis; agents wijzigen projectdocs alleen in een [flow](/docs/ai/workstreams)-run.
2. Kies **Openen in Kennishub** om hetzelfde document onder Kennis te bewerken.

## Agenda en de rail

1. In Communicatie en Agenda **Wat** delen mappen één afgeleide `#`-boom met dezelfde lokale labels en volledige-set-tooltips als Mappen.
2. Zet een rij vast om die zichtbaar te houden; verberg lege rijen via het menu. Agenda filtert op de tags van de gekozen map. Wis de chip in de kop om alles weer te zien.
