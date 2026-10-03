---
title: AI-afhandeling instellen
intro: Kies of de AI zelf antwoordt, concepten ter controle maakt of stil blijft — een keer voor de workspace, met uitzonderingen per kanaal, contact of gesprek.
description: Stel AI-afhandeling in (Autonoom, Geassisteerd, Handmatig), met lagen, waarborgen, vermelding, antwoordtaal en afzender.
keywords: ai-afhandeling, autonoom, geassisteerd, handmatig, concepten, automatisch antwoorden, waarborgen, vermelding, antwoordtaal, afzender, zekerheid
sort: 25
related: communication,contacts,channels,govern,autonomy,agents
---

# AI-afhandeling instellen

AI-afhandeling is een instelling met drie modi: **Autonoom** (AI antwoordt zelf), **Geassisteerd** (AI stelt antwoorden en acties voor, een mens verstuurt) en **Handmatig** (AI blijft stil). Je stelt het een keer in voor de workspace en alleen opnieuw waar een kanaal, een contact of een enkel gesprek moet afwijken — de meest specifieke instelling wint.

Overal zie je dezelfde iconen: een bliksem voor Autonoom en een pen voor Geassisteerd (beide paars), en een hand voor Handmatig (grijs). [Govern](/docs/govern/govern) bepaalt het plafond: niets daaronder kan autonomer zijn dan Govern toestaat. Elke agent heeft ook een eigen plafond (zie [Agents](/docs/ai/agents)): een gesprek dat de agent afhandelt komt daar nooit boven, en de keuzelijst laat dat zien.

## De workspace-standaard instellen

![Workspace-standaard voor AI-afhandeling](/api/docs/assets/inbox-ai/workspace-default.png)
*Drie kaarten: Autonoom, Geassisteerd en Handmatig.*

1. Open **Instellingen** en daarna **AI-antwoorden**.
2. Kies onder **Workspace-standaard** **Autonoom**, **Geassisteerd** of **Handmatig**. De wijziging wordt direct opgeslagen.
3. Bij **Autonoom** zie je eerst een bevestiging met hoeveel open gesprekken deze instelling volgen en hoe vaak concepten recent ongewijzigd zijn verstuurd. Alleen een eigenaar of beheerder kan Autonoom aanzetten.
4. Als Govern gesprekken lager begrenst, toont de kaart die grens. Open Govern via de notitie onder de kaarten om dat te wijzigen.

Begin met **Geassisteerd**. Bokito stelt Autonoom voor zodra minstens 80% van 50 of meer concepten ongewijzigd wordt verstuurd.

## Uitzonderingen bekijken

1. Open op dezelfde pagina **Uitzonderingen**. Daar staan alle kanalen, contacten en open gesprekken die de workspace-standaard niet volgen, gegroepeerd per laag.
2. Elke rij toont het icoon van de modus en de naam. Kies **Weer de standaard volgen** om de uitzondering te verwijderen.
3. Nieuwe uitzonderingen zet je waar je werkt: op het kanaal onder [Kanalen](/docs/inbox/channels), op een contact onder [Contacten](/docs/inbox/contacts), of in de kop van een gesprek in [Communicatie](/docs/inbox/communication).

Een uitzondering op een gesprek geldt tot het gesprek sluit. Uitzonderingen op kanalen en contacten blijven tot je ze wist.

## Waarborgen voor autonome antwoorden instellen

1. Open **Waarborgen**. Elke waarborg maakt van een enkel autonoom antwoord een concept ter controle; er wordt nooit meer verstuurd.
2. Stel de **Zekerheidsdrempel** in (1–10, van **soepel** tot **strikt**). Onder die zekerheid wordt het antwoord een concept.
3. Zet **Antwoorden aan nieuwe contacten controleren** aan om concepten te maken zolang een contact op goedkeuring wacht. Websitechatbezoekers zijn uitgezonderd.
4. Zet **AI-antwoorden vermelden** aan om autonome antwoorden een korte vermelding te geven. Pas de **Tekst van de vermelding** aan of laat leeg voor de standaardtekst; de preview toont wat klanten zien.
5. Kies **Opslaan** in de balk onderaan.

De tijdlijn toont een regel zoals **Concept in plaats van verzonden** met de reden wanneer een waarborg ingrijpt.

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

Dezelfde modus bepaalt wie een onbekende chatter is. Geeft een bezoeker een e-mail of telefoonnummer, dan koppelt **Autonoom** het gesprek aan het passende contact (of maakt er een aan), koppelt **Geassisteerd** alleen bevestigde adressen en vraagt je voor de rest, en laat **Handmatig** het koppelen aan jou. Zie [Een gesprek aan een contact koppelen](/docs/inbox/contacts).

## Wat nu

Vul [Kennis](/docs/ai/knowledge) zodat concepten onderbouwd blijven. Gebruik **Wie antwoordt** op dezelfde pagina alleen wanneer een kanaal de standaardagent moet overslaan — dat is routering, geen AI-afhandeling.
