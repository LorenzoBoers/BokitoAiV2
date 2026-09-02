---
title: Zo werken Berichten
intro: De hub voor elk gesprek — klanten en agents op één plek.
description: Werk klantmail, chat en interne gesprekken af in Berichten, inclusief opstellen, notities, uitstellen en sjablonen.
keywords: inbox, messages, gesprekken, email, chat, opstellen, uitstellen, sjablonen
sort: 10
related: agent-runs,channels,inbox-ai,contacts,decisions
---

# Zo werken Berichten

Berichten is waar de dag gebeurt. Klantmail, websitechat en interne agentgesprekken delen één hub. Open die wanneer iets een antwoord of een beslissing nodig heeft. Terwijl een agent werkt, toont het gesprek losse paarse statusregels — een wolk verschijnt pas wanneer de agent iets schrijft of een beslissing voorlegt.

## Werk de wachtrij Open af

Open is klantwerk dat nog jou nodig heeft.

![Wachtrij Open in Berichten](/api/docs/assets/communication/open-queue.png)
*Open toont klantwerk dat nog jou nodig heeft.*

1. Open **Communicatie**. Bovenaan staat **Alle communicatie** als map, net als de rest van de zijbalk: klik om **Open**, **Van mij**, **Niet toegewezen** en **Gesloten** uit te klappen (plus **Uitgesteld**, **Spam** en de paarse sub-weergave **Beslissingen** — dezelfde lijst als Overview **Wacht op beslissing**). **Activiteit**, **Contacten** en **Instellingen** staan vastgezet onderin — Activiteit en Contacten openen hun eigen pagina (niet de threadlijst). De eerste keer openen gaat naar de standaard-submap uit **Instellingen** → **E-mail en berichten** (Mappen en tags) — meestal **Open**, of **Van mij** als je dat zo hebt gezet. **Uitgaand** is mail die jij startte.
2. Wissel naar **Van mij** voor gesprekken die aan jou zijn toegewezen, of **Niet toegewezen** voor werk zonder eigenaar.
3. Scan de lijst. Elke rij toont het laatste echte bericht, met **Jij:** als jij het stuurde. Een vervolgbericht van dezelfde websitebezoeker blijft in dat Open-gesprek. Gebruik het zoekveld boven de lijst, en open daarna **Filters** voor **Jij aan zet**, **Ongelezen** of **Gepind** — ze werken bovenop Open, Van mij of een andere wachtrij, en Bokito onthoudt de keuze in de URL als `?filter=`. Wisselen van filter houdt het gesprek dat je open hebt. **1**–**4** wisselt die snelfilters; **5** opent **Beslissingen**. Een badge **Wacht op beslissing** markeert gesprekken met een open keuzekaart. In hetzelfde **Filters**-menu verfijn je verder op toegewezene, prioriteit of kanaal. Klik een tag-chip op een rij om de map van die tag te openen. Druk **?** voor sneltoetsen: **J**/**K** bewegen, **]**/**[** springt ongelezen, **E** sluit (Ongedaan maken in de toast), **H** stelt een uur uit, **Shift+H** kiest een tijd, **X** selecteert, **Shift-klik** selecteert een bereik, **Cmd+A** selecteert geladen rijen, **U** markeert ongelezen, **Shift+U** markeert gelezen, **A** wijst aan jou toe, **Shift+A** opent de toewijzer, **P** zet vast, **R** focust het antwoord, **C** stelt op, **N** start een nieuwe chat, **L** kopieert de link, **#** kopieert het gespreks-ID, **/** zoekt, **Esc** gaat terug naar de lijst (niet terwijl een menu openstaat). Assistentchats gebruiken dezelfde toetsen voor bewegen, vastzetten, ongelezen, antwoord en zoeken.
4. Onder **Kanalen** staan alleen kanalen die je hebt geconfigureerd: elke mailbox of Bokito-adres, **Websitechat** wanneer het widgetkanaal aan staat, en WhatsApp of Slack nadat je die koppelt. Zonder gekoppeld kanaal staat **Kanaal toevoegen** bovenaan die lijst. Elk kanaal is een map met dezelfde submappen: **Open**, **Van mij**, **Niet toegewezen** en **Gesloten** — en elke map toont alleen gesprekken van dat kanaal (Websitechat mengt geen mailbox-mail). Submappen blijven verborgen tot je op het kanaal klikt — dan klapt de lijst uit en opent de standaard submap; opnieuw klikken klapt in. Er staat maar één map tegelijk open. Stel de standaard in (globaal of per kanaal) onder **Instellingen**, dan **E-mail en berichten** (Mappen en tags). De secties **Tags** en **Agents** (bedrijfsagents waarmee je mag chatten) werken hetzelfde. Tag een gesprek vanuit het detailpaneel: **Tag toevoegen** zoekt in je taglijst, laat zien waarvoor elke tag is, en maakt de tag aan als de naam nieuw is. Een getagd gesprek verschijnt onder Tags over alle kanalen heen, en een gesprek met meerdere tags komt onder elke tag terug. Beweeg over de sectie **Tags** en gebruik het tandwiel om tags te beheren en de tags die je altijd als map wilt vast te zetten. AI-triage kan ook tags toevoegen, maar alleen tags die al in je lijst bestaan.
5. Pin wat telt, kies **Toewijzen** of **Aan mij toewijzen**, of **Uitstellen** (klok in de toolbar). Presets zijn **1 uur**, **4 uur**, **Morgen 9:00**, **Volgende maandag 9:00**, **Tot de klant antwoordt**, of **Kies datum en tijd**. Na een antwoord biedt het pijltje naast **Versturen** de opties **Versturen en sluiten** en **Versturen en uitstellen** om in één stap af te ronden. **Geladen als gelezen markeren** wist ongelezen op de gesprekken die al in de lijst staan.
6. Selecteer meerdere rijen voor bulk **Gelezen**, **Sluiten**, **Vastzetten**, **Markeer als spam**, **Aan mij toewijzen**, **Toewijzen**, **Heropenen**, **Markeer ongelezen** of **Uitstellen tot morgen 9:00**. Shift-klik een selectievakje om het bereik vanaf de laatste selectie te nemen. Het rij-indicatormenu kan ook tot morgen uitstellen. **Meer** bevat Uitgesteld, Gesloten en Spam. Het commandopalet springt ook naar Gesloten, Spam, Activiteit, Assistent, Jij aan zet en Beslissingen, en kan een gesprek of run openen op ID.

Uitgestelde gesprekken staan onder **Uitgesteld** tot de timer afgaat of de klant weer schrijft. Openen vanuit Uitgesteld brengt je terug naar Open. Een gesloten gesprek heropent vanzelf wanneer de klant in dezelfde e-mailthread antwoordt, zodat een laat "bedankt, nog één ding" terug in Open landt in plaats van een nieuw gesprek te starten.

## Start een nieuwe chat of e-mail

1. Kies **Nieuwe chat** voor een composer. **Terug naar Berichten** brengt je naar Open. Kies een **bedrijfsagent** in Aan (verplicht), of kies een persoon / typ een e-mail. Enter start het gesprek. Als er geen agents beschikbaar zijn, toont de pagina **Geen agents beschikbaar**.
2. Kies **Nieuwe e-mail** voor uitgaande mail. Kies Van (een gekoppelde mailbox), Aan, onderwerp en bijlagen. **Sjablonen** voegt een bewaard antwoord in, dezelfde bibliotheek als in het gesprek. Een Bokito-adres dat je hebt aangemaakt telt als mailbox waarvan je kunt versturen. De lijstkop toont wanneer mail het laatst binnenkwam; open **Kanaalinstellingen** als dat oud lijkt.
3. Je kunt mail ook starten vanaf een contactkaart of het commandopalet.
4. Een lege inbox biedt nog steeds **Nieuwe chat**, **Widget installeren** en de setupgids — websitechat wacht niet op e-mail.

## Antwoord, notitie of sjabloon

![Gesprek en composer in Communicatie](/api/docs/assets/communication/thread-composer.png)
*Gesprek, contact en composer staan op één scherm.*

1. Selecteer een gesprek. Geschiedenis, contact en AI-context staan op één scherm.
2. De composer verstuurt via hetzelfde kanaal als de klant. Het eerste tabblad is altijd **Beantwoorden**, met het kanaalicoon (e-mail, WhatsApp, websitechat, …) en een hover-tooltip voor kanaal en ontvanger. **Ctrl+Enter** verstuurt e-mail en staat op de knop Versturen; Enter verstuurt chat. Het pijltje naast **Versturen** bevat **Versturen en sluiten** en **Versturen en uitstellen**. **Versturen als:** **Jij** of de agent bepaalt welke handtekening erbij komt en wiens naam als From-weergavenaam op de mail staat (het mailboxadres blijft het gekoppelde account).
3. Wissel naar **Intern** voor een teambericht dat de klant nooit ziet (beweeg over het tabblad voor de herinnering). Typ `@` en selecteer een persoon of agent in de picker om naar Intern te gaan (of naar een agent-metagesprek). Platte `@tekst` zonder selectie blijft klantantwoord. Terug naar Beantwoorden maakt mentions plat tot `@Naam`. Interne berichten werken nog als er geen mailbox kan versturen. Gesloten of spamgesprekken houden ze ook — een knop **Heropenen** staat op de composer.
4. Open **Sjablonen** in de composer om een opgeslagen antwoord in te voegen, of sla de huidige tekst op als sjabloon. Beheer de bibliotheek onder **Instellingen**, daarna **E-mail en berichten** (Opgeslagen antwoorden).
5. E-mailantwoorden kunnen CC/BCC toevoegen en je mailboxhandtekening meenemen. Zette de klant collega's in de CC, dan vult **Allen beantwoorden** hun CC-lijst alvast in (en andere Aan-adressen, niet jouw mailbox). **Citeren** voegt de laatste inboundregels in, ook bij HTML-only mail. **Doorsturen als nieuwe e-mail** houdt bijlagen vast. Als je dezelfde afzender meerdere keren sluit of een taak maakt, kan Bokito vragen dat voortaan te doen — **Doe dit voortaan** of **Niet nu**. In het gespreksmenu kun je ook **Mail van deze afzender altijd sluiten** kiezen. Die regels staan onder E-mail en berichten.
6. Zoeken vindt ook bedrijfsnamen en bestandsnamen van bijlagen.

## Gebruik een AI-concept

1. Als [Inbox AI](/docs/inbox/inbox-ai) op **Antwoorden voorstellen** staat, verschijnt een conceptkaart in het gesprek. De kaart toont alleen het klantgerichte antwoord. Teamcontext staat eronder als **Interne notitie** (gaat niet mee in de e-mail).
2. Kies **Versturen als:** **Jij** of de agent — de handtekening staat direct onder de draft in dezelfde kaart (niet onder de interne notitie). Die identiteit zet ook de From-weergavenaam op de mail; het mailboxadres verandert niet. Zonder eigen handtekening toont Bokito een standaard uit naam, functie, bedrijf en werkruimte-taal, met een link **Handtekening instellen** naar Profiel of de agentpagina. Pas de tekst aan en verstuur — of kies **Niet nu** / **Ik doe het zelf**. Versturen of goedkeuren van één concept legt overgebleven conceptkaarten terzijde. Oudere afgewezen concepten klappen in tot één regel (**Eerder concept — terzijde gelegd**).
3. Vraag de agent in een metagesprek om een concept; die stelt het voor als conceptkaart op het gesprek, die je net als elk ander concept goedkeurt, aanpast of afwijst. Er is geen aparte knop **Concept met AI** in de composer.
4. Een banner op het gesprek zegt wanneer de AI het behandelt. **Overnemen van AI** pauzeert de assistent zodat jij met de hand afrondt. Zelf antwoorden pauzeert de AI ook en beëindigt een open metagesprek. **Geef terug aan AI** hervat die. Op **Automatisch antwoorden** is overnemen hoe je een live verzending stopt. In websitechat ziet de bezoeker bij overnemen direct een banner "een medewerker helpt je verder", die bij teruggeven of sluiten weer verdwijnt.

## Praat met een agent in het gesprek

Haal een agent erbij als je wilt sparren, iets wilt laten opzoeken of het gesprek wilt overdragen.

1. Klik de paarse agent-chip in de composer (genoemd naar de thread-owner, of open een korte kandidatenlijst), of typ `@` en selecteer een agent. Dat start een intern metagesprek — de klant ziet het niet.
2. Typ op het agent-tabblad en druk Enter. Je bericht verschijnt meteen; de agent streamt een antwoord in dezelfde lichtpaarse band. Tijdens het antwoorden wordt Versturen **Stop**, en Enter doet niets — zo stuur je niet per ongeluk drie keer hetzelfde. De composer blijft op het agent-tabblad tot je de sessie afrondt of een klant-Beantwoorden stuurt.
3. Vraag om een antwoord en de agent stelt een conceptkaart voor. Vraag verder te gaan met het contact en de agent kan het gesprek overnemen. Een teammate taggen mid-meta stuurt een melding; het bericht gaat nog steeds naar de agent. Conceptkaarten zetten de composer niet om naar Beantwoorden zolang er nog een stream loopt.
4. Als het werk klaar is — of na een paar minuten stilte — biedt de agent (of het systeem) een afrondingskaart: sessie beëindigen, doorgaan, of opvolging. **Sessie afronden** klapt het segment in tot een samenvatting die je later kunt uitklappen. Een klant-Beantwoorden beëindigt de meta zonder checkout-acties.
5. Toch niet nodig, nog voor je iets typte? **Annuleren** haalt de sessie weg. Zodra er een bericht is gewisseld, gebruik de afrondingskaart of **Sessie afronden**.

## Beslis in het gesprek

![Keuzekaart in een gesprek](/api/docs/assets/communication/decision-card.png)
*Keuzekaarten verschijnen in de tijdlijn.*

1. Een keuzekaart verschijnt wanneer een agent jouw oordeel nodig heeft.
2. Lees het voorstel. Bij meerdere concrete keuzes houdt elke knop z’n eigen label (bijvoorbeeld versturen vs annuleren vs klant vragen). Keur goed, pas aan of wijs af. **Later** / **Niet nu** parkeert het gesprek tot morgen 9:00, zodat het uit Open verdwijnt. De enkele knop **Ik doe het zelf** is alleen om AI te pauzeren zodat jij overneemt.
3. Niets klantgericht gaat de deur uit tot jij antwoordt, tenzij autonomie dat toestaat. **Taak aanmaken** goedkeuren opent een opvolging op de [Agenda](/docs/ai/agenda). Je kunt ook vanuit het gespreksmenu een taak maken, of kies **Toevoegen aan project** in hetzelfde menu om het gesprek met een projectkiezer naar de wachtrij van een project te sturen — echt werk belandt op de projectbacklog zonder het gesprek te verlaten. Zie [Beslissingen](/docs/ai/decisions).

## Vang een websitebezoeker

1. Open een websitechat. De kop kan **+N eerder** tonen als deze persoon al eerder schreef — dat opent het contactpaneel.
2. Typ in **Details** hun naam en e-mail, daarna **E-mail opslaan**. **E-mail schrijven** wordt beschikbaar zodra er een echt adres staat.
3. De contactkaart toont of iemand goedgekeurd, in afwachting of geblokkeerd is, en bedrijfsnamen openen de bedrijfspagina als die bestaat. Niet-opgeslagen notities blijven gemarkeerd tot je ze opslaat, en bij wegklikken vraagt Bokito om te bevestigen. Mail van een workspace-lid toont een **Teamlid**-kaart (geen Blokkeer of Goedkeuren) — dat is een collega, geen klantcontact.

## Wat nu

Koppel een mailbox onder [Kanalen](/docs/inbox/channels). Open [Contacten](/docs/inbox/contacts) om te zien wie binnenkomt.
