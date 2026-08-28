---
title: Integraties koppelen
intro: Geef agents tools buiten Bokito — marketplace-apps en gekoppelde accounts.
description: Gebruik Modules, Verbonden, Marketplace en Gekoppelde tools om apps te installeren, OAuth af te ronden en te sturen wat agents mogen aanroepen.
keywords: integraties, marketplace, verbonden, github, slack, mcp, modules, boekhouding, moneybird
sort: 10
related: mcp,models,channels,govern
---

# Integraties koppelen

Integraties zijn de tools die agents mogen aanroepen. Open **Modules** in de linkerzijbalk (met label **Nieuw**) op `/modules` om een bedrijfsfunctie aan te zetten en pakketten, bronnen en AI-setup te beheren. Open **Instellingen** en daarna **Integraties** voor Verbonden, Marketplace en Gekoppelde tools.

## Zie wat gekoppeld is

1. Open **Verbonden**. Dit is de live lijst voor deze workspace.
2. Filter met **Alle integraties**, **Communicatie**, **Repository** of **Tools voor agents**. Het laatste soort wordt onthouden. Gebruik het zoekveld om koppelingen te filteren.
3. Kies **Ontkoppelen** wanneer een tool moet stoppen (bevestig **Deze koppeling verwijderen?**). Inbox-achtige apps verschijnen ook als [kanalen](/docs/inbox/channels). Lege lijsten bieden **Naar Marketplace**.

## Installeer vanuit de marketplace

![Integraties-marketplace](/api/docs/assets/integrations/marketplace.png)
*Marketplace is waar je een nieuwe app installeert.*

1. Open **Marketplace**. Hij opent op **Beschikbaar** (klaar om te koppelen), zodat coming-soon-kaarten niet in de weg zitten. Filter op soort, **Alle statussen** / **Verbonden** / **Beschikbaar**, of zoek. Die filters blijven in de URL zodat je ze kunt delen.
2. Kies een app en rond OAuth of de providersetup af. Je keert hier terug na de accountprompt.
3. Communicatie-apps voegen wachtrijen toe (e-mail, Slack, WhatsApp). Repository-apps hangen aan een [project](/docs/ai/projects). Tool-apps landen op **Gekoppelde tools**. Zie [MCP](/docs/integrations/mcp).

WhatsApp zelf configureer je op **E-mail en berichten**, niet alleen hier. De marketplacekaart wijst je daarheen.

## Open de Modules-hub

![Modules-hub](/api/docs/assets/integrations/modules-hub.png)
*Modules is een first-class rail-oppervlak voor bedrijfsfuncties.*

1. Open **Modules** in de linkerzijbalk.
2. Zet **Boekhouding** (of een andere live module) op **Aan**. Het badge gaat van **Uit** naar **Aan**.
3. Kies **Boekhouding beheren** (of **Pakket koppelen**) om de module-home te openen.
4. Op de module-home gebruik je de tabs: **Overzicht**, **Koppelingen**, **Bronnen** en **Setup**.

## Koppel een boekhoudpakket

![Module-home](/api/docs/assets/integrations/module-home.png)
*Module-home houdt pakketten, registraties, bronnen en AI-setup bij.*

1. Open **Modules**, dan **Boekhouding**, dan **Overzicht** (of **Koppelingen**).
2. Kies een pakket (KING Accountancy, Bjorn Lunden of Moneybird) en rond de setup af. Je kunt meerdere registraties van hetzelfde pakket toevoegen.
3. Op **Koppelingen** hernoem je registraties, zet je de **Standaard** die agents moeten gebruiken, en kies je zo nodig een standaardadministratie.
4. Agents gebruiken daarna één gedeelde set boekhoudacties. Schrijven komt altijd als [beslissing](/docs/ai/decisions) binnen die jij eerst goedkeurt.

De modules **Bankieren**, **Beleggen** en **Documenten** zijn klaargezet maar nog niet koppelbaar.

## Indexeer modulebronnen

1. Open op de module-home de tab **Bronnen**.
2. Platformseeds (voor Boekhouding: RJNet, NBA HRA, Belastingdienst) verschijnen als de module aan staat. Je kunt ze herindexeren of uitschakelen; platformseeds verwijderen kan niet.
3. Kies **URL toevoegen** voor eigen regs of kantoorpagina's. Agents zoeken hierin via modulebron-tools.

## Rond setup af met de bedrijfsassistent

1. Open op de module-home de tab **Setup**.
2. Bekijk de checklist en kies **Doorgaan met bedrijfsassistent**.
3. De bedrijfslead begeleidt aanzetten, pakketten, standaarden en bronnen, en kan beslissingen op de thread zetten wanneer goedkeuring nodig is.

## Zet wat agents mogen aanroepen

1. Open na het koppelen [Govern](/docs/govern/govern) **Beleid**.
2. Zet Integraties (en Berichten, als die kan versturen) zodat agents je niet verrassen.
3. Test eenmaal vanuit een agentgesprek.

## Wat nu

Koppel één tool die je al gebruikt. Voeg een [MCP-server](/docs/integrations/mcp) toe op **Gekoppelde tools** wanneer de marketplace-app niet genoeg is.
