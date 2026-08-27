---
title: Kanalen koppelen
intro: Breng klantmail en andere inboxen naar Communicatie.
description: Gebruik het ingebouwde Bokito-adres of koppel Gmail en Outlook, plus handtekeningen, routing en sjablonen.
keywords: kanalen, gmail, outlook, mailbox, bokito-adres, routing, handtekening
sort: 20
related: communication,inbox-ai,widget,integrations
---

# Kanalen koppelen

Kanalen zijn hoe klanten de workspace bereiken. Open **Instellingen** en daarna **E-mail en berichten**. Elke workspace heeft al een Bokito-adres; voeg Gmail of Outlook toe wanneer mail vanaf je eigen domein moet vertrekken.

## Gebruik het Bokito-adres

1. Open **Instellingen** en daarna **E-mail en berichten**.
2. Kopieer bovenaan **Je Bokito-adres**. Het is ingebouwd en klaar om te ontvangen.
3. Deel het, of zet doorsturen vanaf een bestaande mailbox. Inbound mail landt in [Communicatie](/docs/inbox/communication). Antwoorden gaan vanaf dit adres.

Kopieer of fotografeer geen OAuth-geheimen van gekoppelde accounts.

## Koppel Gmail of Outlook

![Kanaalinstellingen met mailboxen](/api/docs/assets/channels/mailbox-status.png)
*Mailboxstatus, sync en routing staan bij E-mail en berichten.*

1. Kies **Mailbox koppelen** en start **Gmail** of **Outlook**.
2. Rond de accountprompt af. Wacht tot inbound mail als gesprekken verschijnt.
3. Open het rijmenu voor **Nu synchroniseren**, **Mappen**, **Handtekening**, **Routing**, **Primair maken** of **Verwijderen**. Outlook-**Mappen** opent **Mappen kiezen om te synchroniseren**.
4. Als de status verlopen is of auth nodig heeft, koppel opnieuw voordat je verstuurt.

Het ingebouwde Bokito-adres hoeft niet te synchroniseren of opnieuw te koppelen. Gekoppelde mailboxen tonen de laatste sync.

## Zet een handtekening en routing

1. Blijf op E-mail en berichten. Open het mailboxmenu en daarna **Handtekening**. Uitgaande mail vanaf die mailbox voegt die toe.
2. Open **Routing**. De pagina heet **Routingregels**. Kies **Regel toevoegen**. Regels lopen van boven naar beneden; de eerste match wint. Versleep om te herordenen.
3. Zet **Type voorwaarde** op **Afzenderdomein**, **Onderwerp bevat** of **Mailbox**, daarna **Toewijzen aan** een persoon (of **Niet toewijzen**) en optioneel **Labels**. Zet **Regel is actief** aan.
4. Scroll naar **Kanaalrouting** (los van mailboxregels). Kies **Route toevoegen**, kies het kanaal, optioneel account, prioriteit en agent. **Pauzeren** zet een route uit zonder te verwijderen. Zonder route behandelt de **lead agent** nieuwe gesprekken. Maak één mailbox **Primair** als je er meerdere hebt.

## Bewaar antwoorden die het team hergebruikt

1. Scroll naar **Opgeslagen antwoorden** op dezelfde pagina (of open `#saved-replies` vanuit de composer).
2. Maak een titel en tekst, of sla een concept op vanuit de composer in een gesprek.
3. Iedereen kan een opgeslagen antwoord invoegen tijdens het antwoorden in Communicatie.

## Koppel WhatsApp of Slack

1. Blijf op E-mail en berichten. Scroll naar **WhatsApp** of **Slack**. Marketplacekaarten voor deze apps sturen je hier ook heen.
2. Voor WhatsApp kies je **WhatsApp koppelen**. Vul **Telefoonnummer-ID** en **Toegangstoken** in (een permanent System User-token) en kies **Nummer koppelen**. Kopieer **Webhook-URL** en **Verify token** naar het Meta App Dashboard onder WhatsApp, Configuration. Tijdelijke Meta-tokens verlopen na 24 uur.
3. Voor Slack kies je **Slack koppelen**. Vul **Bot-token** en **Signing secret** in en kies **Workspace koppelen**. Kopieer **Events-URL** en **Interactivity-URL** naar je Slack-app. Keuzekaarten kunnen daar binnenkomen met **Goedkeuren** en **Weigeren**.
4. Websitechat is de [Chatwidget](/docs/inbox/widget). Na het koppelen verschijnen die kanalen in de Communicatie-zijbalk.

## Wat nu

Stel in wanneer concepten verschijnen onder [Inbox AI](/docs/inbox/inbox-ai). Open Communicatie en wacht op het eerste gesprek.
