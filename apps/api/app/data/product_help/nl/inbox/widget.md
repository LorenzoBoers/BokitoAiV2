---
title: De websitewidget installeren
intro: Zet Bokito-chat op je site zodat bezoekers in Communicatie landen naast e-mail.
description: Installeer de Bokito-chatwidget, zet Uiterlijk en Stem, live overdracht op beschikbaarheid, doorgaan op WhatsApp en hulpartikelen naast chat.
keywords: widget, websitechat, livechat, installeren, uiterlijk, beschikbaarheid, live overdracht, whatsapp
sort: 40
related: channels,communication,widget-embed,categories,assistant
---

# De websitewidget installeren

De widget is een klein script op je site. Bezoekers chatten met je assistent. Die gesprekken verschijnen in Communicatie. Voeg eerst **Websitechat** toe via **Instellingen → Kanalen → Kanaal toevoegen**; een nieuwe workspace maakt die niet automatisch aan. Open die rij voor uiterlijk, uren en de embed-snippet. Voeg een tweede **Websitechat** toe als een andere site een eigen embed nodig heeft.

## Kopieer de embed-snippet

![Websitechat-installatie](/api/docs/assets/widget/installation.png)
*Kopieer de snippet onder Installeren.*

1. Open **Instellingen**, daarna **Kanalen**, daarna de rij **Websitechat**, daarna **Installatie**.
2. Kopieer **Widget voor websitebezoekers** voor een openbare site. Kopieer **Assistent voor ingelogde gebruikers** alleen wanneer de widget in je eigen product zit en bezoekers zijn ingelogd. Gebruik **Kopiëren** bij de snippet. De snippet bevat `data-channel-id` zodat deze site dit kanaal gebruikt.
3. Als Installatie waarschuwt dat de snippet een lokale ontwikkel-URL gebruikt (`localhost` of `127.0.0.1`), plak die alleen voor lokale tests. Voor een live website open je dit kanaal in je productie-workspace en kopieer je de snippet daar.
4. Plak die eerst op een stagingpagina. Stuur een testbericht en bevestig het gesprek in [Communicatie](/docs/inbox/communication).

Developers volgen de [embed-referentie](/docs/developers/widget-embed).

## Zet Uiterlijk

1. Open **Uiterlijk** op dezelfde pagina.
2. Zet **Behandelende agent** — die agent beantwoordt nieuwe widgetgesprekken. Nieuwe werkruimtes starten met **Front desk** (de klantgerichte agent). De widgetnaam volgt deze agent tenzij je **Assistentnaam** zet.
3. Onder **Welkomstberichten** zet je **Welkomsttitel** en **Welkomstondertitel**. Onder **Kleuren** kies je **Accent**. **Widgetpictogram** volgt Branding tenzij je een override uploadt. Onder **Wat bezoekers zien** zet je **Home**, **Berichten**, **Help** of **Tools** aan of uit. Wijzigingen worden automatisch opgeslagen (**Laatst gewijzigd** in de kop). Herlaad de stagingpagina om de live widget te zien.

De chat gebruikt hetzelfde wolkjesontwerp als [Communicatie](/docs/inbox/communication): berichten van dezelfde afzender binnen vijf minuten stapelen tot één groep, het eerste wolkje draagt het avatar en de naam, het laatste de tijd. Antwoorden van de assistent tonen het agent-avatar met een **AI**-label; een antwoord van een collega toont een **Team**-label, zodat bezoekers zien wie antwoordde.

## Zet Stem, live overdracht en het vooraf-formulier

1. Open **Stem en beschikbaarheid**. Onder **Stem** vul je **Toon**, **Wel** en **Niet** in — ze worden automatisch opgeslagen. Het model zelf zet je op de agentpagina.
2. Onder **Beschikbaarheid** toont **Live overdracht** **Iemand beschikbaar** of **Niemand beschikbaar**. Er zijn geen vaste uren: een bezoeker kan om een mens vragen zodra iemand met Afhandelen-toegang op de widget beschikbaar is (zie [Team](/docs/getting-started/team) voor **Afwezig**). Anders zegt de agent dat eerlijk en biedt opvolging per e-mail, een terugbelverzoek of doorgaan op WhatsApp aan.
3. **Vooraf-formulier** staat aan op een nieuwe widget. Het vraagt één keer om een e-mailadres vóór het eerste bericht; de naam is optioneel. **Start met chatten** heeft een geldig e-mailadres nodig. **Overslaan** gaat verder zonder en vraagt in die browser niet opnieuw. Een opgegeven e-mailadres wordt een [contact](/docs/inbox/contacts). Zet het formulier hier uit wanneer je het niet wilt.
4. In de chatcomposer kunnen bezoekers dicteren met de microfoon als de browser spraakherkenning ondersteunt (zelfde patroon op de websitewidget en de in-app-assistent): houd ingedrukt om te praten of klik om te starten; tijdens luisteren toont de knop een groene glow en golfbalken, met een vinkje bij hover om te bevestigen. Commit-/dedupe-regels en golfgeometrie delen Messages en de widget via `@bokito/shared`.
5. Bezoekers kunnen opnieuw versturen terwijl de assistent nog antwoordt. De widget stopt het onvoltooide antwoord, houdt beide bezoekersberichten zichtbaar, en start een nieuw antwoord dat ze samen meeneemt. Alleen typen stopt de assistent niet — wel Versturen of Stop. Na Versturen blijft het berichtvak gefocust voor de volgende regel.

De websitewidget volgt het lichte of donkere systeemthema van de bezoeker. Er zit geen thema-schakelaar in de widget. Light en Dark op deze pagina zijn alleen om contrast te controleren.

## Ga verder op WhatsApp

Als niemand beschikbaar is, kan de agent het gesprek naar WhatsApp verplaatsen zodat de bezoeker niet op de website hoeft te wachten.

1. Koppel eerst een WhatsApp-kanaal (zie [Kanalen](/docs/inbox/channels)).
2. Open **Stem en beschikbaarheid**. Zet onder **Beschikbaarheid** **Doorgaan op WhatsApp** aan en kies het **WhatsApp-kanaal**. Vul **WhatsApp-nummer** alleen in als de pagina erom vraagt; na het eerste WhatsApp-bericht kent het kanaal zijn eigen nummer. Kies **Beschikbaarheid opslaan**.
3. Vraagt een bezoeker om een mens terwijl niemand beschikbaar is, dan biedt de agent een WhatsApp-link aan met het bericht al ingevuld. De bezoeker drukt alleen op versturen.
4. Dat bericht start een WhatsApp-gesprek met hetzelfde contact en dezelfde eigenaar. Het begint met een korte samenvatting, wacht op een mens, en de websitechat sluit met **Doorgezet naar WhatsApp**.

Een link werkt één keer en zeven dagen lang. Een WhatsApp-bericht zonder geldige link start een gewoon gesprek.

## Toon je hulp-artikelen

1. Publiceer Kennis-docs van het soort **Docs** vanuit [Kennis](/docs/ai/knowledge) met **Publiceren**.
2. Open op het websitechat-kanaal **Uiterlijk**. Onder **Wat bezoekers zien** zet je de module **Help** aan.
3. Bezoekers zien dan jouw artikelen naast chat. De openbare site `/help/{workspace}` is van jou, niet de Bokito-producthulp.

## Wat nu

Koppel een [mailbox](/docs/inbox/channels) zodat chat en e-mail één hub delen. Stel in wanneer de widget antwoordt onder [AI-afhandeling](/docs/inbox/inbox-ai) (websitechat staat vaak op **Autonoom**). Met **AI-antwoorden vermelden** aan tonen autonome antwoorden een korte vermelding onder de bubbel. Een verzoek dat in de chat herkend wordt, wordt een [ticket](/docs/ai/categories) op het gesprek, geen tweede inbox.
