---
title: Integraties koppelen
intro: Geef agents tools buiten Bokito — marketplace-apps en gekoppelde accounts.
description: Gebruik Modules, Verbonden, Marketplace en Gekoppelde tools om apps te installeren, OAuth af te ronden en te sturen wat agents mogen aanroepen.
keywords: integraties, marketplace, verbonden, github, slack, mcp, modules, boekhouding, moneybird
sort: 10
related: mcp,models,channels,govern
---

# Integraties koppelen

Integraties zijn de tools die agents mogen aanroepen. Open **Modules** onder Instellingen op `/modules` om een bedrijfsfunctie te installeren, setup af te ronden en optionele integraties te beheren. Geïnstalleerde modules verschijnen onder **AI → Modules** (bijvoorbeeld Boekhouding). Open **Instellingen → Integraties** voor Verbonden, Marketplace en Gekoppelde tools.

## Zie wat gekoppeld is

1. Open **Verbonden**. Dit is de live lijst voor deze workspace.
2. Filter met **Alle integraties**, **Communicatie**, **Repository**, **Kalender** of **Tools voor agents**. Het laatste soort wordt onthouden. Gebruik het zoekveld om koppelingen te filteren.
3. Kies **Ontkoppelen** wanneer een tool moet stoppen (bevestig **Deze koppeling verwijderen?**). Inbox-achtige apps verschijnen ook als [kanalen](/docs/inbox/channels). Kalender-apps openen op [Agenda](/docs/ai/agenda). Lege lijsten bieden **Naar Marketplace**.

## Installeer vanuit de marketplace

![Integraties-marketplace](/api/docs/assets/integrations/marketplace.png)
*Marketplace is waar je een nieuwe app installeert.*

1. Open **Marketplace**. Hij opent op **Beschikbaar** (klaar om te koppelen), zodat coming-soon-kaarten niet in de weg zitten. Filter op soort (inclusief **Kalender**), **Alle statussen** / **Verbonden** / **Beschikbaar**, of zoek. Die filters blijven in de URL zodat je ze kunt delen.
2. Kies een app en rond OAuth of de providersetup af. Je keert hier terug na de accountprompt.
3. Communicatie-apps voegen wachtrijen toe (e-mail, Slack, WhatsApp). Repository-apps hangen aan een [project](/docs/ai/projects). Kalender-apps syncen naar [Agenda](/docs/ai/agenda). Tool-apps landen op **Gekoppelde tools**. Zie [MCP](/docs/integrations/mcp).

WhatsApp zelf configureer je op **E-mail en berichten**, niet alleen hier. De marketplacekaart wijst je daarheen.

## Installeer een bedrijfsmodule

![Modules-hub](/api/docs/assets/integrations/modules-hub.png)
*Modules-catalogus onder Instellingen — installeren, daarna setup afronden.*

1. Open **Modules** onder Instellingen.
2. Kies **Installeren** bij **Boekhouding** (of een andere live module). Status wordt **Setup**.
3. Wijs op **Setup** (of Overzicht) **minstens één AI-agent** toe. Markeer er één als **Standaard** voor de setup-chat. Alleen toegewezen agents krijgen de tools van deze module.
4. Koppel optioneel een platformintegratie onder **Gebruikt integraties** (KING, Bjorn Lunden, Moneybird). Een koppeling zet de module in setup als die nog niet geïnstalleerd was; agent-toewijzing blijft verplicht.
5. Kies **Doorgaan met toegewezen agent** om pakketten, standaarden en bronnen door te lopen, daarna **Setup afronden**. Status wordt **Geïnstalleerd** en de module verschijnt onder **AI → Modules**.
6. Open de modulewerkplek vanuit het AI-menu, of **Beheren** voor Koppelingen, Bronnen en Setup.

## Koppel een optionele boekhoudintegratie

![Module-home](/api/docs/assets/integrations/module-home.png)
*Module-home toont integraties die de module kan gebruiken, registraties, bronnen en AI-setup.*

1. Open **Modules**, dan **Boekhouding**, dan **Overzicht** (of **Koppelingen**).
2. Kies een integratie en rond setup op het platform af. Je kunt meerdere registraties van dezelfde provider toevoegen.
3. Op **Koppelingen** hernoem je registraties, zet je de **Standaard** die agents moeten gebruiken, en kies je zo nodig een standaardadministratie.
4. Alleen agents die aan de module zijn toegewezen mogen de gedeelde boekhoud-toolset gebruiken. Schrijven komt altijd als [beslissing](/docs/ai/decisions) binnen die jij eerst goedkeurt.

De modules **Bankieren**, **Beleggen** en **Documenten** zijn klaargezet maar nog niet installeerbaar.

## Stuur boekhoudschrijfacties en agent-toegang

1. Open de Boekhouding-werkplek onder **AI → Modules**. De schrijfbanner toont **Schrijven uit — alleen ophalen** of **Schrijven aan — goedgekeurde beslissingen worden uitgevoerd**.
2. Gebruik als owner of admin **Schrijven toestaan in deze workspace** om goedgekeurde beslissingen naar het pakket te laten schrijven. Schrijven blijft uit zolang de platformschakelaar ook uit staat, dus goedkeuringen ronden altijd veilig af.
3. Open op de tab **Setup** van de module het toegangspaneel achter het instellingen-icoon bij een toegewezen agent. Zet **Schrijftoegang** aan zodat die agent boekhoudschrijfacties mag voorstellen; agents zonder deze vlag krijgen alleen leestools.
4. Kies onder **Administratie-scope** de administraties die de agent mag benaderen. Geen selectie betekent toegang tot alle administraties.
5. Elke voorgestelde schrijfactie landt als beslissingskaart met de administratie en de inhoud. Goedkeuren voert de actie alleen uit als beide schrijfschakelaars aan staan.

## Indexeer modulebronnen

1. Open op de module-home de tab **Bronnen**.
2. Platformseeds (voor Boekhouding: RJNet, NBA HRA, Belastingdienst) verschijnen als de module in setup of geïnstalleerd is. Je kunt ze herindexeren of uitschakelen; platformseeds verwijderen kan niet.
3. Kies **URL toevoegen** voor eigen regs of kantoorpagina's. Agents zoeken hierin via modulebron-tools.

## Rond setup af met de toegewezen agent

1. Open op de module-home de tab **Setup**.
2. Wijs minstens één agent toe als dat nog niet gebeurd is, bekijk de checklist en kies **Doorgaan met toegewezen agent**.
3. De standaard toegewezen agent begeleidt optionele integraties, standaarden en bronnen, en kan beslissingen op de thread zetten wanneer goedkeuring nodig is.
4. Ga terug naar de modulepagina en kies **Setup afronden** wanneer de checklist klaar is.

## Zet wat agents mogen aanroepen

1. Open na het koppelen [Govern](/docs/govern/govern) **Beleid**.
2. Zet Integraties (en Berichten, als die kan versturen) zodat agents je niet verrassen.
3. Test eenmaal vanuit een agentgesprek.

## Wat nu

Koppel één tool die je al gebruikt. Voeg een [MCP-server](/docs/integrations/mcp) toe op **Gekoppelde tools** wanneer de marketplace-app niet genoeg is.
