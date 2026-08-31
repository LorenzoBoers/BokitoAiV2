---
title: Zo werkt Communicatie
intro: De hub voor elk gesprek — klanten en agents op één plek.
description: Werk klantmail, chat en interne gesprekken af in Communicatie, inclusief opstellen, notities, uitstellen en sjablonen.
keywords: inbox, messages, gesprekken, email, chat, opstellen, uitstellen, sjablonen
sort: 10
related: agent-runs,channels,inbox-ai,contacts,decisions
---

# Zo werkt Communicatie

Communicatie is waar de dag gebeurt. Klantmail, websitechat en interne agentgesprekken delen één hub. Open die wanneer iets een antwoord of een beslissing nodig heeft. Terwijl een agent werkt, toont het gesprek losse paarse statusregels — een wolk verschijnt pas wanneer de agent iets schrijft of een beslissing voorlegt.

## Werk de wachtrij Open af

Open is klantwerk dat nog jou nodig heeft.

![Wachtrij Open in Communicatie](/api/docs/assets/communication/open-queue.png)
*Open toont klantwerk dat nog jou nodig heeft.*

1. Open **Communicatie**. Bovenaan staat **Alle communicatie** als map, net als de rest van de zijbalk: klik om **Open**, **Van mij**, **Niet toegewezen** en **Gesloten** uit te klappen (plus **Uitgesteld**, **Spam** en de paarse sub-weergave **Beslissingen** — dezelfde lijst als Rapportages **Wacht op beslissing**). **Activiteit**, **Contacten** en **Instellingen** staan vastgezet onderin — Activiteit en Contacten openen hun eigen pagina (niet de threadlijst). De eerste keer openen gaat naar de standaard-submap uit **Instellingen** → **E-mail en berichten** (Mappen en tags) — meestal **Open**, of **Van mij** als je dat zo hebt gezet. **Uitgaand** is mail die jij startte.
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
2. De composer verstuurt via hetzelfde kanaal als de klant (E-mail, Chat, WhatsApp). **Ctrl+Enter** verstuurt e-mail en staat op de knop Versturen; Enter verstuurt chat. Het pijltje naast **Versturen** bevat **Versturen en sluiten** en **Versturen en uitstellen**. **Versturen als:** **Jij** of de agent bepaalt welke handtekening erbij komt en wiens naam als From-weergavenaam op de mail staat (het mailboxadres blijft het gekoppelde account).
3. Wissel naar **Notitie** voor een intern commentaar dat de klant nooit ziet (beweeg over het tabblad voor de herinnering). Notities staan als rustige tekst met een linkerlijn in de tijdlijn — anders dan klantberichten, zonder gele wolk. Notities werken nog als er geen mailbox kan versturen. Gesloten of spamgesprekken houden notities ook — een knop **Heropenen** staat op de composer.
4. Open **Sjablonen** in de composer om een opgeslagen antwoord in te voegen, of sla de huidige tekst op als sjabloon. Beheer de bibliotheek onder **Instellingen**, daarna **E-mail en berichten** (Opgeslagen antwoorden).
5. E-mailantwoorden kunnen CC/BCC toevoegen en je mailboxhandtekening meenemen. Zette de klant collega's in de CC, dan vult **Allen beantwoorden** hun CC-lijst alvast in (en andere Aan-adressen, niet jouw mailbox). **Citeren** voegt de laatste inboundregels in, ook bij HTML-only mail. **Doorsturen als nieuwe e-mail** houdt bijlagen vast. Als je dezelfde afzender meerdere keren sluit of een taak maakt, kan Bokito vragen dat voortaan te doen — **Doe dit voortaan** of **Niet nu**. In het gespreksmenu kun je ook **Mail van deze afzender altijd sluiten** kiezen. Die regels staan onder E-mail en berichten.
6. Zoeken vindt ook bedrijfsnamen en bestandsnamen van bijlagen.

## Gebruik een AI-concept

1. Als [Inbox AI](/docs/inbox/inbox-ai) op **Antwoorden voorstellen** staat, verschijnt een conceptkaart in het gesprek. De kaart toont alleen het klantgerichte antwoord. Teamcontext staat eronder als **Interne notitie** (gaat niet mee in de e-mail).
2. Kies **Versturen als:** **Jij** of de agent — de handtekening staat direct onder de draft in dezelfde kaart (niet onder de interne notitie). Die identiteit zet ook de From-weergavenaam op de mail; het mailboxadres verandert niet. Zonder eigen handtekening toont Bokito een standaard uit naam, functie, bedrijf en werkruimte-taal, met een link **Handtekening instellen** naar Profiel of de agentpagina. Pas de tekst aan en verstuur — of kies **Niet nu** / **Ik doe het zelf**. Versturen of goedkeuren van één concept legt overgebleven conceptkaarten terzijde. Oudere afgewezen concepten klappen in tot één regel (**Eerder concept — terzijde gelegd**).
3. **Concept met AI** in de composer vraagt een eenmalig concept zonder te wachten op inbound mail. Optionele sturing bepaalt de toon. Zonder toegewezen agent biedt de fout **Agents openen**.
4. Een banner op het gesprek zegt wanneer de AI het behandelt. **Overnemen van AI** pauzeert de assistent zodat jij met de hand afrondt. Zelf antwoorden pauzeert de AI ook. **Geef terug aan AI** hervat die. Op **Automatisch antwoorden** is overnemen hoe je een live verzending stopt. In websitechat ziet de bezoeker bij overnemen direct een banner "een medewerker helpt je verder", die bij teruggeven of sluiten weer verdwijnt.

## Betrek een agent bij een gesprek

Haal een agent erbij als je wilt sparren, iets wilt laten opzoeken of het gesprek wilt overdragen.

1. Kies **Agent betrekken** in de composerbalk. Is er maar één relevante agent, dan staat zijn naam in de knop — **Support agent betrekken** start met één klik. Anders opent een korte lijst op volgorde van relevantie: eerst de agent die dit kanaal handelt, dan de projectlead, daarna overige bedrijfsagents.
2. De agent komt als paneel in het gesprek. Alles wat je daar schrijft is intern — de klant ziet het niet. Vraag om een samenvatting van de historie, laat een order opzoeken of leg twee antwoorden naast elkaar.
3. Vraag om een antwoord en de agent stelt het voor als conceptkaart op het gesprek, die je net als elk ander concept goedkeurt, aanpast of afwijst. **Gebruik als antwoord** zet een antwoord direct in de composer.
4. Vraag de agent verder te gaan met het contact en hij neemt het gesprek over: AI-antwoorden hervatten en die agent beantwoordt het volgende inkomende bericht. Met **Overnemen van AI** in de header pak je het gesprek weer terug.
5. Toch niet nodig, nog voor je iets typte? **Annuleren** haalt de sessie weg en laat niets achter. Zodra er een bericht is gewisseld, rondt **Sessie afronden** hem af en blijft een ingeklapte samenvatting in de tijdlijn staan — de conclusie en welke acties zijn uitgevoerd.

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
