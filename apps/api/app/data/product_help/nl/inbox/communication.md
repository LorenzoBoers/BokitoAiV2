---
title: Zo werken Berichten
intro: De hub voor elk gesprek — klanten en agents op één plek.
description: Werk klantmail, chat en interne gesprekken af in Berichten, inclusief opstellen, notities, uitstellen en sjablonen.
keywords: inbox, messages, gesprekken, email, chat, opstellen, uitstellen, sjablonen
sort: 10
related: agent-runs,channels,inbox-ai,contacts,decisions,cases
---

# Zo werken Berichten

Berichten is waar de dag gebeurt. Klantmail, websitechat en interne agentgesprekken delen één hub. Open die wanneer iets een antwoord of een beslissing nodig heeft. Terwijl een agent werkt, toont het gesprek losse paarse statusregels — een wolk verschijnt pas wanneer de agent iets schrijft of een beslissing voorlegt.

## Werk de wachtrij Open af

Open is klantwerk dat nog jou nodig heeft.

![Wachtrij Open in Berichten](/api/docs/assets/communication/open-queue.png)
*Open toont klantwerk dat nog jou nodig heeft.*

1. Open **Communicatie**. Bovenaan staat **Alle communicatie** als map, net als de rest van de zijbalk: klik om **Open**, **Van mij**, **Niet toegewezen** en **Gesloten** uit te klappen (plus **Uitgesteld** en **Spam**). **Beslissingen** staat als eigen rij daaronder — dezelfde lijst als Overview **Wacht op beslissing**. **Activiteit**, **Contacten** en **Instellingen** staan vastgezet onderin — Activiteit en Contacten openen hun eigen pagina (niet de threadlijst). De eerste keer openen gaat naar de standaard-submap uit **Instellingen** → **E-mail en berichten** (Mappen) — meestal **Open**, of **Van mij** als je dat zo hebt gezet. **Uitgaand** is mail die jij startte.
2. Wissel naar **Van mij** voor gesprekken die aan jou zijn toegewezen, of **Niet toegewezen** voor werk zonder eigenaar.
3. Scan de lijst. Elke rij toont het laatste echte bericht, met **Jij:** als jij het stuurde. Een vervolgbericht van dezelfde websitebezoeker blijft in dat Open-gesprek. Gebruik het zoekveld boven de lijst, en open daarna **Filters** voor **Jij aan zet**, **Ongelezen** of **Gepind** — ze werken bovenop Open, Van mij of een andere wachtrij, en Bokito onthoudt de keuze in de URL als `?filter=`. Wisselen van filter houdt het gesprek dat je open hebt. **1**–**4** wisselt die snelfilters; **5** opent **Beslissingen**. Een badge **Wacht op beslissing** markeert gesprekken met een open keuzekaart. In hetzelfde **Filters**-menu verfijn je verder op toegewezene, prioriteit of kanaal. Druk **?** voor sneltoetsen: **J**/**K** bewegen, **]**/**[** springt ongelezen, **E** sluit (Ongedaan maken in de toast), **H** stelt een uur uit, **Shift+H** kiest een tijd, **X** selecteert, **Shift-klik** selecteert een bereik, **Cmd+A** selecteert geladen rijen, **U** markeert ongelezen, **Shift+U** markeert gelezen, **A** wijst aan jou toe, **Shift+A** opent de toewijzer, **P** zet vast, **R** focust het antwoord, **C** stelt op, **N** start een nieuwe chat, **L** kopieert de link, **#** kopieert het gespreks-ID, **/** zoekt, **Esc** gaat terug naar de lijst (niet terwijl een menu openstaat). Assistentchats gebruiken dezelfde toetsen voor bewegen, vastzetten, ongelezen, antwoord en zoeken.
4. Onder **Kanalen** staan alleen kanalen die je hebt geconfigureerd: elke mailbox of Bokito-adres, **Websitechat** wanneer het widgetkanaal aan staat, en WhatsApp nadat je die koppelt. Zonder gekoppeld kanaal staat **Kanaal toevoegen** bovenaan die lijst. Elk kanaal is een map met dezelfde submappen: **Open**, **Van mij**, **Niet toegewezen** en **Gesloten** — en elke map toont alleen gesprekken van dat kanaal (Websitechat mengt geen mailbox-mail). Submappen blijven verborgen tot je op het kanaal klikt — dan klapt de lijst uit en opent de standaard submap; opnieuw klikken klapt in. Er staat maar één map tegelijk open. Stel de standaard in (globaal of per kanaal) onder **Instellingen**, dan **E-mail en berichten** (Mappen). De sectie **Agents** (bedrijfsagents waarmee je mag chatten) werkt hetzelfde. Classificeren gaat met signalen, niet met tags: het zijpaneel toont **Signalen**, en intake-types beheer je op de pagina [Signalen](/docs/ai/cases). AI-triage opent zelf signalen uit die catalogus.
5. Pin wat telt, kies **Toewijzen** of **Aan mij toewijzen**, of **Uitstellen** (klok in de toolbar). Presets zijn **1 uur**, **4 uur**, **Morgen 9:00**, **Volgende maandag 9:00**, **Tot de klant antwoordt**, of **Kies datum en tijd**. Na een antwoord biedt het pijltje naast **Versturen** de opties **Versturen en sluiten** en **Versturen en uitstellen** om in één stap af te ronden. **Geladen als gelezen markeren** wist ongelezen op de gesprekken die al in de lijst staan.
6. Selecteer meerdere rijen voor bulk **Gelezen**, **Sluiten**, **Vastzetten**, **Markeer als spam**, **Aan mij toewijzen**, **Toewijzen**, **Heropenen**, **Markeer ongelezen** of **Uitstellen tot morgen 9:00**. Shift-klik een selectievakje om het bereik vanaf de laatste selectie te nemen. Het rij-indicatormenu kan ook tot morgen uitstellen. **Meer** bevat Uitgesteld, Gesloten en Spam. Het commandopalet springt ook naar Gesloten, Spam, Activiteit, Assistent, Jij aan zet en Beslissingen, en kan een gesprek of run openen op ID.

Uitgestelde gesprekken staan onder **Uitgesteld** tot de timer afgaat of de klant weer schrijft. Openen vanuit Uitgesteld brengt je terug naar Open. Een gesloten gesprek heropent vanzelf wanneer de klant in dezelfde e-mailthread antwoordt, zodat een laat "bedankt, nog één ding" terug in Open landt in plaats van een nieuw gesprek te starten.

## Start een nieuwe chat of e-mail

1. Kies **Nieuwe chat**. Je ziet drie grote keuzes: **Contact**, **Agent** en **Teamlid**. Er wordt pas iets aangemaakt als je verstuurt — dit is een concept in Communicatie.
2. **Contact** (of **Teamlid**): kies **Aan**, kies **Van** (een gekoppelde mailbox; je kunt wisselen vóór versturen en optioneel **Onthouden als standaard**), vul een onderwerp in, schrijf het bericht en verstuur. Hover **+** op een mailbox in de zijbalk om met die Van te starten. Een nieuw adres typen mag; een contact aanmaken eerst is niet nodig.
3. **Agent**: kies een bedrijfsagent (of gebruik **+** op een agentrij), typ en verstuur. Dan ontstaat de chatthread. Zonder agents zegt de pagina dat.
4. Je kunt mail ook starten vanaf een contactkaart of het commandopalet. Doorsturen vanuit een thread opent nog het compose-dialoog.
5. Een lege inbox biedt nog steeds **Nieuwe chat**, **Widget installeren** en de setupgids — websitechat wacht niet op e-mail.

## Antwoord, notitie of sjabloon

![Gesprek en composer in Communicatie](/api/docs/assets/communication/thread-composer.png)
*Gesprek, contact en composer staan op één scherm.*

1. Selecteer een gesprek. Geschiedenis, contact en AI-context staan op één scherm.
2. De composer verstuurt via hetzelfde kanaal als de klant. Op e-mailthreads toont het eerste tabblad de **mailboxnaam** (met provider-icoon) in plaats van generiek Beantwoorden — hover voor de verstuur-hint. Heb je meer dan één mailbox, open dat tabblad om een andere te kiezen; versturen vanaf een andere mailbox **verplaatst** het gesprek naar dat kanaal. **Ctrl+Enter** verstuurt e-mail en staat op de knop Versturen; Enter verstuurt chat. Het pijltje naast **Versturen** bevat **Versturen en sluiten** en **Versturen en uitstellen**. **Versturen als:** **Jij** of de agent bepaalt welke handtekening erbij komt en wiens naam als From-weergavenaam op de mail staat (het mailboxadres blijft het gekoppelde account).
3. Wissel naar **Intern** voor een teambericht dat de klant nooit ziet (beweeg over het tabblad voor de herinnering). Typ `@` en selecteer een persoon of agent in de picker om naar Intern te gaan (of naar een agent-metagesprek). Platte `@tekst` zonder selectie blijft klantantwoord. Terug naar Beantwoorden maakt mentions plat tot `@Naam`. Interne berichten werken nog als er geen mailbox kan versturen. Gesloten of spamgesprekken houden ze ook — een knop **Heropenen** staat op de composer.
4. Open **Schrijven** (sparkles) in de composer om te beschrijven wat je wilt sturen, of om tekst in het vak te herschrijven, in te korten, uit te breiden of van toon te wisselen. Dicteren (microfoon) werkt op Beantwoorden, Intern en het agent-tabblad: houd ingedrukt om te praten of klik om te starten; tijdens luisteren wordt de knop groen met een vinkje — klik of laat los om te bevestigen. Gesproken tekst verschijnt live in het vak en het veld groeit mee. Opgeslagen antwoorden staan onder dat Schrijven-menu, of onder **Instellingen**, daarna **E-mail en berichten**.
5. E-mailantwoorden kunnen CC/BCC toevoegen en je mailboxhandtekening meenemen. Zette de klant collega's in de CC, dan vult **Allen beantwoorden** hun CC-lijst alvast in (en andere Aan-adressen, niet jouw mailbox). **Citeren** voegt de laatste inboundregels in, ook bij HTML-only mail. **Doorsturen als nieuwe e-mail** houdt bijlagen vast. Als je dezelfde afzender meerdere keren sluit of een taak maakt, kan Bokito vragen dat voortaan te doen — **Doe dit voortaan** of **Niet nu**. In het gespreksmenu kun je ook **Mail van deze afzender altijd sluiten** kiezen. Die regels staan onder E-mail en berichten.
6. Zoeken vindt ook bedrijfsnamen en bestandsnamen van bijlagen.

## Gebruik een AI-concept

1. Als [Inbox AI](/docs/inbox/inbox-ai) op **Antwoorden voorstellen** staat, verschijnt een conceptbubbel links in het gesprek met het agentavatar — dezelfde chatstijl als andere agentberichten. De bubbel toont alleen het klantgerichte antwoord. Teamcontext staat eronder als **Interne notitie** (gaat niet mee in de e-mail).
2. Kies **Versturen als:** **Jij** of de agent — de handtekening staat direct onder de draft in dezelfde bubbel (niet onder de interne notitie). Die identiteit zet ook de From-weergavenaam op de mail; het mailboxadres verandert niet. Zonder eigen handtekening toont Bokito een standaard uit naam, functie, bedrijf en werkruimte-taal, met een link **Handtekening instellen** naar Profiel of de agentpagina. Pas de tekst aan en verstuur — of kies **Niet nu** / **Ik doe het zelf**. Versturen of goedkeuren van één concept legt overgebleven concepten terzijde. Oudere afgewezen concepten klappen in tot één korte bubbel (**Eerder concept — terzijde gelegd**).
3. Of gebruik **Schrijven** in de composer: typ een intentie (of laat leeg om uit het gesprek te concepten), genereer in het antwoordvak, bewerk en verstuur zelf. Snelle acties herschrijven tekst die al in het vak staat. Niets gaat de deur uit tot je Versturen indrukt.
4. Een banner op het gesprek zegt wanneer de AI het behandelt. **Overnemen van AI** pauzeert de assistent zodat jij met de hand afrondt. Zelf antwoorden pauzeert de AI ook en beëindigt een open metagesprek. **Geef terug aan AI** hervat die. Op **Automatisch antwoorden** is overnemen hoe je een live verzending stopt. In websitechat ziet de bezoeker bij overnemen direct een banner "een medewerker helpt je verder", die bij teruggeven of sluiten weer verdwijnt.

## Praat met een agent in het gesprek

Haal een agent erbij als je wilt sparren, iets wilt laten opzoeken of het gesprek wilt overdragen.

1. Open het agent-tabblad in de composer (genoemd naar de thread-owner), of typ `@` en selecteer een agent. Alleen naar het tabblad schakelen start nog geen metagesprek — je eerste bericht op dat tabblad doet dat. De klant ziet het niet.
2. Typ op het agent-tabblad en druk Enter. Jouw bericht verschijnt rechts; de agent streamt een bubbel links in dezelfde tijdlijn (geen apart paars vlak). Een dunne **intern**-strip markeert de sessie. Tijdens het antwoorden wordt Versturen **Stop**, en Enter doet niets — zo stuur je niet per ongeluk drie keer hetzelfde. De composer blijft op het agent-tabblad tot je de sessie afrondt of een klant-Beantwoorden stuurt.
3. Vraag om een antwoord en de agent stelt een conceptbubbel voor. Gebruik **Schrijven** in de composer als je alleen tekst in het antwoordvak nodig hebt — het agent-tabblad is voor onderzoek en afstemming. Een teammate taggen mid-meta stuurt een melding; het bericht gaat nog steeds naar de agent. Concepten zetten de composer niet om naar Beantwoorden zolang er nog een stream loopt.
4. Als het werk klaar is — of na een paar minuten stilte — biedt de agent (of het systeem) een afrondingsbeslissing: sessie beëindigen, doorgaan, of opvolging. **Sessie afronden** klapt het metagesprek in tot één gedeelde samenvattingsbubbel (agentavatar links, jouw avatar rechts) die je later kunt uitklappen. Een klant-Beantwoorden beëindigt de meta zonder checkout-acties. Agentberichten die naar de klant gaan tonen **Verstuurd naar de klant** onder de agentnaam, zodat ze te onderscheiden zijn van interne metabubbels.
5. Toch niet nodig, nog voor je iets typte? **Annuleren** haalt de sessie weg. Zodra er een bericht is gewisseld, gebruik de afrondingskaart of **Sessie afronden**.

## Beslis in het gesprek

![Keuzekaart in een gesprek](/api/docs/assets/communication/decision-card.png)
*Keuzekaarten verschijnen in de tijdlijn als chatbubbels.*

1. Een keuzebubbel verschijnt wanneer een agent jouw oordeel nodig heeft.
2. Lees het voorstel. Bij meerdere concrete keuzes houdt elke knop z’n eigen label (bijvoorbeeld versturen vs annuleren vs klant vragen). Keur goed, pas aan of wijs af. **Later** / **Niet nu** parkeert het gesprek tot morgen 9:00, zodat het uit Open verdwijnt. De enkele knop **Ik doe het zelf** is alleen om AI te pauzeren zodat jij overneemt.
3. Niets klantgericht gaat de deur uit tot jij antwoordt, tenzij autonomie dat toestaat. **Taak aanmaken** goedkeuren opent een opvolging op de [Agenda](/docs/ai/agenda). Je kunt ook vanuit het gespreksmenu een taak maken, of kies **Toevoegen aan project** in hetzelfde menu om het gesprek met een projectkiezer naar de wachtrij van een project te sturen — echt werk belandt op de projectbacklog zonder het gesprek te verlaten. Zie [Beslissingen](/docs/ai/decisions).

## Vang een websitebezoeker

1. Open een websitechat. De kop kan **+N eerder** tonen als deze persoon al eerder schreef — dat opent het contactpaneel.
2. Typ in **Details** hun naam en e-mail, daarna **E-mail opslaan**. **E-mail schrijven** wordt beschikbaar zodra er een echt adres staat.
3. De contactkaart toont of iemand goedgekeurd, in afwachting of geblokkeerd is, en bedrijfsnamen openen de bedrijfspagina als die bestaat. Niet-opgeslagen notities blijven gemarkeerd tot je ze opslaat, en bij wegklikken vraagt Bokito om te bevestigen. Mail van een workspace-lid toont een **Teamlid**-kaart (geen Blokkeer of Goedkeuren) — dat is een collega, geen klantcontact.

## Zie signalen op een gesprek

1. Open een klant- of intern gesprek. Het zijpaneel toont **Signalen**.
2. Elke rij toont het type, de status en een werkstroomlink wanneer er een koppeling is.
3. Kies **Bug report toevoegen** (of een ander type) wanneer een tweede intentie verschijnt. Op één gesprek kunnen meerdere signalen staan — zie [Signalen](/docs/ai/cases).

## Wat nu

Koppel een mailbox onder [Kanalen](/docs/inbox/channels). Open [Contacten](/docs/inbox/contacts) om te zien wie binnenkomt.
