---
title: Kanalen koppelen
intro: Breng klantmail en andere inboxen naar Communicatie.
description: Voeg kanalen toe in een lijst, maak een Bokito-adres aan, koppel Gmail, Outlook, SMTP/IMAP of WhatsApp, lees de status en controles per kanaal, en pauzeer of verwijder een kanaal.
keywords: kanalen, gmail, outlook, smtp, imap, mailbox, bokito-adres, relay, kanaalstatus, routing, handtekening, kanaal pauzeren, automatische mail archiveren, nieuwsbrieven, syncfouten
sort: 20
related: communication,inbox-ai,widget,integrations
---

# Kanalen koppelen

Kanalen zijn hoe klanten de workspace bereiken. Open **Instellingen** en daarna **Kanalen**. Elk kanaal — mailbox, Bokito-adres, websitechat, WhatsApp, Slack — is één rij met de naam, hoe de AI het afhandelt, en één status. Klik op een rij om de pagina te openen: voor elk kanaal dezelfde secties **Status**, **Algemeen** en **Beheer**. Websitechat voegt **Uiterlijk**, **Stem en uren** en **Installatie** toe op die pagina. Een nieuwe workspace start alleen met de websitechat, dus voeg een e-mailkanaal toe voordat je mail verwacht.

## Voeg een kanaal toe

![Kanaalinstellingen met een geopend kanaal](/api/docs/assets/channels/mailbox-status.png)
*Elke rij toont de AI-afhandeling en de status; klik een rij om de kanaalpagina te openen.*

1. Open **Instellingen** en daarna **Kanalen**.
2. Kies **Kanaal toevoegen**.
3. Kies **E-mail**, **WhatsApp Business**, **Websitechat** of **Slack-workspace**. **E-mail** opent een tweede stap met **Gmail**, **Outlook**, **SMTP / IMAP** en **Bokito-adres**.
4. Rond het formulier voor die keuze af. De nieuwe rij verschijnt in de lijst **Kanalen**.

## Koppel SMTP / IMAP

Gebruik dit als je provider geen Gmail- of Outlook-OAuth-kaart heeft (bijvoorbeeld Hostinger, cPanel of een eigen domeinmailbox).

1. Kies **Kanaal toevoegen**, daarna **E-mail** en dan **SMTP / IMAP**.
2. Onder **Mailbox-login**: vul **E-mailadres** en **Wachtwoord** in (liever een app-wachtwoord). Open **Gebruikersnaam wijkt af van e-mailadres** alleen als de loginnaam anders is.
3. Onder **Provider**: kies een preset (**Gmail**, **Outlook / Microsoft 365**, **Yahoo**, **iCloud**, **Zoho**) om hosts en poorten in te vullen, of **Custom** voor eigen hosting. Bokito kan een preset voorstellen op basis van het e-maildomein.
4. Controleer **Inkomende mail (IMAP)** (server, poort, versleuteling), daarna optioneel **Uitgaande mail gebruikt dezelfde server als inkomend**, en dan **Uitgaande mail (SMTP)** (server, poort, versleuteling). Open **Hulp nodig bij serverinstellingen?** voor poorten en firewalltips.
5. Onder **Hoe ver terug synchroniseren?** kies **7**, **30** (aanbevolen), **90** of **1 jaar**.
6. Kies **Koppelen en synchroniseren**. Bokito logt in op IMAP en SMTP, haalt die geschiedenis op, en toont de rij in **Kanalen** pas als **Actief** als die eerste sync slaagt. Antwoorden gaan via SMTP vanaf dit adres.

Faalt koppelen met een netwerkfout, dan zijn uitgaande poorten 993, 587 of 465 mogelijk geblokkeerd op de server die de API draait. Een mislukte eerste sync laat geen half-gekoppelde rij achter.

## Maak een Bokito-adres aan

1. Kies **Kanaal toevoegen**, daarna **E-mail** en dan **Bokito-adres**.
2. Typ een **Prefix** van 3 tot 24 tekens, alleen letters, cijfers en streepjes. De voorbeeldregel onder **Je adres wordt** toont het volledige adres, bijvoorbeeld `support-acme@in.bokito.ai`.
3. Let op de teller: een workspace heeft maximaal drie adressen. Namen als `postmaster` en `noreply` zijn gereserveerd.
4. Kies **Adres aanmaken** en daarna **Kopiëren**.
5. Deel het adres, of stuur mail vanaf je bestaande mailbox ernaartoe. Inkomende mail landt in [Communicatie](/docs/inbox/communication) en antwoorden gaan vanaf dit adres.

Een Bokito-adres ontvangt en verstuurt; het synchroniseert niet, dus het toont geen mappen of laatste sync.

## Koppel Gmail of Outlook

1. Kies **Kanaal toevoegen** en daarna **E-mail**.
2. Kies **Gmail** of **Outlook**.
3. Kies **Hoe ver terug synchroniseren?** (**7**, **30** aanbevolen, **90** of **1 jaar**), daarna **Doorgaan met Gmail** of **Doorgaan met Outlook**.
4. Meld je aan bij de provider. Bokito draait de eerste sync voordat het kanaal **Actief** toont — succes betekent dat de installatie klaar is.
5. Terug in de lijst klik je op de mailboxrij. De sectie **Mailbox** bevat **Mappen**, **Handtekening**, **Primaire afzender**, **Geschiedenis** en **Verbinding**. Dagelijkse sync loopt automatisch; **Sync opnieuw proberen** verschijnt alleen op de rij bij een syncprobleem.

Staat er **Actie nodig** op de statusbadge, kies dan **Opnieuw koppelen** (of pas de configuratie aan en probeer opnieuw) voordat je verstuurt.

## Verzonden items meelezen

Een antwoord dat een collega rechtstreeks vanuit Gmail of Outlook stuurt hoort nog steeds bij het gesprek. Verzonden items van een gekoppelde Gmail- of Outlook-mailbox worden standaard meegelezen, zodat dat antwoord als teamantwoord op de tijdlijn landt.

![Mappen van een gekoppelde mailbox met Verzonden items aangevinkt](/api/docs/assets/channels/sent-items.png)
*Inbox en Verzonden items staan standaard aan voor Gmail en Outlook; SMTP/IMAP leest alleen de Inbox.*

1. Open **Kanalen**, klik op de mailboxrij en open **Mappen** onder **Mailbox**. **Inbox** en **Verzonden items** staan aan voor Gmail en Outlook. Zet **Verzonden items** uit als de mailbox ook voor privémail wordt gebruikt die je helemaal niet wilt zien.
2. Alleen mail aan een bekend contact, of een antwoord op een bestaand gesprek, wordt vastgelegd. Mail aan een leverancier of een privéadres blijft buiten Bokito en maakt nooit een gesprek aan.
3. Een vastgelegd antwoord staat als teambubbel met **Verstuurd vanuit eigen mailbox (Outlook)** onder de naam. De auteur is het teamlid wiens inlog-e-mail overeenkomt met de afzender; anders het lid met het mailboxadres als e-mail, of de enige persoon met wie de mailbox is gedeeld.
4. Het gesprek is gelezen, verdwijnt uit **Jij aan zet**, en een open AI-voorstel gaat opzij met reden **een collega antwoordde**. Mail die Bokito zelf vanuit die mailbox stuurde wordt herkend en niet dubbel vastgelegd.
5. Een mail die een klantbericht doorstuurt (**FW:** met een **Van:**-regel) wordt op het teamlid vastgelegd en toont **Bevat doorgestuurd bericht van {naam}**, zodat je weet wie de oorspronkelijke afzender is.

## Hernoem een kanaal

1. Open **Kanalen**.
2. Klik op de kanaalrij en kies **Wijzigen** naast **Naam** onder **Algemeen**.
3. Typ een korte weergavenaam (bijvoorbeeld **Support**) en kies **Naam opslaan**. Laat het veld leeg om weer het adres te gebruiken.
4. De naam verschijnt in de kanalenlijst, in de Communicatie-zijbalk en op het reply-tabblad wanneer je vanaf die mailbox verstuurt.

Kopieer of fotografeer geen OAuth-geheimen van gekoppelde accounts.

## Lees de status en controles van een kanaal

Setupgids, Koppelingen, Kanalen en de reply-composer gebruiken dezelfde kanaalstatus. Alleen een agenda-login telt niet als verzendklare mailbox — Koppelingen toont dan dat de agenda gesynchroniseerd is terwijl mail nog niet klaar is.

1. Bekijk de status rechts op de rij: **Actief**, **Instellen nodig**, **Verbinden**, **Verminderd**, **Actie nodig**, **Gepauzeerd** of **Fout**. **Verbinden** hoort alleen tijdens een installatie die nog loopt — na een geslaagde koppeling zie je **Actief**.
2. Heeft een kanaal een mens nodig, dan toont de rij één herstelknop naast de status: **Opnieuw koppelen**, **Sync opnieuw proberen** of **Hervatten**. Een gele melding boven de lijst telt de kanalen die nog niet klaar zijn, en de eerste daarvan gaat vanzelf open.
3. Klik op de rij en lees **Status**. Elke controle is één regel, bijvoorbeeld **Aanmelding**, **Gesynchroniseerde mappen**, **Laatste sync** en **Syncfouten** bij een mailbox, of **Inkomende mail**, **Uitgaande mail** en **Mail ontvangen** bij een Bokito-adres.
4. Bij een mailbox staat **Geschiedenis** in de sectie **Mailbox** voor latere backfills na opnieuw koppelen. Hoe ver terug bij de eerste installatie kies je tijdens **Kanaal toevoegen**.
5. Een mailbox die 50 keer achter elkaar niet kan synchroniseren pauzeert zichzelf in plaats van eindeloos opnieuw te proberen. De rij toont **Gepauzeerd**, **Syncfouten** toont de reden en er komt een melding in Communicatie. Herstel de aanmelding of server en kies **Hervatten**; een geslaagde sync zet de teller op nul.

## Pauzeer of verwijder een kanaal

1. Klik op de kanaalrij en scroll naar **Beheer**.
2. Kies **Pauzeren** naast **Kanaal pauzeren**. Een gepauzeerd kanaal ontvangt en verstuurt niets nieuws; gesprekken en instellingen blijven bewaard. Een gepauzeerde mailbox is ook geen primaire afzender meer.
3. De rij toont dan **Gepauzeerd** met een knop **Hervatten**. Kies **Hervatten** om weer te ontvangen en te verzenden.
4. Kies **Verwijderen** naast **Kanaal verwijderen** om het definitief te ontkoppelen. Bestaande gesprekken blijven in Communicatie. De websitechat kun je pauzeren maar niet verwijderen.

In Communicatie toont een gesprek dat nog niet kan versturen **Kanaal afmaken** als er al een kanaal is dat nog niet klaar is, of **Mailbox koppelen** als er nog geen kanaal is. De setupgids markeert de kanaalstap pas klaar wanneer een mailbox kan verzenden of ontvangen.

## Zet een handtekening en standaardagent

1. Klik op de rij van een mailbox of Bokito-adres en kies **Wijzigen** naast **Handtekening**. Uitgaande mail vanaf dat adres voegt die toe. Na versturen toont Communicatie diezelfde handtekening in de bubbel (wat de klant ontving).
2. Kies onder **Algemeen** een **Eigenaar-team** voor nieuwe gesprekken tot iemand ze oppakt, en een **AI-agent** voor AI-afhandeling. Zonder agent behandelt de standaardagent van de werkruimte nieuwe gesprekken.
3. Kies **Toegang** om de toegangsmatrix te openen. Zet **Zien** en **Afhandelen** per team, persoon en agent aan of uit. Afhandelen betekent reageren, gesprekken oppakken en ze toegewezen krijgen; Zien is alleen lezen. Teams dekken hun leden — iemand zonder eigen toekenning volgt nog steeds **Alle mensen**. Eigenaren en beheerders handelen altijd elk kanaal af.
4. Kies **Primaire afzender maken** naast **Primaire afzender** als je meerdere e-mailkanalen hebt. Inboxautomatiseringen beheer je één keer onder **Automatiseringsregels**, niet als een tweede set routeringsregels per mailbox.

## Archiveer automatische mail op een mailbox

Nieuwsbrieven, bonnetjes en no-reply meldingen hoeven geen antwoord, maar ze belanden wel in **Open** en vragen aandacht van het team. Zet dit per mailbox aan en ze bergen zichzelf op.

1. Klik op de mailboxrij en scroll naar **Mailbox**.
2. Zet **Automatische mail archiveren** aan. Bokito sluit elke nieuwsbrief, bon of no-reply mail bij binnenkomst en tagt die met `#automated`; het gesprek blijft vindbaar onder **Gesloten**.
3. Laat het uit om het huidige gedrag te houden: de AI noteert dat er geen antwoord nodig is en het gesprek blijft in **Open** tot iemand het sluit.
4. Blijft dezelfde bulkafzender binnenkomen, dan stelt de AI een **Automatiseringsregel** voor als kaart in het gesprek. Kies **Activeren** om die afzender voortaan automatisch te sluiten, of **Later**. Zie [AI-afhandeling](/docs/inbox/inbox-ai).

## AI-afhandeling per kanaal instellen

1. De rij toont de huidige modus van het kanaal (**Autonoom**, **Geassisteerd** of **Handmatig**) met het icoon. Klik op de rij en open **AI-afhandeling** onder **Algemeen**. De modus met **Bedrijfsstandaard** is wat het kanaal volgt zonder eigen instelling; kies die om een afwijking weg te halen.
2. Kies **Autonoom**, **Geassisteerd** of **Handmatig** voor elk gesprek op dit kanaal. Kies **Volg de workspace-standaard** om het weer weg te halen. Alleen een eigenaar of beheerder kan Autonoom aanzetten.
3. Een badge **Gepauzeerd** betekent dat de noodrem is geactiveerd na ongewone activiteit en het kanaal Geassisteerd draait. Kies **Autonoom hervatten** of **Geassisteerd houden** in hetzelfde menu.

Contacten en losse gesprekken kunnen nog steeds afwijken van het kanaal. Zie [AI-afhandeling](/docs/inbox/inbox-ai).

## Koppel WhatsApp

1. Kies **Kanaal toevoegen** en daarna **WhatsApp Business**. Marketplacekaarten voor deze app sturen je hier ook heen.
2. WhatsApp is een stapsgewijze setup: **Voorbereiden in Meta** (app, nummer, Phone number ID, permanent System User-token), daarna **Plakken in Bokito** (weergavenaam, Telefoonnummer-ID, optioneel WABA-ID, toegangstoken) en **Nummer koppelen**. De Phone number ID is een lang getal uit Meta → WhatsApp → API Setup — niet je telefoonnummer.
3. Na het koppelen toont Bokito **Webhook-URL** en **Verify token**. Plak die in Meta onder WhatsApp → Configuration, abonneer op **messages**, en stuur een testbericht. Tijdelijke Meta-tokens verlopen na 24 uur.
4. Websitechat is de [websitewidget](/docs/inbox/widget). **Kanaal toevoegen** en daarna **Websitechat** maakt een extra kanaal met eigen snippet. Na het koppelen verschijnen deze kanalen in de Communicatie-zijbalk.

## Bewaar antwoorden die het team hergebruikt

1. Scroll naar **Opgeslagen antwoorden** op dezelfde pagina (of open `#saved-replies` vanuit de composer).
2. Maak een titel en tekst, of sla een concept op vanuit de composer in een gesprek.
3. Iedereen kan een opgeslagen antwoord invoegen tijdens het antwoorden in Communicatie.

## Kies submappen en beheer tags

![Tags en Communicatie op de pagina Kanalen](/api/docs/assets/channels/communication-tags.png)
*Elke rij in Communicatie met de submap waarmee hij opent.*

1. Scroll naar **Tags en Communicatie** op dezelfde pagina. Elke rij in de zijbalk van Communicatie heeft dezelfde submappen: **Voor jou**, **Open**, **Niet toegewezen** en **Gesloten**. Kies de **Standaard submap**, en wijk daar per team, kanaal, tag of project van af.
2. Tags en actietags beheer je onder **Instellingen** → **Actietags**: één **Tags**-lijst. Kies **Nieuwe tag**, typ een naam en voeg een omschrijving toe die agents lezen.
3. Zet een vrije tag vast voor een rij onder **Tags** in Communicatie, of kies **Flow aanmaken** om er een flow aan te koppelen. Bij een actietag kies je **Flow openen**.
4. Zie [Actietags en tickets](/docs/ai/categories).

## Wat nu

Stel onder [AI-afhandeling](/docs/inbox/inbox-ai) in of de AI antwoordt, concepten maakt of stil blijft. Open Communicatie en wacht op het eerste gesprek.
