---
title: Kanalen koppelen
intro: Breng klantmail en andere inboxen naar Communicatie.
description: Voeg kanalen toe in een lijst, maak een Bokito-adres aan, koppel Gmail, Outlook, SMTP/IMAP of WhatsApp, en lees de status en controles per kanaal.
keywords: kanalen, gmail, outlook, smtp, imap, mailbox, bokito-adres, relay, kanaalstatus, routing, handtekening
sort: 20
related: communication,inbox-ai,widget,integrations
---

# Kanalen koppelen

Kanalen zijn hoe klanten de workspace bereiken. Open **Instellingen** en daarna **E-mail en berichten**. Elk kanaal — mailbox, Bokito-adres, websitechat, WhatsApp — is één rij in de lijst **Kanalen** met dezelfde status, mogelijkheden en controles. Een nieuwe workspace start alleen met de websitechat, dus voeg een e-mailkanaal toe voordat je mail verwacht.

## Voeg een kanaal toe

![Kanaalinstellingen met de kanalenlijst](/api/docs/assets/channels/mailbox-status.png)
*Elk kanaal is één rij met een statusbadge, mogelijkheden en eigen controles.*

1. Open **Instellingen** en daarna **E-mail en berichten**.
2. Kies **Kanaal toevoegen**.
3. Kies **E-mail**, **WhatsApp Business** of **Websitechat**. **E-mail** opent een tweede stap met **Gmail**, **Outlook**, **SMTP / IMAP** en **Bokito-adres**.
4. Rond het formulier voor die keuze af. De nieuwe rij verschijnt in de lijst **Kanalen**.

## Koppel SMTP / IMAP

Gebruik dit als je provider geen Gmail- of Outlook-OAuth-kaart heeft (bijvoorbeeld Hostinger, cPanel of een eigen domeinmailbox).

1. Kies **Kanaal toevoegen**, daarna **E-mail** en dan **SMTP / IMAP**.
2. Onder **Mailbox-login**: vul **E-mailadres** en **Wachtwoord** in (liever een app-wachtwoord). Open **Gebruikersnaam wijkt af van e-mailadres** alleen als de loginnaam anders is.
3. Onder **Provider**: kies een preset (**Gmail**, **Outlook / Microsoft 365**, **Yahoo**, **iCloud**, **Zoho**) om hosts en poorten in te vullen, of **Custom** voor eigen hosting. Bokito kan een preset voorstellen op basis van het e-maildomein.
4. Controleer **Inkomende mail (IMAP)** (server, poort, versleuteling), daarna optioneel **Uitgaande mail gebruikt dezelfde server als inkomend**, en dan **Uitgaande mail (SMTP)** (server, poort, versleuteling). Open **Hulp nodig bij serverinstellingen?** voor poorten en firewalltips.
5. Kies **Koppelen en controleren**. Bokito logt in op IMAP en SMTP; bij succes verschijnt de rij in **Kanalen** en synchroniseert Inbox-mail naar Communicatie. Antwoorden gaan via SMTP vanaf dit adres.

Faalt de controle met een netwerkfout, dan zijn uitgaande poorten 993, 587 of 465 mogelijk geblokkeerd op de server die de API of workers draait.

## Maak een Bokito-adres aan

1. Kies **Kanaal toevoegen**, daarna **E-mail** en dan **Bokito-adres**.
2. Typ een **Prefix** van 3 tot 24 tekens, alleen letters, cijfers en streepjes. De voorbeeldregel onder **Je adres wordt** toont het volledige adres, bijvoorbeeld `support-acme@in.bokito.ai`.
3. Let op de teller: een workspace heeft maximaal drie adressen. Namen als `postmaster` en `noreply` zijn gereserveerd.
4. Kies **Adres aanmaken** en daarna **Kopiëren**.
5. Deel het adres, of stuur mail vanaf je bestaande mailbox ernaartoe. Inkomende mail landt in [Communicatie](/docs/inbox/communication) en antwoorden gaan vanaf dit adres.

Een Bokito-adres ontvangt en verstuurt; het synchroniseert niet, dus het toont geen mappen of laatste sync.

## Koppel Gmail of Outlook

1. Kies **Kanaal toevoegen** en daarna **E-mail**.
2. Kies **Gmail** of **Outlook** om de inlogprompt van de provider te openen.
3. Terug in de lijst open je het rijmenu voor **Hernoemen**, **Nu synchroniseren**, **Mappen**, **Handtekening**, **Routing**, **Primaire afzender maken** of **Verwijderen**.
4. Staat er **Actie nodig** op de statusbadge, kies dan **Opnieuw koppelen** voordat je verstuurt.

## Hernoem een kanaal

1. Open **Kanalen**.
2. Open het rijmenu van de mailbox of het Bokito-adres en kies **Hernoemen**.
3. Typ een korte weergavenaam (bijvoorbeeld **Support**) en kies **Naam opslaan**. Laat het veld leeg om weer het adres te gebruiken.
4. De naam verschijnt in de kanalenlijst, in de Communicatie-zijbalk en op het reply-tabblad wanneer je vanaf die mailbox verstuurt.

Kopieer of fotografeer geen OAuth-geheimen van gekoppelde accounts.

## Lees de status en controles van een kanaal

1. Bekijk de statusbadge op de rij: **Actief**, **Instellen nodig**, **Verbinden**, **Verminderd**, **Actie nodig**, **Gepauzeerd** of **Fout**.
2. Als een kanaal nog niet klaar is, verschijnt een gele melding boven de lijst. Kanalen met **Instellen nodig**, **Actie nodig** of **Fout** openen hun **Controles** automatisch.
3. De labels ernaast tonen wat het kanaal kan: **Ontvangen**, **Verzenden**, **Sync**. Een kanaal kan **Verzenden** tonen en toch geblokkeerd zijn tot elke verplichte controle OK is.
4. Klik op het pijltje vooraan de rij om **Controles** te openen. Elke controle is één regel, bijvoorbeeld **Aanmelding**, **Gesynchroniseerde mappen**, **Laatste sync** en **Syncfouten** bij een mailbox, of **Inkomende mail**, **Uitgaande mail** en **Mail ontvangen** bij een Bokito-adres.
5. Bij een mailbox bepaalt **Geschiedenis** in hetzelfde paneel hoe ver terug mail wordt bijgehaald bij (opnieuw) koppelen.
6. Gebruik de schakelaar om een kanaal te pauzeren. Een gepauzeerd kanaal houdt zijn historie maar ontvangt niets nieuws.

In Communicatie toont een gesprek dat nog niet kan versturen **Kanaal afmaken** als er al een kanaal is dat nog niet klaar is, of **Mailbox koppelen** als er nog geen kanaal is.

## Zet een handtekening en routing

1. Open het rijmenu van een mailbox en daarna **Handtekening**. Uitgaande mail vanaf die mailbox voegt die toe. Na versturen toont Communicatie diezelfde handtekening in de bubbel (wat de klant ontving).
2. Open **Routing**. De pagina heet **Routingregels**. Kies **Regel toevoegen**. Regels lopen van boven naar beneden; de eerste match wint. Versleep om te herordenen.
3. Zet **Type voorwaarde** op **Afzenderdomein**, **Onderwerp bevat** of **Mailbox**, daarna **Toewijzen aan** een persoon (of **Niet toewijzen**) en optioneel **Labels**. Zet **Regel is actief** aan.
4. Gebruik de kolom **Agent** op de rij om nieuwe gesprekken van dat kanaal naar een specifieke agent te sturen. Zonder route behandelt de **standaardagent** nieuwe gesprekken. Maak één e-mailkanaal **Primair** als je er meerdere hebt.

## Koppel WhatsApp

1. Kies **Kanaal toevoegen** en daarna **WhatsApp Business**. Marketplacekaarten voor deze app sturen je hier ook heen.
2. WhatsApp is een stapsgewijze setup: **Voorbereiden in Meta** (app, nummer, Phone number ID, permanent System User-token), daarna **Plakken in Bokito** (weergavenaam, Telefoonnummer-ID, optioneel WABA-ID, toegangstoken) en **Nummer koppelen**. De Phone number ID is een lang getal uit Meta → WhatsApp → API Setup — niet je telefoonnummer.
3. Na het koppelen toont Bokito **Webhook-URL** en **Verify token**. Plak die in Meta onder WhatsApp → Configuration, abonneer op **messages**, en stuur een testbericht. Tijdelijke Meta-tokens verlopen na 24 uur.
4. Websitechat is de [Chatwidget](/docs/inbox/widget); die rij opent de widgetinstellingen. Na het koppelen verschijnen deze kanalen in de Communicatie-zijbalk.

## Bewaar antwoorden die het team hergebruikt

1. Scroll naar **Opgeslagen antwoorden** op dezelfde pagina (of open `#saved-replies` vanuit de composer).
2. Maak een titel en tekst, of sla een concept op vanuit de composer in een gesprek.
3. Iedereen kan een opgeslagen antwoord invoegen tijdens het antwoorden in Communicatie.

## Kies standaard submappen

1. Scroll naar **Mappen** op dezelfde pagina.
2. Elke kanaal- en agentmap in Communicatie heeft dezelfde submappen: **Open**, **Van mij**, **Niet toegewezen** en **Gesloten**. Submappen verschijnen pas als je op de map klikt. Kies de **Standaard submap** waarmee een map opent, en wijk daar per kanaal of assistent van af.
3. Gesprekken classificeren gaat niet meer met tags op deze pagina: intake-types staan op de pagina [Signalen](/docs/ai/cases), en een gesprek toont zijn signalen in het zijpaneel.

## Wat nu

Stel in wanneer concepten verschijnen onder [Inbox AI](/docs/inbox/inbox-ai). Open Communicatie en wacht op het eerste gesprek.
