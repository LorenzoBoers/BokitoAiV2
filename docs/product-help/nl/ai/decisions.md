---
title: Beslissingen goedkeuren en afwijzen
intro: Agents vragen in het gesprek om jouw oordeel. Elke open goedkeuring staat in Communicatie onder Beslissingen.
description: Keur goed, bewerk of wijs af via de keuzekaart in het gesprek, via de map Beslissingen, Cockpit of een notificatie.
keywords: beslissingen, goedkeuringen, decision requests, notificaties, human in the loop, alles afwijzen, dubbele vragen, alles goedkeuren, altijd toestaan, niet toestaan, actiebundel
sort: 20
related: communication,agent-runs,autonomy,govern
---

# Beslissingen goedkeuren en afwijzen

Een DecisionRequest is een bericht in het gesprek, en daar handel je hem ook af. Wil je elk gesprek met een open kaart zien — klant en intern samen — open dan **Beslissingen** in de Communicatie-zijbalk.

Automatische mail (bonnen, nieuwsbrieven, no-reply-afzenders) stelt geen beslissingen. De agent noteert die stil in het gesprek. Als tipkaarten van eerdere mail zich hebben opgestapeld, open [Agents](/docs/ai/agents) en gebruik **Tipkaarten wissen**.

## Vind een wachtende beslissing

![Een wachtende beslissing in het gesprek](/api/docs/assets/decisions/approve.png)
*Open het gesprek via Beslissingen, Cockpit of een notificatie.*

1. Open **Communicatie**, dan **Beslissingen**. Cockpit **Wacht op beslissing** / **Vraagt aandacht** en het bel-menu landen op dezelfde lijst. Een badge **Wacht op beslissing** markeert de rijen.
2. Selecteer een gesprek (de eerste match opent automatisch) en scroll naar de keuzekaart. Die toont de voorgestelde actie en waarom de agent stopte.
3. Als niets op jou wacht, toont Beslissingen een lege staat met links terug naar de inbox en Agents.

## Een voorstel van een agent in de chat goedkeuren

Vraag je een agent iets te doen waar jouw OK voor nodig is, dan stelt zijn laatste bericht de vraag en staan de knoppen direct onder dat bericht. Agents kunnen objecten ook tonen zonder te vragen — tags als chips in de tekst, en showcase-kaarten onder de zin — en zetten alleen knoppen neer als ze een antwoord nodig hebben.

![Een voorstel van een agent met een item uit de prullenbak en knoppen onder het bericht](/api/docs/assets/decisions/inline-proposal.png)
*Het item dat de agent wil terugzetten staat in zijn bericht; de knoppen staan eronder.*

1. Lees het bericht van de agent. Tags zoals `#klacht` (actietag) en `#storing` (tag) staan als chips in de tekst. Objecten waar het voorstel over gaat, staan eronder als showcase-kaarten: een gesprek, item in de prullenbak, agenda-item, bestand, afbeelding, teamlid, agent, koppeling, module, hulp-artikel, bericht, flow, project of contact. Bij een open voorstel kiest een kaart die optie; zonder voorstel opent de kaart het object.
2. Kies een knop onder het bericht, bijvoorbeeld **Goedkeuren** of een label dat de agent schreef. Die keuze geldt **deze keer**. Mag je meerdere keuzes maken, selecteer dan de opties (of kaarten) en kies **Bevestigen**. **Afwijzen** zegt nee. Een keuze die tekst vraagt opent een klein veld; typ je antwoord en kies **Antwoord versturen**.
3. In een chat met de agent doet een gewoon **Ja** / **Nee** in **Vraag** hetzelfde als de bijbehorende Ja/Nee-knoppen wanneer precies één open kaart dat soort keuze is. Multi-select en tekstantwoorden blijven via de knoppen. Meerdere Ja/Nee-kaarten tegelijk ook.
4. Als de actie de agent kan leren, staat onder de knoppen **Volgende keer:** met **Dit mag je voortaan zelf**, **Altijd vragen** of **Dit nooit doen** (ook in het meer-menu). Zie *Leer de agent voor de volgende keer* hieronder.
5. Na je antwoord verschijnt jouw reply als eigen bubbel met het gekozen label en eventuele showcase-kaarten. In chats met een agent volgt een korte bevestiging als een tool al liep (bijvoorbeeld `#tag is verwijderd`); Soft Ja zonder andere open kaarten laat de agent verdergaan in het gesprek. De knoppen vouwen in tot een korte regel *Beantwoord · tijd*. Een voorstel dat de agent door een nieuwer verving, toont *Vervangen door nieuwer voorstel*.
6. Zolang de agent nog bezig is, laat *Voorstel klaarzetten...* zien dat er knoppen aankomen.

## Meerdere acties tegelijk goedkeuren

Heeft een agent in dezelfde beurt jouw OK nodig voor meer dan één wijziging (bijvoorbeeld vijf nieuwe hashtags), dan toont het gesprek één kaart met een rij per actie in plaats van een kaart per actie.

![Eén kaart met meerdere agentacties, selectievakjes en Alles goedkeuren](/api/docs/assets/decisions/action-bundle.png)
*Elke rij is één actie; keur ze allemaal goed, kies er een paar, of wijs de rest af.*

1. Lees de rijen onder het bericht van de agent. Elke rij noemt de actie in gewone woorden, bijvoorbeeld **Hashtag #vip aanmaken** of **Actietag #klacht aanmaken**, met de toolnaam als klein label. De kop telt hoeveel er nog wachten.
2. Kies **Alles goedkeuren** om elke open rij uit te voeren. Wil je een deel, vink dan de rijen aan en kies **Geselecteerde goedkeuren**; de andere blijven open. **Afwijzen** (of **Rest afwijzen**) zegt nee tegen elke rij die nog open staat.
3. Open het menu op een rij voor **Alleen nu** (alleen deze rij uitvoeren) of **Deze afwijzen**.
4. Een rij die mislukt blijft open en toont *Mislukt*; de andere houden hun resultaat. Los de oorzaak op en keur de rij opnieuw goed.
5. Zodra elke rij is beantwoord, verschijnt jouw antwoord als één bubbel (*Goedgekeurd: … · Afgewezen: …*) en toont de kaart een samenvattende regel.

## Goedkeuren, bewerken of afwijzen

1. Lees het voorstel in de context van het gesprek. Conceptantwoorden in klantgesprekken, check-ins en geplande wake-ups houden hun eigen kaart in het gesprek.
2. Kaarten gebruiken de actie die nodig is: **Goedkeuren**, **Afwijzen**, **Bewerken**, **Escaleren**, **Uitstellen**, **Later**, **Gesprek sluiten**, **Plannen** of **Open houden**. Conceptantwoord-kaarten van [AI-afhandeling](/docs/inbox/inbox-ai) gebruiken **Versturen**, **Bewerken** of **Escaleren**.
3. Een voorgesteld chatantwoord kan uit meerdere korte berichten bestaan. De kaart toont ze als **Bericht 1**, **Bericht 2** enzovoort. Kies **Bericht verwijderen** bij een bericht dat je niet wilt, of **Bewerken** om ze als één tekst te herschrijven; een lege regel start een nieuw bericht. **Versturen** levert ze op volgorde af.
4. Hover over een agentbericht: naast de bubbel verschijnen iconen voor **Klopt** of **Niet nuttig**, en het tekstballon-icoon (**Corrigeer dit**) leert de agent. Hover een icoon voor het label. Escaleren zet het gesprek op Handmatig en wijst jou toe.

## Wijs dezelfde vraag in bulk af

Wanneer een check-in of agent dezelfde vraag vaak heeft gesteld (bijvoorbeeld *Google Sheets-integratie instellen?* bij elke run), hoef je niet elke kaart apart af te wijzen.

1. Open **Communicatie**, dan **Beslissingen**. Boven de lijst toont de banner **Dezelfde vraag, veel kaarten** elke vraag die twee of meer keer wacht, met het aantal.
2. Kies **Alles afwijzen** op een rij. Elke open kaart met die titel wordt uitgesteld en verdwijnt uit Beslissingen en het belmenu; er wordt niets uitgevoerd.
3. De agent ziet een afwijzing als een nee voor dat onderwerp en stelt de vraag voorlopig niet opnieuw. Kaarten in een gesprek blijven daar zichtbaar als beantwoord; het gesprek zelf blijft open.
4. Een vraag die niet over een gesprek gaat en geen actie heeft om uit te voeren wordt niet meer als kaart gesteld: de agent schrijft die in zijn eigen kanaal. Vraagt een agent iets over een gesprek, dan noemt hij het onderwerp en landt de kaart op dat gesprek.

## Leer de agent voor de volgende keer

Elk oordeel geldt voor **deze agent en deze actie**: Mila mag zelf hashtags aanmaken, terwijl Otto nog vraagt.

1. Op een kaart die vraagt voor een actie biedt de rij **Volgende keer:** de keuzes. Onder een agentbericht staan ze in het menu **Meer opties**; op een kaart met meerdere acties open je het menu op een rij en kijk je onder **Volgende keer, {agent}:**. Is een eerder concept opzij gezet omdat de persoon elders verderging, dan biedt de afgehandelde regel **Actief openen** om naar dat gesprek te springen.
2. **Altijd toestaan voor {agent}** (of **Dit mag je voortaan zelf**) laat de agent deze actie zonder vragen uitvoeren; staat de rij nog open, dan voert hij hem ook nu uit. **Altijd vragen** blijft vragen. **Niet toestaan** (of **Dit nooit doen**) blokkeert de actie voor deze agent; een open rij wordt afgewezen.
3. Als owner of admin geldt de regel op het moment dat je kiest en staat hij op [Govern](/docs/govern/govern) **Ledger** als toegepaste wijziging die je kunt terugdraaien. Als member komt de regel als Govern-concept dat een owner of admin bevestigt.
4. **Weet ik nog niet** bewaart het geval als voorbeeld. Na een paar voorbeelden stelt de agent er zelf een regel uit voor.
5. Een nieuw oordeel over dezelfde agent en actie vervangt de oude regel. Regels staan op Govern **Beleid** onder **Per agent: altijd, vragen, nooit** en op de agent onder **Regels** (zie [Agents](/docs/ai/agents)); verwijder er een om de agent weer te laten vragen.

## Wie de vraag krijgt

Elke vraag gaat naar één geadresseerde: de persoon of het team in **Vragen stellen aan** van de agent, anders de eigenaar van het gesprek, anders wie het werk overdroeg, anders het eigenaarsteam. Wie afwezig is, wordt overgeslagen. Beantwoordt één persoon steeds de vragen over hetzelfde onderwerp, dan stelt Govern een routeringsregel voor zoals *Vragen over facturen naar Lisa*; na akkoord gaan die vragen eerst naar die persoon.

## Antwoorden vanuit een notificatie

1. Kies de beslissing in het belmenu, of open de pushmelding op je telefoon. Beide openen Beslissingen op dat gesprek en springen direct naar de wachtende kaart.
2. Open **Technisch** op de kaart voor de bronregel: die noemt waar de vraag vandaan komt — een projectqueue, een agentrun of een voorgestelde workspacewijziging — en linkt ernaartoe, samen met de geadresseerde en het beslissings-id.
3. Antwoord in het gesprek. Geassisteerde concepten hebben nog een menselijke verzending nodig; alleen autonome gesprekken versturen zelf.
4. Onder **Instellingen**, daarna **Notificaties**, gebruik je de matrix. Elke sectie (**Aflevering**, **Gesprekken**, **Workspace**, **Overzicht**) heeft in de sectiekop een masterschakelaar per kolom. Een melding komt alleen aan als zowel het niveau als de gebeurtenis aan staat. Zet **Wanneer een nieuw bericht binnenkomt op een gesprek van jou of je team** aan om nieuwe mail te horen. **Push** aanzetten vraagt zo nodig om toestemming in deze browser; na inloggen kan Bokito eenmaal een zachte banner **Push aanzetten** tonen.

## Werk aan een codingtool geven

Wanneer een agent voorstelt codingwerk aan Cursor, Claude Managed Agents of Devin te geven, keur je die Beslissing goed zoals elke andere. Na goedkeuring blijven voortgang en vervolgvragen in hetzelfde gesprek — zie [Geef werk aan een codingtool](/docs/developers/workbench).

## Wanneer agents vragen

De workspace-[autonomiehouding](/docs/govern/autonomy) zet de standaard. Op [Govern](/docs/govern/govern) **Beleid** is elke toolcategorie **Weigeren**, **Eerst vragen** of **Toestaan**. **Eerst vragen** maakt de kaart die je in het gesprek ziet. Overrides per agent op de agentpagina winnen van de categorie.

Begin met **Assisted**. Verplaats stappen die je altijd goedkeurt naar **Toestaan**. Houd **Eerst vragen** voor de risicovolle.

## Wat nu

Structurele workspace-wijzigingen wachten op Govern **Openstaande reviews**, niet in het gesprek. Audit later onder Govern **Recente audit**.
