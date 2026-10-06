---
title: AI-afhandeling instellen
intro: Kies of de AI zelf antwoordt, concepten ter controle maakt of stil blijft — een keer voor de workspace, met uitzonderingen per kanaal, contact of gesprek.
description: Stel AI-afhandeling in (Autonoom, Geassisteerd, Handmatig), met lagen, waarborgen, vermelding, antwoordtaal en afzender.
keywords: ai-afhandeling, autonoom, geassisteerd, handmatig, concepten, automatisch antwoorden, waarborgen, vermelding, antwoordtaal, afzender, zekerheid, automatische mail, automatiseringsregel, geen antwoord nodig
sort: 25
related: communication,contacts,channels,govern,autonomy,agents
---

# AI-afhandeling instellen

AI-afhandeling is een instelling met drie modi: **Autonoom** (AI antwoordt zelf), **Geassisteerd** (AI stelt antwoorden en acties voor, een mens verstuurt) en **Handmatig** (AI blijft stil). Je stelt het een keer in voor de workspace en alleen opnieuw waar een kanaal, een contact of een enkel gesprek moet afwijken — de meest specifieke instelling wint.

Overal zie je dezelfde iconen: een bliksem voor Autonoom en een pen voor Geassisteerd (beide paars), en een hand voor Handmatig (grijs). [Govern](/docs/govern/govern) bepaalt het plafond: niets daaronder kan autonomer zijn dan Govern toestaat. Elke agent heeft ook een eigen plafond (zie [Agents](/docs/ai/agents)): een gesprek dat de agent afhandelt komt daar nooit boven, en de keuzelijst laat dat zien.

## De workspace-standaard instellen

![Workspace-standaard voor AI-afhandeling](/api/docs/assets/inbox-ai/workspace-default.png)
*Drie kaarten: Autonoom, Geassisteerd en Handmatig.*

1. Open **Instellingen** en daarna **AI-afhandeling**.
2. Kies onder **Workspace-standaard** **Autonoom**, **Geassisteerd** of **Handmatig**. De wijziging wordt direct opgeslagen.
3. Bij **Autonoom** zie je eerst een bevestiging met hoeveel open gesprekken deze instelling volgen en hoe vaak concepten recent ongewijzigd zijn verstuurd. Alleen een eigenaar of beheerder kan Autonoom aanzetten.
4. Onder de kaarten toont het **Plafond** de Govern-grens. Kies **Autonome antwoorden pauzeren** om in één stap elk gesprek op Geassisteerd te begrenzen; **Autonome antwoorden toestaan** heft dat weer op. Open **Govern-plafond** via de notitie wanneer je de workspace-houding of Berichten-toestemming wilt wijzigen.

Begin met **Geassisteerd**. Bokito stelt Autonoom voor zodra minstens 80% van 50 of meer concepten ongewijzigd wordt verstuurd.

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

De tijdlijn toont een regel zoals **Concept in plaats van verzonden** met de reden wanneer een waarborg ingrijpt.

Antwoorden volgen het kanaal. E-mail krijgt één gestructureerd bericht. Op WhatsApp en websitechat schrijft de AI zoals een mens in een chat: maximaal vijf korte berichten, op volgorde verstuurd met een korte typpauze, en de AI-vermelding alleen bij het eerste. Mislukt één bericht, dan wachten de rest. Bij **Geassisteerd** bevat de conceptkaart dezelfde berichten, zodat je ze kunt verwijderen of aanpassen voordat je **Versturen** kiest (zie [Beslissingen](/docs/ai/decisions)).

## Antwoord- en teamtaal instellen

1. Open **Taal** op dezelfde pagina.
2. **Antwoordtaal** is wat de klant ziet. **Automatisch (volg de klant)** volgt de taal van het binnenkomende bericht. Je kunt ook Nederlands, Engels, Duits, Frans of Spaans vastzetten.
3. **Teamtaal** is voor toelichting aan je team (samenvattingen, uitleg bij no-reply). Het verandert het klantantwoord niet.
4. **Goedgekeurde antwoorden versturen als** is **Het goedkeurende teamlid** of **De AI-agent**. Dat bepaalt de handtekening en de weergavenaam bij Van. Op een enkel concept kan iedereen nog **Versturen als** wisselen.
5. Klap onder **Antwoordtaal per mailbox** een mailbox open om die een eigen antwoordtaal te geven. Rijen met een afwijking tonen een badge **Afwijkend**.

## Wanneer de AI niet antwoordt

- Ergens in de keten staat **Handmatig**, of een collega heeft het gesprek overgenomen.
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
5. Op een mailbox met **Automatische mail archiveren** aan wordt die kaart overgeslagen: het gesprek sluit bij binnenkomst en krijgt de tag `#automated`. Stel het per mailbox in onder [Kanalen](/docs/inbox/channels).
6. Komt de derde no-reply mail van dezelfde afzender binnen, dan stelt de AI een **Automatiseringsregel** voor die afzender voor als kaart in het gesprek (*Mail van newsletter@example.com automatisch sluiten?*). **Activeren** zet de regel aan onder **Automatiseringsregels**; **Later** houdt hem als concept. Een agent die zelf een regel voorstelt gebruikt dezelfde kaart, zodat regels nooit zonder persoon actief worden.

Dezelfde modus bepaalt wie een onbekende chatter is. Geeft een bezoeker een e-mail of telefoonnummer, dan koppelt **Autonoom** het gesprek aan het passende contact (of maakt er een aan), koppelt **Geassisteerd** alleen bevestigde adressen en vraagt je voor de rest, en laat **Handmatig** het koppelen aan jou. Zie [Een gesprek aan een contact koppelen](/docs/inbox/contacts).

## Wat nu

Vul [Kennis](/docs/ai/knowledge) zodat concepten onderbouwd blijven. Zet **Wie antwoordt** op [Kanalen](/docs/inbox/channels) wanneer een kanaal de workspace-standaardagent moet overslaan — dat is routering, geen AI-afhandeling.
