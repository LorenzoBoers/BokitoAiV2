---
title: Integraties koppelen
intro: Geef agents tools buiten Bokito — marketplace-apps en gekoppelde accounts.
description: Gebruik Verbonden, Marketplace en Gekoppelde tools om apps te installeren, OAuth af te ronden en te sturen wat agents mogen aanroepen.
keywords: integraties, marketplace, verbonden, github, slack, mcp, modules, boekhouding, moneybird
sort: 10
related: mcp,models,channels,govern
---

# Integraties koppelen

Integraties zijn de tools die agents mogen aanroepen. Open **Instellingen** en daarna **Integraties**. De pagina heeft drie tabs: **Verbonden**, **Marketplace** en **Gekoppelde tools**.

## Zie wat gekoppeld is

1. Open **Verbonden**. Dit is de live lijst voor deze workspace.
2. Filter met **Alle integraties**, **Communicatie**, **Repository** of **Tools voor agents**. Het laatste soort wordt onthouden. Gebruik het zoekveld om koppelingen te filteren.
3. Kies **Ontkoppelen** wanneer een tool moet stoppen (bevestig **Deze koppeling verwijderen?**). Inbox-achtige apps verschijnen ook als [kanalen](/docs/inbox/channels). Lege lijsten bieden **Naar Marketplace**.

## Installeer vanuit de marketplace

![Integraties-marketplace](/api/docs/assets/integrations/marketplace.png)
*Marketplace is waar je een nieuwe app installeert.*

1. Open **Marketplace**. Filter op soort, **Alle statussen** / **Verbonden** / **Beschikbaar**, of zoek. Die filters blijven in de URL zodat je ze kunt delen.
2. Kies een app en rond OAuth of de providersetup af. Je keert hier terug na de accountprompt.
3. Communicatie-apps voegen wachtrijen toe (e-mail, Slack, WhatsApp). Repository-apps hangen aan een [project](/docs/ai/projects). Tool-apps landen op **Gekoppelde tools**. Zie [MCP](/docs/integrations/mcp).

WhatsApp zelf configureer je op **E-mail en berichten**, niet alleen hier. De marketplacekaart wijst je daarheen.

## Koppel een boekhoudpakket

1. Open **Marketplace** en vind bovenaan de sectie **Boekhouding**. Die groepeert KING Accountancy, Bjorn Lunden en Moneybird; **Exact Online** en **SnelStart** staan als **Binnenkort**.
2. Kies een pakket en rond de setup af (OAuth voor Moneybird, een API-sleutel voor KING en Bjorn Lunden). Je kunt meerdere pakketten in dezelfde workspace koppelen.
3. Agents gebruiken daarna één gedeelde set boekhoudacties — administraties, relaties, facturen, grootboek, openstaande posten — welk pakket er ook achter zit. Wijzigingen die agents willen doen komen altijd als [beslissing](/docs/ai/decisions) binnen die jij eerst goedkeurt.
4. Op **Verbonden** toont de lijst **Tools voor agents** een groep **Boekhouding** met je administraties. Bij één administratie kiezen agents die automatisch; bij meer zie je ze op een rij.

De secties **Bankieren**, **Beleggen** en **Documenten** in de marketplace zijn modules die klaargezet zijn maar nog niet koppelbaar; hun kaarten tonen de geplande koppelingen.

## Loop een module-setup

Een module is de bedrijfsfunctie (boekhouden, later bankieren). Een pakket is de connector eronder (KING, Moneybird). Jij of de assistent starten dezelfde setup.

1. Open **Marketplace** en kies een moduletitel of **Boekhouding inrichten**. Dat opent de modulepagina onder **Instellingen > Integraties > Module-setup**.
2. Lees wat agents na het koppelen kunnen. Schrijven wordt altijd een [beslissing](/docs/ai/decisions) die jij goedkeurt.
3. Kies een pakket en rond OAuth of de API-sleutel af in dezelfde hub als op Marketplace. `?connect=` opent nog steeds dat pakket.
4. Of vraag de bedrijfsassistent om de workspace in te richten. Na Communicatie, als het werk facturen of btw raakt, kan die de module aanbevelen en **Nu koppelen** op een keuzekaart zetten die dezezelfde pagina opent.

## Zet wat agents mogen aanroepen

1. Open na het koppelen [Govern](/docs/govern/govern) **Beleid**.
2. Zet Integraties (en Berichten, als die kan versturen) zodat agents je niet verrassen.
3. Test eenmaal vanuit een agentgesprek.

## Wat nu

Koppel één tool die je al gebruikt. Voeg een [MCP-server](/docs/integrations/mcp) toe op **Gekoppelde tools** wanneer de marketplace-app niet genoeg is.
