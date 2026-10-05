---
title: Integraties koppelen
intro: Geef agents tools buiten Bokito — marketplace-apps en gekoppelde accounts.
description: Gebruik Koppelingen en Marketplace om modules te installeren, partnerlogins te koppelen en te sturen wat agents mogen aanroepen.
keywords: integraties, marketplace, verbonden, github, mcp, modules, boekhouding, moneybird, koppelingen
sort: 10
related: mcp,models,channels,govern,cases
---

# Integraties koppelen

Integraties zijn partnerlogins. Een **module** is één pakket met Signaaltypen, draaiboeken en optioneel een Project, plus de tools voor toegestane partners. De **Koppelingen**-hub in de zijbalk op `/connections` is de geïnstalleerde inventaris: modules die aan staan, partnerlogins en custom MCP-servers. **Marketplace** is de volledige catalogus — elke module en integratie, zonder filter Verbonden/Beschikbaar. Een module installeren voegt nooit een zijbalkitem toe; open de module vanuit Koppelingen. Alleen koppelen geeft agents geen tools; installeer de module en wijs een agent toe.

## Zie wat gekoppeld is

1. Open **Koppelingen**. De banner **AI (coding) tools** staat boven de tabs **Koppelingen** / **Marketplace**: logo's van Cursor, Claude, OpenAI, VS Code, Windsurf en Copilot, en **Koppelen** opent Developers. **Geïnstalleerde modules** gebruiken dezelfde kaarten als de Marketplace: status (inclusief **Installatie incompleet** zonder pakket), partnerlogo's, **Beheren** en **Deïnstalleren**. Ontbrekende eerste stappen kunnen daaronder staan (**Koppel e-mail of chat**, **Koppel Agenda**, **Installeer een module**). Daarna **Koppelingen**: elke gekoppelde integratie als dezelfde kaart als op Marketplace — één kaart per product (Microsoft 365, Outlook Calendar en Microsoft Graph staan los). Soort-chips en zoeken blijven. Mailboxen openen **Kanalen** vanuit de kaart; Agenda-apps openen [Agenda](/docs/ai/agenda). **Custom MCP-servers** blijft een aparte lijst voor logins die niet in de catalogus staan.
2. Kies **Nieuwe koppeling** op een kaart voor een tweede login. Hang een partner aan Boekhouding vanaf de modulepagina (**Deze koppeling gebruiken**), niet vanaf een gegroepeerde programmarij. GitHub blijft een **Code**-kaart.
3. Kies **Ontkoppelen** op een custom MCP-rij wanneer die login moet stoppen (bevestig **Deze koppeling verwijderen?**). Mailboxen en agenda's beheer je onder Kanalen en Agenda.

## Installeer vanuit de marketplace

![Integraties-marketplace](/api/docs/assets/integrations/marketplace.png)
*Marketplace: modules bovenaan, daaronder elke integratie in één platte lijst.*

1. Open **Marketplace**. Je landt op **Koppelingen** voor wat al geïnstalleerd is; Marketplace toont **alles**. **Modules** staat bovenaan, **Integraties** eronder als één platte lijst — nooit genest in een module, en nooit gegroepeerd onder een vendor. Microsoft 365, Outlook Calendar en Microsoft Graph hebben elk een eigen kaart. Filter integraties op soort (**Communicatie**, **Agenda**, **Apps**, **Tools**, **Code**) of zoek — er is geen statusfilter Verbonden/Beschikbaar. **Koppelen** is de eerste login; staat er al een, dan **Nieuwe koppeling** plus het aantal. Een module die niet geïnstalleerd is toont alleen **Installeren**. Een geïnstalleerde module toont **Beheren** (grijs) en **Deïnstalleren** (rood). **Beleggen**, **Documenten** en andere coming-soon modules staan faded. Hun geplande programma's (Tink, Yapily, Knab, Twelve Data, Bitvavo, TradingView, Google Drive, OneDrive / SharePoint, Dropbox) verschijnen als faded integratiekaarten tot ze live gaan.
2. Kies een kaart om de setup van dat product te openen. **Werkt met modules** noemt de presets die deze login kunnen gebruiken, zodat je weet wat agents ermee doen. Rond OAuth of de providersetup af; je keert terug op Koppelingen. Een login blijft daar tot je hem aan een module hangt.
3. Communicatie-apps voegen wachtrijen toe (e-mail, WhatsApp). Code-apps hangen aan een [project](/docs/ai/projects). Agenda-apps syncen naar [Agenda](/docs/ai/agenda). Tool-apps landen onder **Custom MCP-servers** of **Tools**. Zie [MCP](/docs/integrations/mcp).

WhatsApp zelf configureer je onder **Kanalen**, niet alleen hier. De marketplacekaart wijst je daarheen.

## Installeer een bedrijfsmodule

![Modules-hub](/api/docs/assets/integrations/modules-hub.png)
*Koppelingen-hub — geïnstalleerde modules als kaarten, daarna partnerlogins.*

1. Open **Koppelingen** in de zijbalk onder **Organisatie**. Geïnstalleerde modulekaarten staan bovenaan met **Beheren** en **Deïnstalleren**. Gebruik **Marketplace** en de rij **Modules** om een nieuwe preset te installeren.
2. Open **Boekhouding** (of een andere live module) en kies **Installeren**. Status wordt **Nog inrichten**.
3. Wijs **minstens één AI-agent** toe. Markeer er één als **Standaard** voor de setup-chat. Alleen toegewezen agents krijgen de tools van deze module.
4. Bekijk **Wat agents kunnen doen**: elke module-actie toont een korte beschrijving, het universele pad (`accounting_list_companies`, …) en of het **Lezen** of **Goedkeuring nodig** is. Als partners gekoppeld zijn, toont **Tools van gekoppelde MCP-servers** de exacte MCP-toolnamen van die servers.
5. Bovenaan de modulepagina, onder **Koppelingen**, kies je **Nieuwe registratie** om in één stap te koppelen en toe te voegen, of **Bestaande koppeling gebruiken** voor een login die al op Koppelingen staat. Geplande pakketten (Exact Online, SnelStart) blijven grijs. De overige tabs zijn **Overzicht**, **Bronnen** en **Setup**.
6. Kies **Doorgaan met toegewezen agent** om standaarden en bronnen door te lopen, daarna **Inrichten afronden**. Status wordt **Installatie incompleet** tot er een partnerlogin hangt, daarna **Gekoppeld**. Signaaltypen en draaiboeken blijven via hun bestaande productschermen bereikbaar; de module blijft onder Koppelingen en voegt geen zijbalkitem toe.

## Koppel een optionele boekhoudintegratie

![Module-home](/api/docs/assets/integrations/module-home.png)
*Modulepagina toont registraties bovenaan, daarna Overzicht, Bronnen en Setup.*

1. Open **Boekhouding** via de kaart op **Koppelingen**. Registraties staan bovenaan de modulepagina (niet op een aparte tab). De lijst toont alleen attached registraties, niet elke Moneybird-login in de workspace.
2. Kies **Nieuwe registratie** om vanuit de module te koppelen (die login wordt automatisch attached), of **Deze koppeling gebruiken** voor een login die al op Koppelingen staat.
3. Rond setup af met echte credentials (OAuth voor Moneybird, partner key plus administraties voor KING, client id/secret voor Bjorn Lunden, Trading API-key plus secret voor Alpaca). Alleen een willekeurige naam maakt geen werkende koppeling.
4. Elke rij toont status (**Geverifieerd**, **Credentials nodig**, **Niet geverifieerd** of **Fout**), optionele provider-identiteit, en acties: **Verifiëren**, **Uit module halen** (de login blijft op Koppelingen), **Ontkoppelen**, **Hernoemen** en **Als standaard** (alleen als geverifieerd).
5. Alleen agents die aan de module zijn toegewezen mogen de gedeelde boekhoud-toolset gebruiken. Propose-tools landen als een [beslissing](/docs/ai/decisions) die jij goedkeurt.

**Bankieren** is installeerbaar met een read-only GoCardless Bank Account Data-koppeling (saldi en transacties; betalingen verschijnen alleen als voorstel). **Beleggen** en **Documenten** zijn klaargezet maar nog niet installeerbaar; zij en hun geplande packages (Twelve Data, Bitvavo, TradingView, Google Drive, OneDrive / SharePoint, Dropbox) staan faded op Marketplace.

## Stuur boekhoudschrijfacties en agent-toegang

1. Open Boekhouding vanuit **Koppelingen**. De schrijfbanner toont **Schrijven uit — alleen ophalen** of **Schrijven aan — goedgekeurde beslissingen worden uitgevoerd**.
2. Gebruik als owner of admin **Schrijven toestaan in deze workspace** om goedgekeurde beslissingen naar het pakket te laten schrijven. Schrijven blijft uit zolang de platformschakelaar ook uit staat, dus goedkeuringen ronden altijd veilig af.
3. Open op de tab **Setup** van de module het toegangspaneel achter het instellingen-icoon bij een toegewezen agent. Zet **Schrijftoegang** aan zodat die agent boekhoudschrijfacties mag voorstellen; agents zonder deze vlag krijgen alleen leestools.
4. Kies onder **Administratie-scope** de administraties die de agent mag benaderen. Geen selectie betekent toegang tot alle administraties.
5. Elke voorgestelde schrijfactie landt als beslissingskaart met de administratie en de inhoud. Goedkeuren voert de actie alleen uit als beide schrijfschakelaars aan staan.

## Installeer een werkstroom-sjabloon

Modules leveren één cataloguspakket met Signaaltypen, voorgebouwde draaiboeken en optioneel een Project. Voorbeelden zijn **Btw-aangifte voorbereiden** en **Maandafsluiting beoordelen** op Boekhouding en **Bankreconciliatie** op Bankieren.

1. Open de modulepagina vanuit **Koppelingen**. Als de module aan staat, toont het paneel **Werkstroom-sjablonen** wat de module meelevert, met het aantal stappen per sjabloon.
2. Een sjabloon dat nog niet kan draaien, laat zien waarom (moduleverbinding ontbreekt, vereiste agentrol niet toegewezen). Los eerst die vereiste op.
3. Kies **Installeren**. De werkstroom wordt naar je workspace gekopieerd — jij bent eigenaar en mag de kopie bewerken. **Open werkstroom** brengt je ernaartoe onder [Werkstromen](/docs/ai/workstreams).
4. Voor elke run van een geïnstalleerd sjabloon controleert Bokito de vereisten opnieuw; een kapotte vereiste pauzeert de run met een beslissing in plaats van stil te falen.

## Indexeer modulebronnen

1. Open op de module-home de tab **Bronnen**. Platformpacks verschijnen als de module in setup of geïnstalleerd is (Boekhouding: Belastingdienst, NBA HRA, RJNet, KvK jaarrekening, BW2 Titel 9). Indexeren start vanzelf.
2. Elk pack haalt curated startpagina's op en volgt daarna beperkt same-origin links (`robots.txt` wordt gerespecteerd, geen inlogmuren). Status gaat **Wacht** → **Indexeren** → **Klaar** (of **Fout** als de site geen leesbare publieke tekst heeft, zoals een paywall). Je kunt een platformpack **Opnieuw indexeren** of **Uitschakelen**; verwijderen kan niet.
3. Kies **URL toevoegen** voor kantoorpagina's. Die volgen dezelfde beperkte crawl met een lager paginalimiet. Agents zoeken in klaar-bronnen via modulebron-tools.

## Rond setup af met de toegewezen agent

1. Open op de module-home de tab **Setup**.
2. Wijs minstens één agent toe als dat nog niet gebeurd is, bekijk de checklist en kies **Doorgaan met toegewezen agent**.
3. De standaard toegewezen agent begeleidt optionele integraties, standaarden en bronnen, en kan beslissingen op de thread zetten wanneer goedkeuring nodig is.
4. Ga terug naar de modulepagina en kies **Setup afronden** wanneer de checklist klaar is.

## Zet klantchat-tools en intake-types aan

1. Open een geïnstalleerde module zoals **Boekhouding**.
2. Zet onder **Klantchat-tools** een actie alleen aan wanneer de websitewidget de eigen gegevens van die bezoeker mag opzoeken nadat ze een korte e-maillink bevestigen.
3. Kies onder **Intake-types** **Installeren** bij een sjabloon (bijvoorbeeld billing inquiry). Koppel het type aan een [werkstroom](/docs/ai/workstreams) zodat chat een [signaal](/docs/ai/cases) kan openen.

## Zet wat agents mogen aanroepen

1. Open na het koppelen [Govern](/docs/govern/govern) **Beleid**.
2. Zet Integraties (en Berichten, als die kan versturen) zodat agents je niet verrassen.
3. Test eenmaal vanuit een agentgesprek.

## Wat nu

Koppel één tool die je al gebruikt. Voeg een [MCP-server](/docs/integrations/mcp) toe via **Marketplace** wanneer de vermelde apps niet genoeg zijn. De server verschijnt daarna onder **Custom MCP-servers** op Koppelingen.
