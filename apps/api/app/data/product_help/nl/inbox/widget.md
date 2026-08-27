---
title: De websitewidget installeren
intro: Zet Bokito-chat op je site zodat bezoekers in Communicatie landen naast e-mail.
description: Installeer de Bokito-chatwidget, zet Uiterlijk en Stem en uren, en toon hulp-artikelen naast chat.
keywords: widget, websitechat, livechat, installeren, uiterlijk, openingstijden
sort: 40
related: channels,communication,help-centers,widget-embed
---

# De websitewidget installeren

De widget is een klein script op je site. Bezoekers chatten met je assistent. Die gesprekken verschijnen in Communicatie. Open **Instellingen** en daarna **Chatwidget**.

## Kopieer de embed-snippet

![Websitechat-installatie](/api/docs/assets/widget/installation.png)
*Kopieer de snippet onder Installeren.*

1. Open **Instellingen**, daarna **Chatwidget**, daarna **Installeren**.
2. Kopieer **Widget voor websitebezoekers** voor een openbare site. Kopieer **Assistent voor ingelogde gebruikers** alleen wanneer de widget in je eigen product zit en bezoekers zijn ingelogd. Gebruik **Kopiëren** bij de snippet.
3. Plak die eerst op een stagingpagina. Stuur een testbericht en bevestig het gesprek in [Communicatie](/docs/inbox/communication).

Developers volgen de [embed-referentie](/docs/developers/widget-embed).

## Zet Uiterlijk

1. Open **Uiterlijk** op dezelfde pagina.
2. Zet **Behandelende agent** — die agent beantwoordt nieuwe widgetgesprekken. De widgetnaam volgt deze agent tenzij je **Assistentnaam** zet.
3. Onder **Welkomstberichten** zet je **Welkomsttitel** en **Welkomstondertitel**. Onder **Kleuren** kies je **Accent**. **Widgetpictogram** volgt Branding tenzij je een override uploadt. Onder **Wat bezoekers zien** zet je **Home**, **Berichten**, **Help** of **Tools** aan of uit. Kies **Wijzigingen opslaan** en herlaad de stagingpagina. Wegnavigeren met niet-opgeslagen Look-wijzigingen vraagt om bevestiging.

## Zet Stem, uren en het vooraf-formulier

1. Open **Stem en uren**. Onder **Stem** vul je **Toon**, **Wel** en **Niet** in, en kies **Wijzigingen opslaan**. Het model zelf zet je op de agentpagina.
2. Onder **Beschikbaarheid** zet je **Openingstijden** met **Van**, **Tot** en **Tijdzone**, plus **Offlinebericht**. Kies **Beschikbaarheid opslaan**. Buiten die uren toont de widget het offlinebericht. Bezoekers kunnen nog steeds een bericht achterlaten.
3. Zet **Vooraf-formulier** aan wanneer je naam en e-mail wilt vóór het eerste bericht. Die bezoekers worden echte [contacten](/docs/inbox/contacts) in plaats van anonieme websitebezoekers.

## Toon je hulp-artikelen

1. Publiceer Kennis-docs van het soort **Docs** naar je [helpcentrum](/docs/inbox/help-centers).
2. Open op Chatwidget **Uiterlijk**. Onder **Wat bezoekers zien** zet je de module **Help** aan.
3. Bezoekers zien dan jouw artikelen naast chat. De openbare site `/help/{workspace}` is van jou, niet de Bokito-producthulp.

## Wat nu

Koppel een [mailbox](/docs/inbox/channels) zodat chat en e-mail één hub delen. Stel in wanneer de widget antwoordt onder [Inbox AI](/docs/inbox/inbox-ai) (websitechat staat vaak op **Automatisch antwoorden**).
