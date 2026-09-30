---
title: Verbindingen en modules in V2
intro: Kanalen, modellen, tools en modules waarmee de workspace is verbonden, elk met een eigen disclosure-schakelaar.
description: Koppel e-mail, WhatsApp en websitechat in V2, breng je eigen modelsleutel mee, voeg een MCP-server, een codeer-workbench of een bedrijfsintegratie toe en installeer de boekhoudmodule met Moneybird.
keywords: v2, verbindingen, kanalen, e-mail, whatsapp, widget, modelprovider, byok, mcp-server, workbench, cursor, integratie, moneybird, modules
sort: 60
related: v2-communication,v2-govern,v2-developers
---

# Verbindingen en modules in V2

**Verbindingen** toont waar klanten naar je schrijven, welke modellen antwoorden en welke tools en systemen agents mogen aanroepen. **Modules** op dezelfde pagina voegen signaaltypes, draaiboeken en tools toe voor een werkgebied; ze voegen nooit een scherm toe.

## Een kanaal koppelen

Elk kanaal heeft een eigen AI-disclosure-schakelaar en de agent die zijn threads beheert.

1. Open **Verbindingen**. Druk onder **Kanalen** op **E-mail toevoegen**, **WhatsApp toevoegen** of **Websitechat toevoegen**.
2. Geef het een **Naam**, kies een **Provider** en vul het **Adres** en de gegevens in die de provider vraagt.
3. Kies de **Agent** die nieuwe threads op dit kanaal beheert.
4. Houd **AI-disclosure op uitgaand** aan, tenzij een jurist anders heeft gezegd. AI-geschreven antwoorden krijgen de disclosure-regel uit **Govern**.
5. Druk op **Controleren**. E-mail en WhatsApp tonen de **Webhook-URL** om bij de provider te registreren; websitechat toont het fragment onder **Insluiten** voor je site.

## Je eigen modelsleutel meebrengen

Zonder sleutel wordt het EU managed model gebruikt en per aanroep gemeten.

1. Druk onder **Modellen** op **Modelprovider toevoegen**.
2. Kies de **Provider**, plak de sleutel en stel de **Regio** in.
3. Druk op **Controleren**. Agents met een leeg **Model** schakelen naar de workspace-standaard; kies deze provider per agent onder **Werk**, **Agents** als dat nodig is.
4. Controleer na een dag het **EU-aandeel** onder **Govern**, **Verbruik**.

## Een toolbron toevoegen

Onder **Tools en integraties** bestaan drie soorten.

- **MCP-server**: een externe MCP-server waarvan agents de tools onder jouw beleid mogen aanroepen.
- **Workbench**: een codeer-agentdienst. Met een Cursor-API-sleutel geeft een agent een repositorytaak door aan Cursor cloud agents; voortgang en de pull request komen terug in de oorspronkelijke thread.
- **Integratie**: een bedrijfssysteem, bijvoorbeeld Moneybird. Gebruikt door modules.

1. Druk op **Workbench toevoegen**, geef een naam, kies provider **cursor** en plak de API-sleutel.
2. Druk op **Controleren**. De getoonde **Webhook-URL** wordt bij elke opdracht automatisch geregistreerd.
3. Vraag in een willekeurige thread via **Vraag agent** om werk door te geven aan de workbench, bijvoorbeeld: *Herstel de typefout op de prijspagina in repo acme/site en open een PR.*
4. Volg de opdracht onder **Werk**, **Runs**; de afgeronde run linkt naar de pull request.

## De boekhoudmodule installeren

De eerste module koppelt Moneybird en voegt de signaaltypes **Invoice question** en **Payment reminder**, twee draaiboeken en drie tools toe.

1. Druk onder **Tools en integraties** op **Integratie toevoegen**, provider **moneybird**, en plak het API-token en de administratie-id. Druk op **Controleren**.
2. Onder **Modules** toont de kaart **Accounting (Moneybird)** de status **Beschikbaar**. Druk op **Installeren**.
3. Kies de **Verbinding** en stel **reminder_days** in.
4. Bevestig. De samenvatting luidt *Accounting (Moneybird) geinstalleerd: 2 signaaltypes, 2 draaiboeken.*
5. De tools `moneybird_find_contact` en `moneybird_list_invoices` werken nu voor agents; `moneybird_send_invoice` staat op **Altijd vragen** en vraagt een beslissing in de thread. Druk op **Verwijderen** om de types en draaiboeken weer uit te schakelen; de historie blijft.

## Wat nu

- Bepaal wat agents met de nieuwe tools mogen: [/docs/v2/v2-govern](/docs/v2/v2-govern)
- Roep dezelfde tools aan vanuit Cursor of een script: [/docs/v2/v2-developers](/docs/v2/v2-developers)
