---
title: Zo werkt Communicatie
intro: De hub voor elk gesprek — klanten en agents op één plek.
description: Werk klantmail, chat en interne gesprekken af in Communicatie, inclusief opstellen, notities, uitstellen en sjablonen.
keywords: inbox, communicatie, gesprekken, email, chat, opstellen, uitstellen, sjablonen, beslissingen
sort: 10
related: agent-runs,channels,inbox-ai,contacts,decisions,cases
---

# Zo werkt Communicatie

Communicatie is waar de dag gebeurt. Klantmail, websitechat, chats met bedrijfsagents en interne agent-runs delen één hub. Agentchats houden hun eigen map **Agents** in de zijbalk, maar gebruiken dezelfde wachtrijen en acties als de rest van Communicatie. Open die wanneer iets een antwoord of een beslissing nodig heeft. Terwijl een agent werkt, toont het gesprek losse paarse statusregels — een wolk verschijnt pas wanneer de agent iets schrijft of een beslissing voorlegt.

## Werk de wachtrij Open af

Open is gesprekswerk dat nog jou nodig heeft — klantkanalen én agentchats. Achtergrond-runs blijven onder **Activiteit**.

![Wachtrij Open in Communicatie](/api/docs/assets/communication/open-queue.png)
*Open toont gesprekswerk dat nog jou nodig heeft, inclusief agentchats.*

1. Open **Communicatie**. Bovenaan staat **Alle communicatie** als map: klik om **Open**, **Van mij**, **Niet toegewezen** en **Gesloten** uit te klappen (plus **Uitgesteld** en **Spam**). Die lijst bevat chats met bedrijfsagents naast klantmail en websitechat. Direct daaronder staat **Beslissingen** — de map voor elk gesprek met een open keuzekaart (klant, agentchat en intern). Overview, bel en diepe links landen daar. **Contacten** en **Instellingen** staan vastgezet onderin. De eerste keer openen gaat naar de standaard-submap uit **Instellingen** → **Kanalen** (Mappen) — meestal **Open**, of **Van mij** als je dat zo hebt gezet.
2. Wissel naar **Van mij** voor gesprekken die aan jou zijn toegewezen, of **Niet toegewezen** voor werk zonder eigenaar. Open **Beslissingen** wanneer je alleen ja/nee-kaarten wilt.
3. Scan de lijst. Elke rij toont het laatste echte bericht, met **Jij:** als jij het stuurde. Gebruik het zoekveld boven de lijst, en open daarna **Filters** voor **Jij aan zet**, **Ongelezen** of **Gepind** — ze werken bovenop Open, Van mij of een andere wachtrij. Filters plakken niet meer over mappen heen. Een badge **Wacht op beslissing** markeert rijen met een open kaart. Druk **?** voor sneltoetsen.
4. Onder **Kanalen** staan alleen kanalen die je hebt geconfigureerd: elke mailbox of Bokito-adres, **Websitechat** wanneer het widgetkanaal aan staat, en WhatsApp nadat je die koppelt. Zonder gekoppeld kanaal staat **Kanaal toevoegen** bovenaan die lijst. Elk kanaal is een map met dezelfde submappen: **Open**, **Van mij**, **Niet toegewezen** en **Gesloten** — en elke map toont alleen gesprekken van dat kanaal (Websitechat mengt geen mailbox-mail). Submappen blijven verborgen tot je op het kanaal klikt — dan klapt de lijst uit en opent de standaard submap; opnieuw klikken klapt in. Er staat maar één map tegelijk open. Stel de standaard in (globaal of per kanaal) onder **Instellingen**, dan **Kanalen** (Mappen). De sectie **Agents** (bedrijfsagents waarmee je mag chatten) werkt hetzelfde. Classificeren gaat met signalen, niet met tags: bekijk ze onder **Dit gesprek** en beheer de catalogus onder **Instellingen** → **Signaaltypes**. Zie [Hoe Signalen werken](/docs/ai/cases).
5. Pin wat telt, kies **Toewijzen** of **Aan mij toewijzen**, of **Uitstellen** (klok in de toolbar). Presets zijn **1 uur**, **4 uur**, **Morgen 9:00**, **Volgende maandag 9:00**, **Tot de klant antwoordt**, of **Kies datum en tijd**. Na een antwoord biedt het pijltje naast **Versturen** de opties **Versturen en sluiten** en **Versturen en uitstellen** om in één stap af te ronden. **Geladen als gelezen markeren** wist ongelezen op de gesprekken die al in de lijst staan.
6. Selecteer meerdere rijen voor bulk **Gelezen**, **Sluiten**, **Vastzetten**, **Markeer als spam**, **Aan mij toewijzen**, **Toewijzen**, **Heropenen**, **Markeer ongelezen** of **Uitstellen tot morgen 9:00**. Shift-klik een selectievakje om het bereik vanaf de laatste selectie te nemen. Rijacties (sluiten, uitstellen, toewijzen) zitten in het rijmenu en de thread-toolbar. **Meer** bevat Uitgesteld, Gesloten en Spam. Het commandopalet springt ook naar Gesloten, Spam, Activiteit, Assistent, Jij aan zet en Beslissingen, en kan een gesprek of run openen op ID.

Uitgestelde gesprekken staan onder **Uitgesteld** tot de timer afgaat of de klant weer schrijft. Openen vanuit Uitgesteld brengt je terug naar Open. Een gesloten gesprek heropent vanzelf wanneer de klant in dezelfde e-mailthread antwoordt, zodat een laat "bedankt, nog één ding" terug in Open landt in plaats van een nieuw gesprek te starten.

## Start een nieuwe chat of e-mail

1. Kies **Nieuwe chat**. Je ziet drie grote keuzes: **Contact**, **Agent** en **Teamlid**. Er wordt pas iets aangemaakt als je verstuurt — dit is een concept in Communicatie.
2. **Contact** (of **Teamlid**): kies **Aan**, kies **Van** (een gekoppelde mailbox; je kunt wisselen vóór versturen en optioneel **Onthouden als standaard**), vul een onderwerp in, schrijf het bericht en verstuur. Hover **+** op een mailbox in de zijbalk om met die Van te starten. Een nieuw adres typen mag; een contact aanmaken eerst is niet nodig.
3. **Agent**: kies een bedrijfsagent (of gebruik **+** op een agentrij), typ en verstuur. Dan ontstaat de chatthread. Zonder agents zegt de pagina dat.
4. Je kunt mail ook starten vanaf een contactkaart of het commandopalet. Doorsturen vanuit een thread opent nog het compose-dialoog.
5. Een lege inbox biedt nog steeds **Nieuwe chat**, **Widget installeren** en de setupgids — websitechat wacht niet op e-mail.

## Kies wat je stuurt (Antwoord / Vraag AI / Notitie)

![Composer-modes in Communicatie](/api/docs/assets/communication/composer-modes.png)
*Eén composer met drie bestemmingen: de klant, de AI of het team.*

1. Open een gesprek. Onder de tijdlijn toont de composer een mode-chip: **Antwoord aan {naam}**, **Vraag {agent}** en **Notitie**.
2. **Antwoord** gaat naar de klant op hetzelfde kanaal. De placeholder herinnert je eraan dat de klant dit ziet. Op e-mail stuurt **Ctrl+Enter**; op chat stuurt Enter.
3. **Vraag** praat alleen met de AI op dit gesprek (of start een AI check-in). De klant ziet niets. Tijdens streamen staat **Stop** klaar.
4. **Notitie** is alleen voor het team. Gebruik die voor overdracht en context die de workspace niet mag verlaten.
5. Op een AI-gesprek (`assistant`) of een AI check-in ontbreekt Antwoord — alleen Vraag en Notitie blijven. Slash-commando's en `@`-mentions blijven werken.

## Zie en wijzig wat de AI doet

![AI-afhandeling in de gespreksheader](/api/docs/assets/communication/handling-picker.png)
*De header toont de modus van AI-afhandeling en welke laag die volgt.*

1. Open een klantgesprek. De header toont de modus van **AI-afhandeling** met icoon: **Autonoom** of **Geassisteerd** (paars), of **Handmatig** (grijs). Het menu laat zien waar die vandaan komt, bijvoorbeeld **Volgt het kanaal**.
2. Kies een andere modus om die alleen voor dit gesprek in te stellen, tot het sluit. Kies **Volg het kanaal** (of het contact of de workspace) om dat weer weg te halen. Alleen een eigenaar of beheerder kan een gesprek op Autonoom zetten.
3. Kies **Overnemen** om Handmatig te zetten en het gesprek aan jezelf toe te wijzen. **Teruggeven aan AI** zet de geërfde modus terug. Zelf antwoorden in een autonoom gesprek neemt het ook over.
4. Typ in de composer `/handmatig`, `/geassisteerd` of `/autonoom` (of `/manual`, `/assisted`, `/autonomous`), eventueel gevolgd door een reden.
5. Elke wijziging staat in de tijdlijn, bijvoorbeeld **AI-afhandeling op Geassisteerd gezet**. Rijen in de lijst tonen het icoon wanneer een gesprek of contact afwijkt van het kanaal. Zie [AI-afhandeling](/docs/inbox/inbox-ai).
6. Live werk verschijnt als een dunne strip onder de tijdlijn terwijl de AI denkt of streamt — dezelfde plek voor klantantwoorden en Vraag-beurten.

## Keur een AI-voorstel goed vanuit de composer

1. Als de AI een antwoord voorstelt, laadt het concept in de composer met **Verstuur**, **Bewerk** en **Weg**. In de tijdlijn staat alleen een korte regel: **AI stelde een antwoord voor**.
2. Pas de tekst zo nodig aan en kies **Verstuur** (of het verstuurmenu voor sluiten / uitstellen). Versturen lost de beslissing op en levert het antwoord af.
3. **Weg** wijst het voorstel af zonder te versturen. Andere beslissingen (platform, module, agenda, afronding) blijven kaarten met de kop **Wacht op jouw OK** en gewone werkwoordknoppen — geen toolnamen in de copy.

## Beslis in het gesprek

![Keuzekaart in een gesprek](/api/docs/assets/communication/decision-card.png)
*Keuzekaarten verschijnen in de tijdlijn als chatbubbels.*

1. Een keuzebubbel verschijnt wanneer een agent jouw oordeel nodig heeft.
2. Lees het voorstel. Bij meerdere concrete keuzes houdt elke knop z’n eigen label (bijvoorbeeld versturen vs annuleren vs klant vragen). Keur goed, pas aan of wijs af. **Later** / **Niet nu** parkeert het gesprek tot morgen 9:00, zodat het uit Open verdwijnt. De enkele knop **Ik doe het zelf** zet het gesprek op Handmatig en wijst het aan jou toe.
3. Niets klantgericht gaat de deur uit tot jij antwoordt, tenzij autonomie dat toestaat. **Wat nu** goedkeuren (of de oude keuze Taak aanmaken) zet een kijkmoment op dit gesprek — titel en wanneer — en toont het op de [Agenda](/docs/ai/agenda). Kies in het gespreksmenu **Wat nu** om een kijkmoment te plannen of een typisch Signaal te openen. Wis het kijkmoment onder **Dit gesprek** in het zijpaneel wanneer je klaar bent. Kies **Toevoegen aan project** in hetzelfde menu om het gesprek aan een project te koppelen. Zie [Beslissingen](/docs/ai/decisions).

## Vang een websitebezoeker

1. Open een websitechat. De kop kan **+N eerder** tonen als deze persoon al eerder schreef — dat opent het contactpaneel.
2. Typ in **Details** hun naam en e-mail, daarna **E-mail opslaan**. **E-mail schrijven** wordt beschikbaar zodra er een echt adres staat.
3. De contactkaart toont of iemand goedgekeurd, in afwachting of geblokkeerd is, en bedrijfsnamen openen de bedrijfspagina als die bestaat. Niet-opgeslagen notities blijven gemarkeerd tot je ze opslaat, en bij wegklikken vraagt Bokito om te bevestigen. Mail van een workspace-lid toont een **Teamlid**-kaart (geen Blokkeer of Goedkeuren) — dat is een collega, geen klantcontact.

## Zie signalen op een gesprek

1. Open een klant- of intern gesprek. Het zijpaneel toont **Signalen**.
2. Elke rij toont het type, de status en een werkstroomlink wanneer er een koppeling is.
3. Kies **Signaal toevoegen**, of **Storing toevoegen** / **Factuur/betaling toevoegen** (of een ander type) wanneer een tweede intentie verschijnt. Op één gesprek kunnen meerdere signalen staan — zie [Signalen](/docs/ai/cases).

## Wat nu

Koppel een mailbox onder [Kanalen](/docs/inbox/channels). Open [Contacten](/docs/inbox/contacts) om te zien wie binnenkomt.
