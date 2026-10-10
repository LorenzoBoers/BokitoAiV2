---
title: AI-afhandeling instellen
intro: Kies of de AI zelf antwoordt, concepten ter controle maakt of stil blijft — een keer voor de workspace, met uitzonderingen per kanaal, contact of gesprek.
description: Stel AI-afhandeling in (Autonoom, Geassisteerd, Handmatig), met lagen, waarborgen, overdracht tussen agent en mensen, vermelding, antwoordtaal en afzender.
keywords: ai-afhandeling, autonoom, geassisteerd, handmatig, concepten, automatisch antwoorden, waarborgen, overdracht, eigenaar, terug naar de agent, pingpong-limiet, sluiten na antwoord, heropenen, vermelding, antwoordtaal, afzender, zekerheid, automatische mail, automatiseringsregel, geen antwoord nodig
sort: 25
related: communication,contacts,channels,govern,autonomy,agents
---

# AI-afhandeling instellen

AI-afhandeling is een instelling met drie modi: **Autonoom** (AI antwoordt zelf), **Geassisteerd** (AI stelt antwoorden en acties voor, een mens verstuurt) en **Handmatig** (geen concept of verzenden naar de klant; de gekoppelde kanaalagent mag het gesprek nog wel lezen, samenvatting en prioriteit zetten, en tags of tickets vastleggen). Je stelt het een keer in voor de workspace en alleen opnieuw waar een kanaal, een contact of een enkel gesprek moet afwijken — de meest specifieke instelling wint. Zonder **AI-agent** op het kanaal is er geen inbound-interpretatie of antwoord.

Overal zie je dezelfde iconen: een bliksem voor Autonoom en een pen voor Geassisteerd (beide paars), en een hand voor Handmatig (grijs). [Govern](/docs/govern/govern) bepaalt het plafond: niets daaronder kan autonomer zijn dan Govern toestaat. Elke agent heeft ook een eigen plafond (zie [Agents](/docs/ai/agents)): een gesprek dat de agent afhandelt komt daar nooit boven, en de keuzelijst laat dat zien.

## De workspace-standaard instellen

![Workspace-standaard voor AI-afhandeling](/api/docs/assets/inbox-ai/workspace-default.png)
*Drie kaarten: Autonoom, Geassisteerd en Handmatig.*

1. Open **Instellingen** en daarna **AI-afhandeling**.
2. Kies onder **Workspace-standaard** **Autonoom**, **Geassisteerd** of **Handmatig**. De wijziging wordt direct opgeslagen.
3. Bij **Autonoom** zie je eerst een bevestiging met hoeveel open gesprekken deze instelling volgen en hoe vaak concepten recent ongewijzigd zijn verstuurd. Alleen een eigenaar of beheerder kan Autonoom aanzetten.
4. Onder de kaarten toont het **Plafond** de Govern-grens. Kies **Autonome antwoorden pauzeren** om in één stap elk gesprek op Geassisteerd te begrenzen; **Autonome antwoorden toestaan** heft dat weer op. Open **Govern-plafond** via de notitie wanneer je de workspace-houding of Berichten-toestemming wilt wijzigen.

Begin met **Geassisteerd**. Bokito stelt Autonoom voor zodra minstens 80% van 50 of meer concepten ongewijzigd wordt verstuurd. Op een geassisteerd kanaal toont de rij AI-afhandeling hoeveel van die 50 concepten ongewijzigd zijn verstuurd.

## Uitzonderingen bekijken

1. Open op dezelfde pagina **Uitzonderingen**. Daar staan alle kanalen, contacten en open gesprekken die de workspace-standaard niet volgen, gegroepeerd per laag.
2. Elke rij toont het icoon van de modus en de naam. Kies **Weer de standaard volgen** om de uitzondering te verwijderen. Een geactiveerde noodrem toont **Autonoom hervatten** op de kanaalrij.
3. Nieuwe uitzonderingen zet je waar je werkt: op het kanaal onder [Kanalen](/docs/inbox/channels), op een contact onder [Contacten](/docs/inbox/contacts), of in de kop van een gesprek in [Communicatie](/docs/inbox/communication).

Een uitzondering op een gesprek geldt tot het gesprek sluit. Uitzonderingen op kanalen en contacten blijven tot je ze wist.

## Waarborgen voor autonome antwoorden instellen

1. Open **Waarborgen**. Elke waarborg maakt van een enkel autonoom antwoord een concept ter controle; er wordt nooit meer verstuurd.
2. Stel de **Zekerheidsdrempel** in (1–10, van **soepel** tot **strikt**). Onder die zekerheid wordt het antwoord een concept.
3. Zet **Antwoorden aan nieuwe contacten controleren** aan om concepten te maken zolang een contact op goedkeuring wacht. Websitechatbezoekers zijn uitgezonderd.
4. Zet **AI-antwoorden vermelden** aan om autonome antwoorden een korte vermelding te geven. Pas de **Tekst van de vermelding** aan of laat leeg voor de standaardtekst; de preview toont wat klanten zien.
5. Stel onder **Noodrem** **Autonome antwoorden per uur per kanaal** en **Negatieve signalen per uur per kanaal** in. Een geactiveerd kanaal draait Geassisteerd tot iemand het hervat via Uitzonderingen of het kanaal.
6. Wijzigingen worden automatisch opgeslagen. **Laatst gewijzigd** in de paginakop toont wanneer de laatste opslag klaar was.

## Actietags die altijd controle nodig hebben

1. Open op dezelfde pagina **Actietags die altijd controle nodig hebben**.
2. Zet **Altijd controleren** aan voor een actietag. Antwoorden op een ticket met die tag worden een concept, ook als het gesprek Autonoom is.
3. Zet het uit (**Mag versturen**) wanneer autonoom versturen voor die tag goed is.

De tijdlijn toont een regel zoals **Concept in plaats van verzonden** met de reden wanneer een waarborg ingrijpt. Dezelfde regel verschijnt met **de agent is geen eigenaar van dit gesprek** wanneer een medewerker of team het gesprek bezit (de agent maakt dan een concept voor hen) en met **een collega typt een antwoord** wanneer iemand op dat moment in de composer schrijft.

Antwoorden volgen het kanaal. E-mail krijgt één gestructureerd bericht. Op WhatsApp en websitechat schrijft de AI zoals een mens in een chat: maximaal vijf korte berichten, op volgorde verstuurd met een korte typpauze, en de AI-vermelding alleen bij het eerste. Mislukt één bericht, dan wachten de rest. Bij **Geassisteerd** bevat de conceptkaart dezelfde berichten, zodat je ze kunt verwijderen of aanpassen voordat je **Versturen** kiest (zie [Beslissingen](/docs/ai/decisions)).

## Overdracht tussen agent en mensen instellen

AI-afhandeling zegt wat de agent mag doen; de eigenaar zegt wie er nu aan zet is. De agent is eigenaar zolang hij de volgende stap heeft: op een kanaal met **Autonoom** beantwoordt hij nieuwe gesprekken zelf; met **Geassisteerd** pakt hij ze op, zoekt context, maakt een concept of keuzekaart en geeft het gesprek dan aan een persoon (de tijdlijn toont **Concept klaar: {naam} is aan zet**). Hij draagt ook over wanneer de klant om een medewerker vraagt, wanneer een waarborg of beslissing escaleert, of wanneer iemand overneemt. Deze regels bepalen wat er rond die overdracht gebeurt.

1. Open op dezelfde pagina **Overdracht tussen agent en mensen**.
2. Kies onder **Na een antwoord van een medewerker** voor **Terug naar de agent** (de agent wordt weer eigenaar en pakt het volgende bericht van de klant op: zelf beantwoorden bij Autonoom, een concept voor jou bij Geassisteerd; de standaard), **Blijft bij de medewerker** (wie antwoordt wordt eigenaar en de agent maakt concepten voor die persoon) of **Vraag bij versturen** (het verstuurmenu in het gesprek biedt **Versturen en teruggeven aan {agent}** en **Versturen en zelf houden**).
3. Zet **Sluiten na een autonoom antwoord** aan om een gesprek te sluiten zodra een autonoom antwoord is verzonden, of **Sluiten na een antwoord van een medewerker** om **Versturen** standaard te laten sluiten; het verstuurmenu biedt dan **Versturen en open laten**. Een nieuw bericht van het contact heropent een gesloten gesprek.
4. Kies onder **Eigenaar bij heropenen** voor **Zelfde eigenaar** (de laatste eigenaar krijgt het heropende gesprek; is die persoon geen lid meer, dan valt het terug op de contacteigenaar of het kanaalteam) of **Opnieuw routeren** (het heropende gesprek wordt gerouteerd als een nieuw gesprek).
5. Stel de **Pingpong-limiet** in: hoe vaak per dag een gesprek tussen de agent en mensen mag wisselen. Daarna blijft het bij mensen tot iemand het expliciet teruggeeft, en toont het gesprek een notitie van de agent. 0 zet de limiet uit.
6. Overschrijf elke regel behalve de pingpong-limiet per kanaal onder [Kanalen](/docs/inbox/channels), sectie **Overdracht**. Een kanaalwaarde toont de badge **Bedrijfsstandaard** tot het kanaal een eigen regel kiest.

Wanneer de agent een gesprek aan mensen overdraagt, kiest hij de eigenaar in deze volgorde: de persoon die de agent of beslissing noemt, een geleerde routeringsregel, de laatste persoon of het laatste team dat het gesprek behandelde, de eigenaar van het contact (zie [Contacten](/docs/inbox/contacts)), het eigenaarsteam van het kanaal, Alle mensen. Het gesprek krijgt een interne notitie van de agent met de reden, en **Overnemen** blijft altijd een harde stop tot iemand **Teruggeven aan AI** kiest.

## Antwoord- en werktaal instellen

1. Open **Taal** op dezelfde pagina, of zet de organisatie-werktaal onder **Instellingen → Algemeen**.
2. **Antwoordtaal** is wat de klant ziet. **Automatisch (volg de klant)** volgt de taal van het binnenkomende bericht. Je kunt ook Nederlands, Engels, Duits, Frans of Spaans vastzetten.
3. **Werktaal van de organisatie** (teamtaal) is de taal waarin agents voor je team schrijven, denken en uitleg geven — operatorchats, samenvattingen, beslissingen en thinking. Het verandert het klantantwoord niet.
4. **Goedgekeurde antwoorden versturen als** is **Het goedkeurende teamlid** of **De AI-agent**. Dat bepaalt de handtekening en de weergavenaam bij Van. Op een enkel concept kan iedereen nog **Versturen als** wisselen.
5. Klap onder **Antwoordtaal per mailbox** een mailbox open om die een eigen antwoordtaal te geven. Rijen met een afwijking tonen een badge **Afwijkend**.

## Wanneer de AI niet antwoordt

- Ergens in de keten staat **Handmatig**, of een collega heeft het gesprek overgenomen.
- Een medewerker of team bezit het gesprek (bijvoorbeeld na **Blijft bij de medewerker**): de agent maakt dan een concept voor hen in plaats van te versturen.
- Govern begrenst gesprekken op Geassisteerd (berichten op vragen) of Handmatig (berichten geweigerd).
- **Privacy** houdt AI weg van berichtinhoud; AI-afhandeling toont dan Handmatig.
- De noodrem van het kanaal is geactiveerd na ongewone activiteit; het kanaal draait Geassisteerd tot iemand het hervat.
- De mailbox moet nog ingesteld of opnieuw gekoppeld worden. Het gesprek krijgt dan een **Interne notitie** met een verwijzing naar **Instellingen → Kanalen** in plaats van een concept.

Beweeg over de modus in de kop van het gesprek om te zien welke laag besliste en waarom.

## Geen antwoord nodig

Niet elke mail wil een antwoord. Bonnetjes, deploy-meldingen en andere automatische mail krijgen een actiekaart in plaats van een concept, en een voorstel blijft alleen staan zolang het het laatste bericht beantwoordt.

1. Besluit de AI dat er geen antwoord nodig is, dan toont het gesprek een actiekaart met **Sluiten** en **Open houden** in plaats van een concept, en opent de composer op **Notitie**. De samenvatting van de AI in één regel (bijvoorbeeld **GitHub deploy geslaagd**) staat in de kaart. Een model dat eerst uitlegt eindigt nog steeds in die kaart; uitlegtekst verschijnt nooit als concept.
2. De AI houdt per persoon één antwoordvoorstel. Schrijft dezelfde persoon ook op een ander kanaal, dan gaat het voorstel van het oudere gesprek opzij (**Opzijgezet: nieuwer gesprek met deze persoon**) en draagt het nieuwste gesprek het actuele voorstel.
3. Een voorstel dat het laatste bericht niet meer beantwoordt gaat ook opzij: als de klant opnieuw schrijft voordat je verstuurt (**klant schreef opnieuw**), als een collega vanuit de eigen mailbox antwoordde (**een collega antwoordde**), of als iemand **Al afgehandeld buiten Bokito** vastlegde. Een run die klaar is nadat een nieuwer bericht binnenkwam plaatst zijn concept niet.
4. De composer vertelt wanneer een bewaard concept verouderd is en biedt **Opnieuw voorstellen**; zie [Communicatie](/docs/inbox/communication).
5. Blijf je in het gesprek terwijl de agent een concept afrondt, dan komt die tekst in de reply-composer. In de tijdlijn staat **Antwoord voorgesteld**: open de chevron om te lezen, of kies **Overnemen** / **In de invoer** om hem opnieuw in de invoer te zetten nadat je een ander gesprek hebt geopend. Teamnotities van het model vullen nooit het klantconcept.
6. Op een mailbox met **Automatische mail archiveren** aan wordt die kaart overgeslagen: het gesprek sluit bij binnenkomst en krijgt de tag `#automated`. Stel het per mailbox in onder [Kanalen](/docs/inbox/channels).
7. Komt de derde no-reply mail van dezelfde afzender binnen, dan stelt de AI een **Automatiseringsregel** voor die afzender voor als kaart in het gesprek (*Mail van newsletter@example.com automatisch sluiten?*). **Activeren** zet de regel aan onder **Automatiseringsregels**; **Later** houdt hem als concept. Een agent die zelf een regel voorstelt gebruikt dezelfde kaart, zodat regels nooit zonder persoon actief worden.

Dezelfde modus bepaalt wie een onbekende chatter is. Geeft een bezoeker een e-mail of telefoonnummer, dan koppelt **Autonoom** het gesprek aan het passende contact (of maakt er een aan), koppelt **Geassisteerd** alleen bevestigde adressen en vraagt je voor de rest, en laat **Handmatig** het koppelen aan jou. Zie [Een gesprek aan een contact koppelen](/docs/inbox/contacts).

## Wat nu

Vul [Kennis](/docs/ai/knowledge) zodat concepten onderbouwd blijven. Zet **Wie antwoordt** op [Kanalen](/docs/inbox/channels) wanneer een kanaal de workspace-standaardagent moet overslaan — dat is routering, geen AI-afhandeling.
