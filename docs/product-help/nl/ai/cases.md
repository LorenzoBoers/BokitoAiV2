---
title: Categorieën en tickets
intro: Elk gesprek heeft één categorie die zegt waar het over gaat. Een categorie met een draaiboek maakt van het gesprek een ticket met fases.
description: Stel categorieën in onder Signaaltypes, koppel ze aan een draaiboek voor tickets met fases, bevestig wat de AI las, en splits een gesprek als er een tweede verzoek in opduikt.
keywords: categorieën, tickets, fases, signalen, signaaltypes, intake, draaiboek, gesprek splitsen, cases
sort: 46
related: workstreams,communication,widget,projects,integrations
---

# Categorieën en tickets

Een categorie zegt waar een gesprek over gaat, en elk gesprek heeft er precies één. Beheer de lijst onder **Instellingen** → **Signaaltypes**; elk inkomend bericht wordt ertegen gelezen voordat er een antwoord wordt opgesteld, dus herkenning draait ook als AI-antwoorden gepauzeerd zijn.

Elke categorie heeft een uitkomst. **Alleen label** markeert het gesprek voor filteren en rapportage. **Ticket** koppelt de categorie aan een draaiboek: het gesprek wordt een ticket dat door de fases van dat draaiboek gaat, en elke fase telt als open, wachtend of klaar. Een zekere lezing zet de categorie meteen, een onzekere lezing wordt een bevestigingschip op het gesprek, en een bericht dat nergens bij past telt mee onder **Wat we misten**.

## Een categorie toevoegen

1. Open **Instellingen** en daarna **Signaaltypes**.
2. Kies **Nieuw type**. Vul onder **Wat het is** een **Naam** in (bijvoorbeeld Terugbetaling) en beschrijf wanneer het van toepassing is, en wanneer niet. Agents lezen die tekst om te classificeren.
3. Kies onder **Wat we doen** voor **Alleen label** of **Ticket**. Kies bij een ticket het **Draaiboek** en eventueel een **Project**. Zet **Start het draaiboek direct** aan als elk nieuw ticket een run moet starten.
4. Zet onder **Hoe het wordt vastgelegd** de optie **Als de AI het herkent** op **Vraag klant**, **Vraag operator**, **Automatisch** of **Alleen handmatig**, en kies de **Doelgroep**.
5. Kies **Type toevoegen**. Een categorie die gesprekken al gebruiken verwijderen archiveert haar, zodat de geschiedenis heel blijft.

## De fases van een ticket instellen

1. Open het draaiboek waaraan een ticketcategorie gekoppeld is.
2. Voeg in de kaart **Ticketfases** een fase per stap toe (bijvoorbeeld Nieuw, Wacht op onderdelen, Opgelost) en zet de **Soort fase** op open, wachtend of klaar. Houd minstens één klaar-fase.
3. Kies bij een stap van het draaiboek een **Fase** zodat het ticket daarheen gaat zodra die stap start, of laat **Fase behouden** staan.
4. De status van een ticket volgt altijd de soort van zijn fase, zodat de wachtrij en projectborden kloppen zonder extra administratie. Zie [Draaiboeken](/docs/ai/workstreams).

## De categorie van een gesprek bevestigen of wijzigen

1. Open een gesprek in **Communicatie**. Het zijpaneel toont de categorie onder **Dit gesprek**; de rij in de lijst toont haar als kleine chip, met de fase en een gekleurde stip voor tickets.
2. Een onzekere lezing toont "Dit lijkt op Factuurvraag — bevestigen?". Kies **Bevestigen** om haar te accepteren of **Afwijzen** als ze niet klopt. Er wordt niets doorgezet en er start geen draaiboek voordat je bevestigt.
3. Kies **Categorie wijzigen** om een andere te kiezen. Open bij een ticket het fasemenu om het naar een andere fase te zetten. Elke wijziging staat in de tijdlijn, bijvoorbeeld **Ticket verplaatst naar Wacht op onderdelen**.
4. De categorie staat ook vooraan, met een slotje, in de rij **Tags**. Tags zijn vrije labels bovenop de categorie; zie [Communicatie](/docs/inbox/communication).

## Een nieuw verzoek afsplitsen

Als een klant iets nieuws aankaart in een oud gesprek, krijgt het nieuwe verzoek een eigen gesprek zodat elk gesprek één categorie houdt.

1. Beweeg over het bericht waar het nieuwe verzoek begint en kies **Hier splitsen**.
2. Kies de **Categorie voor het nieuwe gesprek**, of **Later bepalen**, en daarna **Splitsen**.
3. Dat bericht en alles erna gaan naar een nieuw gesprek met hetzelfde contact en kanaal. Beide tijdlijnen tonen de koppeling, en latere antwoorden in dezelfde e-mailthread of chat komen in het nieuwe gesprek terecht.
4. Agents volgen de AI-afhandeling van het gesprek: bij **Autonoom** splitsen ze zelf, bij **Geassisteerd** stellen ze de splitsing voor als beslissing, bij **Handmatig** laten ze het aan jou.

## Een ticket openen vanuit de websitechat

1. Een bezoeker beschrijft iets wat stuk is in de [websitewidget](/docs/inbox/widget). De agent herkent **Storing** met een zekerheidsscore.
2. Vraagt de categorie de bezoeker, dan bevestigt de agent eerst. Vraagt ze het team, dan krijg je een bevestigingschip in Communicatie.
3. Na acceptatie start het ticket in de eerste fase van zijn draaiboek en verschijnt het op het projectbord als de categorie een project heeft.

## Een gemist patroon tot categorie maken

1. Open **Instellingen**, daarna **Signaaltypes**, en lees **Wat we misten**. Daar staan verzoeken die bleven binnenkomen zonder passende categorie, met hoe vaak ze gezien zijn.
2. Zet **Stel een nieuw type voor na** op het aantal keer dat een patroon gezien moet zijn voordat het klaarstaat.
3. Kies **Maak er een type van** om het aan te maken met de voorgestelde naam en omschrijving, of **Geen type** om het te laten vallen. Agents maken nooit zelf een categorie aan.
4. Kies onder **Wie mag signalen accepteren** voor **Alleen owners en admins** of **Iedereen in de workspace**.

## Wat nu

Bewaar een filter op categorie en fase als map in [Communicatie](/docs/inbox/communication). Zet de houding voor **Signalen** in [Govern](/docs/govern/govern) als agents geen categorieën meer mogen vastleggen.
