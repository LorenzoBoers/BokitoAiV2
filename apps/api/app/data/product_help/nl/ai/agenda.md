---
title: Zo werkt Agenda
intro: Alles wat er in de workspace gebeurt, door mensen en agents, in één agenda naast je eigen Google- of Outlook-afspraken.
description: Zie wat er gebeurde, wat openstaat en wat gepland is, volg tickets op en plan taken voor mensen en agents.
keywords: agenda, kalender, planning, taak, check-up, wake, google calendar, outlook calendar
sort: 50
related: agents,folders,flows,communication,agent-runs,koppelingen
---

# Zo werkt Agenda

Agenda toont wat er gebeurde, wat openstaat en wat gepland is, voor mensen en agents. Je gekoppelde agenda's staan in hetzelfde rooster, zodat afspraken en werk niet om aandacht strijden. De lijst links is **Wanneer** (de minikalender), **Wat** (dezelfde labelboom als Communicatie), vinkjes per persoon en agent, plus je Google- of Outlook-agenda's. **Sync** haalt de afgelopen 90 dagen en de komende 180 dagen op. Agenda's die uit staan tonen **Uit**; aanzetten start de synchronisatie. **Vandaag** springt terug naar de huidige dag, en het zoekveld filtert de periode die je bekijkt.

## Zie wat er wanneer gebeurt

![Agenda-weekweergave](/api/docs/assets/agenda/week.png)
*Week toont afspraken uit gekoppelde agenda's, taken en activiteit per dag.*

1. Open **Agenda**. Het hulp-icoon naast de titel in de bovenbalk opent deze gids. **Dag** is de standaard; wissel op dezelfde rij als **Nieuw** naar **Week**, **Maand** of **Lijst**, of druk op D, W, M of L.
2. Gebruik **Vandaag** en de pijlen (of de pijltjestoetsen) om door de tijd te bewegen. In **Lijst** begint de huidige dag bovenaan; scroll omhoog voor eerdere dagen, kies een datum op de minikalender onder **Wanneer**, of gebruik **Terug naar boven** na omlaag scrollen. De rail blijft zichtbaar terwijl de lijst scrollt.
3. Links blijft de minikalender vast staan. Sleep daaronder de sectiekoppen (**Wat**, personen, agents, **Agenda's**) om de volgorde te wijzigen. **Wat** is dezelfde labelboom als Communicatie: één actieve tak filtert taken en activiteit die aan een gesprek hangen. Gekoppelde agenda's negeren die filter. Vink mensen en agents aan of uit zoals bij agenda's. Zet elke Google- of Outlook-agenda aan of uit onder **Agenda's**. Het plusje naast **Agenda's** opent Koppelingen gefilterd op agenda's.
4. Kies een item om rechts de details te openen, met wie verantwoordelijk is (een persoon, een team of een agent), en links naar het gesprek, de map of de agent.

## Handel wat aandacht vraagt

1. Het getal naast **Agenda** in de linkerrail telt openstaande taken op open gesprekken die aan jou zijn toegewezen. **Vandaag** toont dezelfde items onder **Lopend en straks**.
2. De balk **Voor jou** boven de agenda telt openstaande taken en mislukte runs. Kies een telling om die items samen te zien.
3. Open een taak om het gesprek, de eigenaar en het moment te zien. Bij een terugkerende fase-opvolging kies je **Nu checken** om hem direct te starten, of **Pauzeren** om hem te stoppen.
4. Druk overal op Ctrl+K (Cmd+K op Mac) en kies **Openstaande taken**.

## Volg tickets op vanuit een werk

1. Open een Werk en kies **Bewerken**. Elke fase heeft een **Eigenaar** (een persoon, agent of team, of **Huidige eigenaar houden**) en een **Check-up**-ritme (**Uit**, uren, dagen of een week).
2. Komt een ticket in die fase, dan maakt Agenda een terugkerende taak voor wie het gesprek bezit. Agents pakken hem op als wake; mensen zien hem in hun agenda en krijgen het gesprek ongelezen wanneer hij due is.
3. Het ticketpaneel in Communicatie toont wanneer de volgende opvolging is. Een Werk met check-ups linkt onder de titel naar **Check-ups in Agenda**. Zie [Werk](/docs/ai/flows).
4. Een ticket met een deadline staat op die datum als item voor de hele dag met **Deadline**, de bron en de eigenaar; een te late blijft gemarkeerd tot het ticket klaar is. Bij de deadline komt de check-up eerder: aan het begin van de periode waarin de deadline nadert, de dag ervoor en op de dag zelf, daarna dagelijks als de datum voorbij is.
5. Op een contactpagina toont elk gesprek zijn label, fase en volgende geplande taak.

## Plan een agenda-item of terugkerende taak

Elk agenda-item is een gesprek met een datum. Met een herhaling wordt het een terugkerende taak: de agent schrijft elke keer in dat ene gesprek, zodat de geschiedenis bij elkaar blijft.

1. Kies **Nieuw** en daarna **Agenda-item**, **Terugkerende taak**, **Webhook** of **Agendablok**.
2. Vul voor een agenda-item of terugkerende taak **Titel**, **Wanneer** (**Eén moment** of **Herhalen**, bijvoorbeeld **Elke werkdag** om 09:00), **Voor wie** (standaard **Ik**, of een collega, agent of afdeling) in. Kies je een agent, dan vul je een **Opdracht voor de agent** in en voert die agent hem op het moment uit; anders komt het gesprek ongelezen terug bij wie je koos. Kies **Opslaan**.
3. Een agenda-item kiezen opent het gesprek in Communicatie, waar je de datum wijzigt, de herhaling pauzeert of **Nu uitvoeren** kiest. Agenda-afspraken hebben **Open als gesprek** om ze met collega's of een agent te bespreken.
4. Voor een agendablok kies je de **Agenda**, titel, start en eind. Zet **Hele dag** aan om hem in de bovenste rij onder de datumheaders te zetten.
5. **Taken** en **Activiteit** onder **Tonen**, en elke gekoppelde agenda die je aanzet, staan in het rooster op hun eigen tijd. Beheer terugkerende taken links onder **Taken beheren**.

Vanuit een gesprek plan je op dezelfde manier: kies **Plannen** in het gespreksmenu. Zie [Communicatie](/docs/inbox/communication). Agents plannen ook werk: vraag er een in een gesprek om "dit vrijdag opnieuw te bekijken" of "stuur me elke maandag een overzicht van open offertes". Afhankelijk van je [autonomiehouding](/docs/govern/autonomy) wordt het plan direct aangemaakt of komt het eerst als beslissing in Communicatie.

## Krijg een ochtendbriefing per afdeling

De leidende agent van elke afdeling kijkt elke werkdag naar het werk en zegt wat aandacht vraagt.

1. Zet de check-in aan: in de [setupgids](/docs/getting-started/setup-guide) heeft **Laat de assistent waken** de knop **Check-in aanzetten**, of vraag het de assistent. Elke afdeling met een **Leidende agent** krijgt dan een oriëntatie in plaats van de uurlijkse check-in: werkdagen om 07:30 in het afdelingsgesprek.
2. De briefing noemt tickets over hun deadline, tickets die langer op een klant wachten dan de check-up van de fase, verplichte velden of checklistpunten die nog open staan, mensen die boven hun **Uren per week** zijn ingepland, en koppelingen die opnieuw verbonden moeten worden.
3. Op maandag kijkt de briefing ook hoe de scorekaarten van het werk bewogen en noemt een verbetering om te proberen.
4. De oriëntatie staat in de **Agenda** onder routines en in het afdelingsgesprek als volgende wake.

## Krijg trends per klant

Een afdeling die naar buiten kijkt, zoals Research, kijkt in plaats daarvan eens per week buiten.

1. Op maandag om 08:00 leest de leider van Research de klantmappen met een doc **Profiel**, en zoekt op het web wat er voor die klanten veranderde.
2. Voor elke klant waarbij een trend past, opent die een intern gesprek met label `trend` in de map van die klant: voor wie, waarom, hoe je het inzet, en de bronnen.
3. Open de map in [Communicatie](/docs/inbox/communication) of filter op `trend` om ze te lezen. Reageer in het gesprek om er werk van te maken, of sluit het.

## Toon je Google- of Outlook-agenda's

1. Kies het plusje naast **Agenda's**. Dat opent **Koppelingen** gefilterd op agenda's. Kies onder **Agenda-accounts** **Google Calendar koppelen** of **Outlook Calendar koppelen**.
2. Rond de aanmelding af. Onder **Beheren** bij het account zet je aan welke provider-agenda's synchroniseren. Elke aangezette agenda wordt een **workspace-agenda**: sync uit, labels voor filters in Agenda, en wie **gebruiken** (afspraken zien) of **beheren** (sync, tags en toegang wijzigen) mag.
3. In Agenda staan onder elk account de agenda's met kleur en schakelaar. Label-chips op een agenda filteren het raster op agenda's met die tag. Verbergen op dit apparaat wijzigt geen gedeelde sync of toegang.
4. Kies een afspraak om de agenda, het account en de details te zien. **Bewerken** en **Verwijderen** verschijnen alleen als je een schrijfbare agenda mag gebruiken.
5. Toont een account **Opnieuw inloggen**, dan is de aanmelding verlopen. Kies het en rond de aanmelding af; afspraken blijven tot dan zichtbaar.

De Google- of Outlook-koppeling houdt de aanmelding; elke workspace-agenda heeft een eigen toegangslijst. Zie [Koppelingen](/docs/integrations/integrations).

## Wat nu

Afgeronde runs verschijnen onder [Agent-runs](/docs/inbox/agent-runs). Elke [map](/docs/ai/folders) (een bewaarde tag-filterset) filtert Agenda op dezelfde manier als Communicatie.
