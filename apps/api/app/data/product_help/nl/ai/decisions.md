---
title: Beslissingen goedkeuren en afwijzen
intro: Agents vragen in het gesprek om jouw oordeel. Elke open goedkeuring staat in Communicatie onder Beslissingen.
description: Keur goed, bewerk of wijs af via de keuzekaart in het gesprek, via de map Beslissingen, Cockpit of een notificatie.
keywords: beslissingen, goedkeuringen, decision requests, notificaties, human in the loop, alles afwijzen, dubbele vragen
sort: 20
related: communication,agent-runs,autonomy,govern
---

# Beslissingen goedkeuren en afwijzen

Een DecisionRequest is een bericht in het gesprek, en daar handel je hem ook af. Wil je elk gesprek met een open kaart zien — klant en intern samen — open dan **Beslissingen** in de Communicatie-zijbalk.

Automatische mail (bonnen, nieuwsbrieven, no-reply-afzenders) stelt geen beslissingen. De agent noteert die stil in het gesprek. Als tipkaarten van eerdere mail zich hebben opgestapeld, open [Agents](/docs/ai/agents) en gebruik **Tipkaarten wissen**.

## Vind een wachtende beslissing

![Een wachtende beslissing in het gesprek](/api/docs/assets/decisions/approve.png)
*Open het gesprek via Beslissingen, Cockpit of een notificatie.*

1. Open **Communicatie**, dan **Beslissingen**. Cockpit **Wacht op beslissing** / **Vraagt aandacht** en het bel-menu landen op dezelfde lijst. Een badge **Wacht op beslissing** markeert de rijen.
2. Selecteer een gesprek (de eerste match opent automatisch) en scroll naar de keuzekaart. Die toont de voorgestelde actie en waarom de agent stopte.
3. Als niets op jou wacht, toont Beslissingen een lege staat met links terug naar de inbox en Agents.

## Goedkeuren, bewerken of afwijzen

1. Lees het voorstel in de context van het gesprek.
2. Kaarten gebruiken de actie die nodig is: **Goedkeuren**, **Afwijzen**, **Bewerken**, **Escaleren**, **Uitstellen**, **Later**, **Gesprek sluiten**, **Wat nu** of **Open houden**. Conceptantwoord-kaarten van [AI-afhandeling](/docs/inbox/inbox-ai) gebruiken **Versturen**, **Bewerken** of **Escaleren**.
3. Een voorgesteld chatantwoord kan uit meerdere korte berichten bestaan. De kaart toont ze als **Bericht 1**, **Bericht 2** enzovoort. Kies **Bericht verwijderen** bij een bericht dat je niet wilt, of **Bewerken** om ze als één tekst te herschrijven; een lege regel start een nieuw bericht. **Versturen** levert ze op volgorde af.
4. Hover over een agentbericht: naast de bubbel verschijnen iconen voor **Klopt** of **Niet nuttig**, en het tekstballon-icoon (**Corrigeer dit**) leert de agent. Hover een icoon voor het label. Escaleren zet het gesprek op Handmatig en wijst jou toe.

## Wijs dezelfde vraag in bulk af

Wanneer een check-in of agent dezelfde vraag vaak heeft gesteld (bijvoorbeeld *Google Sheets-integratie instellen?* bij elke run), hoef je niet elke kaart apart af te wijzen.

1. Open **Communicatie**, dan **Beslissingen**. Boven de lijst toont de banner **Dezelfde vraag, veel kaarten** elke vraag die twee of meer keer wacht, met het aantal.
2. Kies **Alles afwijzen** op een rij. Elke open kaart met die titel wordt uitgesteld en verdwijnt uit Beslissingen en het belmenu; er wordt niets uitgevoerd.
3. De agent ziet een afwijzing als een nee voor dat onderwerp en stelt de vraag voorlopig niet opnieuw. Kaarten in een gesprek blijven daar zichtbaar als beantwoord; het gesprek zelf blijft open.
4. Een vraag die niet over een gesprek gaat en geen actie heeft om uit te voeren wordt niet meer als kaart gesteld: de agent schrijft die in zijn eigen kanaal. Vraagt een agent iets over een gesprek, dan noemt hij het onderwerp en landt de kaart op dat gesprek.

## Leer de agent voor de volgende keer

1. Op een kaart die vraagt voor een actie biedt de rij **Volgende keer:** drie knoppen.
2. **Dit mag je voortaan zelf** stelt een regel voor waarmee de agent dit zelf doet. **Altijd vragen** stelt een regel voor die blijft vragen. Beide komen als kaart in hetzelfde gesprek; bevestig die daar. Alleen een eigenaar of beheerder kan een regel bevestigen waarmee een agent zelf handelt.
3. **Weet ik nog niet** bewaart het geval als voorbeeld. Na een paar voorbeelden stelt de agent er zelf een regel uit voor.
4. Regels staan op de agent onder **Regels** (zie [Agents](/docs/ai/agents)).

## Wie de vraag krijgt

Elke vraag gaat naar één geadresseerde: de persoon of het team in **Vragen stellen aan** van de agent, anders de eigenaar van het gesprek, anders wie het werk overdroeg, anders het eigenaarsteam. Wie afwezig is, wordt overgeslagen. Beantwoordt één persoon steeds de vragen over hetzelfde onderwerp, dan stelt Govern een routeringsregel voor zoals *Vragen over facturen naar Lisa*; na akkoord gaan die vragen eerst naar die persoon.

## Antwoorden vanuit een notificatie

1. Kies de beslissing in het belmenu, of open de pushmelding op je telefoon. Beide openen Beslissingen op dat gesprek en springen direct naar de wachtende kaart.
2. Lees de bronregel op de kaart: die noemt waar de vraag vandaan komt — een projectqueue, een agentrun of een voorgestelde workspacewijziging — en linkt ernaartoe.
3. Antwoord in het gesprek. Geassisteerde concepten hebben nog een menselijke verzending nodig; alleen autonome gesprekken versturen zelf.
4. Onder **Instellingen**, daarna **Notificaties**, open **Meld me over**. Zet **In-app**, **E-mail**, **Push** of **Slack** per rij aan — bijvoorbeeld **Wanneer een agent je beslissing nodig heeft bij een toegewezen gesprek**, **Wanneer een klant een medewerker vraagt**, **Wanneer een agent-run of trigger faalt**, of budgetwaarschuwingen bij 80% / 100%. Gebruik **Pauzeer in-app meldingen**, **Herstel aanbevolen**, of **Bekijk een voorbeeld** wanneer je de set afstemt. Push geldt alleen voor deze browser; koppel Slack onder **Kanalen** voordat Slack-schakelaars werken.

## Werk aan een codingtool geven

Wanneer een agent voorstelt codingwerk aan Cursor, Claude Managed Agents of Devin te geven, keur je die Beslissing goed zoals elke andere. Na goedkeuring blijven voortgang en vervolgvragen in hetzelfde gesprek — zie [Geef werk aan een codingtool](/docs/developers/workbench).

## Wanneer agents vragen

De workspace-[autonomiehouding](/docs/govern/autonomy) zet de standaard. Op [Govern](/docs/govern/govern) **Beleid** is elke toolcategorie **Weigeren**, **Eerst vragen** of **Toestaan**. **Eerst vragen** maakt de kaart die je in het gesprek ziet. Overrides per agent op de agentpagina winnen van de categorie.

Begin met **Assisted**. Verplaats stappen die je altijd goedkeurt naar **Toestaan**. Houd **Eerst vragen** voor de risicovolle.

## Wat nu

Structurele workspace-wijzigingen wachten op Govern **Openstaande reviews**, niet in het gesprek. Audit later onder Govern **Recente audit**.
