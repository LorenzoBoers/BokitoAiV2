---
title: Autonomie instellen
intro: Kies of de AI zelf antwoordt, concepten ter controle maakt of stil blijft. Eén dial voor de werkruimte; een kanaal of een enkel gesprek mag lager staan.
description: Stel Autonomie in (Autonoom, Geassisteerd, Handmatig), met uitzonderingen per kanaal, waarborgen, overdracht tussen agent en mensen, vermelding, antwoordtaal en afzender.
keywords: Autonomie, autonoom, geassisteerd, handmatig, concepten, automatisch antwoorden, waarborgen, overdracht, eigenaar, terug naar de agent, pingpong-limiet, sluiten na antwoord, heropenen, vermelding, antwoordtaal, afzender, zekerheid, automatische mail, automatiseringsregel, geen antwoord nodig
sort: 25
related: communication,contacts,channels,govern,autonomy,agents
---

# Autonomie instellen

Autonomie is een instelling met drie modi: **Autonoom** (AI antwoordt zelf), **Geassisteerd** (AI stelt antwoorden en acties voor, een mens verstuurt) en **Handmatig** (geen concept of verzenden naar de klant; de gekoppelde kanaalagent mag het gesprek nog wel lezen, samenvatting en prioriteit zetten, en tags of tickets vastleggen). Je stelt het een keer in met de Autonomie-dial op Govern, en zet het alleen lager waar een kanaal of een enkel gesprek moet afwijken. Niets gaat boven de dial. Zonder **AI-agent** op het kanaal is er geen inbound-interpretatie of antwoord.

Overal zie je dezelfde iconen: een bliksem voor Autonoom en een pen voor Geassisteerd (beide paars), en een hand voor Handmatig (grijs). De dial staat beschreven onder [Autonomie](/docs/govern/autonomy). Elke agent heeft ook een eigen niveau (zie [Agents](/docs/ai/agents)): een gesprek dat de agent afhandelt komt daar nooit boven, en de keuzelijst laat dat zien.

## De werkruimte-dial zetten

![De Autonomie-dial](/api/docs/assets/inbox-ai/workspace-default.png)
*Drie kaarten: Handmatig, Geassisteerd en Autonoom.*

1. Open **Instellingen**, daarna **Govern**, daarna **Beleid**. Elke instelling op deze pagina staat daar.
2. Kies onder **Autonomie** **Handmatig**, **Geassisteerd** of **Autonoom**. De wijziging wordt direct opgeslagen.
3. Bij **Autonoom** vraagt Bokito eerst **Autonoom aanzetten?** Alleen een eigenaar of beheerder kan de dial wijzigen.
4. Wil je autonome antwoorden voor de hele werkruimte pauzeren, zet de dial dan op **Geassisteerd**. Elk gesprek maakt dan concepten tot je hem weer verhoogt.

Begin met **Geassisteerd**. Bokito stelt Autonoom voor zodra minstens 80% van 50 of meer concepten ongewijzigd wordt verstuurd. Op een geassisteerd kanaal toont de rij Autonomie hoeveel van die 50 concepten ongewijzigd zijn verstuurd.

## Uitzonderingen bekijken

1. Open op dezelfde pagina **Per kanaal**. Daar staan alle kanalen en open gesprekken die onder de dial staan, gegroepeerd per laag.
2. Elke rij toont het icoon van de modus en de naam. Kies **Weer de standaard volgen** om de uitzondering te verwijderen. Een geactiveerde noodrem toont **Autonoom hervatten** op de kanaalrij.
3. Nieuwe uitzonderingen zet je waar je werkt: op het kanaal onder [Kanalen](/docs/inbox/channels), of in de kop van een gesprek in [Communicatie](/docs/inbox/communication).

Een uitzondering op een gesprek geldt tot het gesprek sluit. Uitzonderingen op kanalen blijven tot je ze wist.

## Waarborgen voor autonome antwoorden instellen

1. Open **Waarborgen**. Elke waarborg maakt van een enkel autonoom antwoord een concept ter controle; er wordt nooit meer verstuurd.
2. Stel de **Zekerheidsdrempel** in (1–10, van **soepel** tot **strikt**). Onder die zekerheid wordt het antwoord een concept.
3. Zet **Antwoorden aan nieuwe contacten controleren** aan om concepten te maken zolang een contact op goedkeuring wacht. Websitechatbezoekers zijn uitgezonderd.
4. Zet **AI-antwoorden vermelden** aan om autonome antwoorden een korte vermelding te geven. Pas de **Tekst van de vermelding** aan of laat leeg voor de standaardtekst; de preview toont wat klanten zien.
5. Stel onder **Noodrem** **Autonome antwoorden per uur per kanaal** en **Negatieve signalen per uur per kanaal** in. Een geactiveerd kanaal draait Geassisteerd tot iemand het hervat via **Per kanaal** of het kanaal.
6. Stel de **Pingpong-limiet** in: hoe vaak per dag een gesprek tussen de agent en mensen mag wisselen. Daarna blijft het bij mensen tot iemand het expliciet teruggeeft, en toont het gesprek een notitie van de agent. 0 zet de limiet uit.
7. Wijzigingen worden automatisch opgeslagen.

Een werk kan zijn tickets op controle houden: zet **Autonomie** op **Geassisteerd** op de werkpagina (zie [Werken](/docs/ai/flows)). Antwoorden op die tickets worden een concept, ook als het gesprek Autonoom is.

De tijdlijn toont een regel zoals **Concept in plaats van verzonden** met de reden wanneer een waarborg ingrijpt. Dezelfde regel verschijnt met **de agent is geen eigenaar van dit gesprek** wanneer een medewerker of team het gesprek bezit (de agent maakt dan een concept voor hen) en met **een collega typt een antwoord** wanneer iemand op dat moment in de composer schrijft.

Antwoorden volgen het kanaal. E-mail krijgt één gestructureerd bericht. Op WhatsApp en websitechat schrijft de AI zoals een mens in een chat: maximaal vijf korte berichten, op volgorde verstuurd met een korte typpauze, en de AI-vermelding alleen bij het eerste. Mislukt één bericht, dan wachten de rest. Bij **Geassisteerd** bevat de conceptkaart dezelfde berichten, zodat je ze kunt verwijderen of aanpassen voordat je **Versturen** kiest (zie [Beslissingen](/docs/ai/decisions)).

## Overdracht tussen agent en mensen instellen

Autonomie zegt wat de agent mag doen; de eigenaar zegt wie er nu aan zet is. De agent is eigenaar zolang hij de volgende stap heeft: op een kanaal met **Autonoom** beantwoordt hij nieuwe gesprekken zelf; met **Geassisteerd** pakt hij ze op, zoekt context, maakt een concept of keuzekaart en geeft het gesprek dan aan een persoon (de tijdlijn toont **Concept klaar: {naam} is aan zet**). Hij draagt ook over wanneer de klant om een medewerker vraagt, wanneer een waarborg of beslissing escaleert, of wanneer iemand overneemt. Deze regels bepalen wat er rond die overdracht gebeurt.

1. Open op dezelfde pagina **Overdracht tussen agent en mensen**.
2. Kies onder **Na een antwoord van een medewerker** voor **Terug naar de agent** (de agent wordt weer eigenaar en pakt het volgende bericht van de klant op: zelf beantwoorden bij Autonoom, een concept voor jou bij Geassisteerd; de standaard), **Blijft bij de medewerker** (wie antwoordt wordt eigenaar en de agent maakt concepten voor die persoon) of **Vraag bij versturen** (het verstuurmenu in het gesprek biedt **Versturen en teruggeven aan {agent}** en **Versturen en zelf houden**).
3. Zet **Sluiten na een autonoom antwoord** aan om een gesprek te sluiten zodra een autonoom antwoord is verzonden, of **Sluiten na een antwoord van een medewerker** om **Versturen** standaard te laten sluiten; het verstuurmenu biedt dan **Versturen en open laten**. Een nieuw bericht van het contact heropent een gesloten gesprek.
4. Kies onder **Eigenaar bij heropenen** voor **Zelfde eigenaar** (de laatste eigenaar krijgt het heropende gesprek; is die persoon geen lid meer, dan valt het terug op de contacteigenaar of het kanaalteam) of **Opnieuw routeren** (het heropende gesprek wordt gerouteerd als een nieuw gesprek).
5. Overschrijf elke regel behalve de pingpong-limiet per kanaal onder [Kanalen](/docs/inbox/channels), sectie **Overdracht**. Een kanaalwaarde toont de badge **Bedrijfsstandaard** tot het kanaal een eigen regel kiest.

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
- De Autonomie-dial staat op Geassisteerd of Handmatig, of het werk van het ticket staat op Geassisteerd of Handmatig.
- **Privacy** houdt AI weg van berichtinhoud; Autonomie toont dan Handmatig.
- De noodrem van het kanaal is geactiveerd na ongewone activiteit; het kanaal draait Geassisteerd tot iemand het hervat.
- De mailbox moet nog ingesteld of opnieuw gekoppeld worden. Het gesprek krijgt dan een **Interne notitie** met een verwijzing naar **Instellingen → Kanalen** in plaats van een concept.

## Zien waarom een gesprek zo loopt

De knop **Waarom** in de kop van het gesprek zet alle redenen op één plek, elk als zin met een link naar de plek waar je het verandert.

1. Open een gesprek en klik in de kop op **Waarom**.
2. De eerste regel noemt de agent: wie het laatste antwoord schreef, eigenaar is of wordt aangesproken.
3. Daarna volgen de Autonomie-instelling en waar die vandaan komt (werkruimte, kanaal of dit gesprek), en alles wat hem lager houdt: de dial, Privacy, de noodrem, het eigen niveau van de agent of de eigen Autonomie van het werk.
4. Daaronder staan de kennisdocumenten die het laatste antwoord las, de map waar het gesprek in zit (en of het label van het gesprek, het contact of het bedrijf komt) en het werk met de huidige fase.
5. De laatste regels tonen waar het werk is opgeleverd: antwoorden per kanaal, de map en de plek onder **Werkt in** (een koppeling, canvas of het bord), en een correctie die als voorbeeld is bewaard.
6. Klik op een regel om die instelling of plek te openen. Antwoorden van vóór dit paneel tonen geen documenten.

## Geen antwoord nodig

Niet elke mail wil een antwoord. Bonnetjes, deploy-meldingen en andere automatische mail krijgen een actiekaart in plaats van een concept, en een voorstel blijft alleen staan zolang het het laatste bericht beantwoordt.

1. Besluit de AI dat er geen antwoord nodig is, dan toont het gesprek een actiekaart met **Sluiten** en **Open houden** in plaats van een concept, en opent de composer op **Notitie**. De samenvatting van de AI in één regel (bijvoorbeeld **GitHub deploy geslaagd**) staat in de kaart. Een model dat eerst uitlegt eindigt nog steeds in die kaart; uitlegtekst verschijnt nooit als concept.
2. Elke lezing van een bericht eindigt in één kaart. Labels en andere stappen van die lezing staan in de activiteitsregel van de kaart (**Gewerkt voor 3s · 3 acties**), niet als losse regels. Een nieuwere lezing vervangt een open kaart; de oude krimpt tot **Vervangen door een nieuwere lezing**.
3. De mensen die het gesprek bezitten krijgen één melding, na de lezing: **Concept klaar**, **Vraagt een keuze** of **Geen antwoord nodig**, met de afzender als titel. Geen antwoord nodig komt stil in Voor jou, zonder pop-up of push. Duurt de lezing langer dan 20 seconden, dan gaat de gewone melding **Nieuw bericht van** uit.
4. De AI houdt per persoon één antwoordvoorstel. Schrijft dezelfde persoon ook op een ander kanaal, dan gaat het voorstel van het oudere gesprek opzij (**Opzijgezet: nieuwer gesprek met deze persoon**) en draagt het nieuwste gesprek het actuele voorstel.
5. Een voorstel dat het laatste bericht niet meer beantwoordt gaat ook opzij: als de klant opnieuw schrijft voordat je verstuurt (**klant schreef opnieuw**), of als een collega vanuit de eigen mailbox antwoordde (**een collega antwoordde**). Een run die klaar is nadat een nieuwer bericht binnenkwam plaatst zijn concept niet.
6. De composer vertelt wanneer een bewaard concept verouderd is en biedt **Opnieuw voorstellen**; zie [Communicatie](/docs/inbox/communication).
7. Blijf je in het gesprek terwijl de agent een concept afrondt, dan komt die tekst in de reply-composer. In de tijdlijn staat **Antwoord voorgesteld**: open de chevron om te lezen, of kies **Overnemen** / **In de invoer** om hem opnieuw in de invoer te zetten nadat je een ander gesprek hebt geopend. Teamnotities van het model vullen nooit het klantconcept.
8. Op een mailbox met **Automatische mail archiveren** aan wordt die kaart overgeslagen: het gesprek sluit bij binnenkomst en krijgt de tag `#automated`. Stel het per mailbox in onder [Kanalen](/docs/inbox/channels).
9. Komt de derde no-reply mail van dezelfde afzender binnen, dan stelt de AI een **Automatiseringsregel** voor die afzender voor als kaart in het gesprek (*Mail van newsletter@example.com automatisch sluiten?*). **Activeren** zet de regel aan onder **Automatiseringsregels**; **Later** houdt hem als concept. Een agent die zelf een regel voorstelt gebruikt dezelfde kaart, zodat regels nooit zonder persoon actief worden.

Dezelfde modus bepaalt wie een onbekende chatter is. Geeft een bezoeker een e-mail of telefoonnummer, dan koppelt **Autonoom** het gesprek aan het passende contact (of maakt er een aan), koppelt **Geassisteerd** alleen bevestigde adressen en vraagt je voor de rest, en laat **Handmatig** het koppelen aan jou. Zie [Een gesprek aan een contact koppelen](/docs/inbox/contacts).

## Wat nu

Vul [Kennis](/docs/ai/knowledge) zodat concepten onderbouwd blijven. Zet **Wie antwoordt** op [Kanalen](/docs/inbox/channels) wanneer een kanaal de workspace-standaardagent moet overslaan — dat is routering, geen Autonomie.
