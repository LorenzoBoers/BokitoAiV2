---
title: Integraties koppelen
intro: Geef agents tools buiten Bokito — modules, partnerlogins en AI-tools op één pagina.
description: Gebruik Koppelingen om modules te installeren, partnerlogins en AI-tools te koppelen en te sturen wat agents mogen aanroepen.
keywords: integraties, koppelingen, verbonden, github, slack, mcp, modules, boekhouding, moneybird, ai-tools, cursor
sort: 10
related: mcp,models,channels,govern,categories
---

# Integraties koppelen

Integraties zijn partnerlogins. Een **module** is één pakket met hashtags, draaiboeken en optioneel een Project, plus de tools voor toegestane partners. **Koppelingen** in de zijbalk op `/connections` is één pagina voor dit alles: wat verbonden is bovenaan, daaronder één grid met elke module, integratie en AI-tool. Een module installeren voegt nooit een zijbalkitem toe; open de module vanuit Koppelingen. Alleen koppelen geeft agents geen tools; installeer de module en wijs een agent toe.

## Zie wat gekoppeld is

![Koppelingen](/api/docs/assets/integrations/connections.png)
*Koppelingen: de strook Verbonden bovenaan, daaronder één grid met categorie-chips en zoeken.*

1. Open **Koppelingen**. De strook **Verbonden** bovenaan toont elke geïnstalleerde module en elke gekoppelde integratie als compacte tegel met logo en het aantal koppelingen. De strook verschijnt alleen als er iets verbonden is, en alleen bij **Alles** zonder zoekterm.
2. Kies een moduletegel om de modulepagina te openen; kies een integratietegel om het paneel met elke registratie bij die provider te openen (zie **Beheer koppelingen met één provider** hieronder). Mailboxen openen **Kanalen** vanuit het paneel; Agenda-apps openen [Agenda](/docs/ai/agenda).
3. **Custom MCP-servers** blijft een aparte lijst onder het grid voor logins die niet in de catalogus staan. Kies **Ontkoppelen** op een rij wanneer die login moet stoppen (bevestig **Deze koppeling verwijderen?**). Agenda-accounts staan onder de chip **Agenda** (zie **Agenda-accounts koppelen** hieronder).

## Zoek en koppel iets nieuws

![Koppelpaneel](/api/docs/assets/integrations/connect-panel.png)
*Een kaart kiezen opent een showcase-modal: beschrijving, endpoint, mogelijkheden en de koppelknop.*

1. Gebruik onder **Alles** de categorie-chips: **Communicatie**, **Agenda**, **Apps**, **Tools**, **Code**, **Modules** en **AI-tools**. Elke chip toont zijn aantal. Zoeken werkt op namen en beschrijvingen in elke categorie, en matcht ook een module wanneer je een partternaam typt (bijvoorbeeld **Moneybird** toont **Boekhouding**). De chip staat in de URL (`/connections?kind=mcp` voor Tools, `?kind=modules`, `?kind=ai_tools`), dus een link opent altijd de categorie die hij noemt.
2. Kaarten vormen één platte lijst — nooit genest in een module, nooit gegroepeerd onder een vendor. Modulepakketten (Moneybird API, KING, Bjorn Lunden, en hetzelfde patroon voor Bankieren / Documenten wanneer die live gaan) krijgen **geen** eigen marketplacekaart; die koppel je alleen vanuit de modulepagina. Hosted MCP-kaarten (bijvoorbeeld **Moneybird MCP**) blijven in het grid naast de module. Microsoft 365, Outlook Calendar en Microsoft Graph hebben elk een eigen kaart. Een modulekaart draagt het label **Module**. De specialist staat rechts, alleen zo breed als naam en functie, met een gloed in die kleur. Beschrijving, aantal tools en partnerlogo's vullen de rest. Coming-soon modules staan faded tot ze live gaan.
3. Kies een **module**- of **integratiekaart**. Er opent een showcase-modal: modules openen met de expert (naam, functie, levende avatar) en drie voordelen met een vinkje, partners, Labels en flows (hashtags), en de namen van de agent-tools (de volledige lijst via Toon details, inclusief websitechat), met **Installeren** / **Module openen**; integraties tonen beschrijving, endpoint, mogelijkheden en **Koppelen**. Rond OAuth of setup af; je keert hier terug met de modal open. Een login blijft op Koppelingen tot je hem aan een module hangt.
4. Agents linken rechtstreeks naar deze modal: een kaart in een gesprek opent `/connections?connect=slack_mcp` met de Slack-modal al open. Een modulepakket-vermelding zoals Moneybird opent de pagina **Boekhouding**.
5. Communicatie-apps voegen wachtrijen toe (e-mail, WhatsApp). Code-apps hangen aan een [project](/docs/ai/folders). Agenda-apps syncen naar [Agenda](/docs/ai/agenda). Tool-apps landen onder **Tools** of **Custom MCP-servers**. Zie [MCP](/docs/integrations/mcp).

WhatsApp zelf configureer je onder **Kanalen**, niet alleen hier. De kaart wijst je daarheen.

## Koppel een AI- of codingtool

1. Kies de chip **AI-tools**. **AI-tool**-kaarten (Cursor, Claude Code, Claude Desktop, Codex CLI, VS Code, Windsurf, ChatGPT) gebruiken deze workspace via MCP; **Codingtool**-kaarten (Cursor Cloud Agents, Claude Managed Agents, Devin) nemen een bug of feature over uit een gesprek en brengen de pull request terug.
2. Kies **Instellen** op een kaart. Dat opent het bijbehorende onderdeel op **Instellingen → Developers**, waar de OAuth- of token-snippets staan. Zie [AI-tools koppelen](/docs/developers/mcp-endpoint).

## Installeer een bedrijfsmodule

1. Open **Koppelingen** in de zijbalk onder **Organisatie**. Geïnstalleerde modules staan in de strook **Verbonden**; gebruik de chip **Modules** om een preset te vinden die nog niet geïnstalleerd is.
2. Open **Boekhouding** (of een andere live module) en kies **Installeren**. Dat maakt eenmalig het module-department (zichtbaar op Grid), neemt de specialist aan en kopieert hashtags, flows, bronnen en skill. De module is meteen **geïnstalleerd**; de marketplace-kaart toont **Geïnstalleerd** met een vinkje en **Beheren**. Latere bewerkingen op dat department blijven van jou — Bokito overschrijft ze niet bij heropenen.
3. De toast biedt **Praat met specialist**. Op de modulepagina kun je hun chat openen of een andere bedrijfsagent toewijzen. Markeer er één als **Standaard**. Alleen agents op de roster krijgen de tools van deze module. **Deïnstalleren** soft-verwijdert dat department (en archiveert de specialist); partnerlogins blijven op Koppelingen.
4. Bekijk **Wat agents kunnen doen**: elke actie toont een korte beschrijving, het pad (`accounting_list_companies`, …), **Lezen** of **Goedkeuring nodig**, en **Websitechat** wanneer de tool in de widget mag (aanzetten onder Overzicht). Als partners gekoppeld zijn, toont **Tools van gekoppelde MCP-servers** de ontdekte MCP-namen.
5. Bovenaan de modulepagina, onder **Koppelingen**, kies je **Nieuwe registratie** om het modulepakket (Moneybird, KING of Bjorn Lunden) te koppelen en toe te voegen, of **Bestaande koppeling gebruiken** wanneer er al een login bestaat. Geplande pakketten (Exact Online, SnelStart) blijven grijs. De overige tabs zijn **Overzicht**, **Bronnen** en **Setup**.
6. Koppel een partnerlogin wanneer je live data wilt. Tot die tijd is de module geïnstalleerd maar nog incompleet voor koppelingen; na koppelen is die **Gekoppeld**. Hashtags en draaiboeken blijven via hun bestaande schermen bereikbaar; de module voegt geen zijbalkitem toe.

## Koppel een optionele boekhoudintegratie

![Module-home](/api/docs/assets/integrations/module-home.png)
*Modulepagina toont registraties bovenaan, daarna Overzicht, Bronnen en Setup.*

1. Open **Boekhouding** via de kaart op **Koppelingen**. Registraties staan bovenaan de modulepagina (niet op een aparte tab). De lijst toont alleen attached registraties, niet elke Moneybird-login in de workspace.
2. Kies **Nieuwe registratie** om vanuit de module te koppelen (die login wordt automatisch attached), of **Deze koppeling gebruiken** voor een login die al op Koppelingen staat.
3. Rond setup af met echte credentials (OAuth voor Moneybird, partner key plus administraties voor KING, client id/secret voor Bjorn Lunden, Trading API-key plus secret voor Alpaca). Alleen een willekeurige naam maakt geen werkende koppeling.
4. Elke rij toont status (**Geverifieerd**, **Credentials nodig**, **Niet geverifieerd** of **Fout**), optionele provider-identiteit, de projecten (of **Alle projecten**), en acties: **Verifiëren**, **Als standaard** (alleen als geverifieerd), **Hernoemen**, **Uit module halen** (de login blijft op Koppelingen), **Ontkoppelen** en **Beheren** voor projecten en toegang.
5. Elke administratie koppel je één keer. Dezelfde Moneybird-administratie of KING-omgeving opnieuw koppelen werkt de bestaande registratie bij en toont **Deze administratie was al gekoppeld**, in plaats van een tweede rij toe te voegen.
6. Alleen agents die aan de module zijn toegewezen mogen de gedeelde boekhoud-toolset gebruiken. Propose-tools landen als een [beslissing](/docs/ai/decisions) die jij goedkeurt.

## Beheer koppelingen met één provider

Losse marketplace-logins (inbox, agenda, hosted MCP, custom tools) openen een providerpaneel. Modulepakketten zoals Moneybird API beheer je op de pagina **Boekhouding**.

![Providerkoppelingen](/api/docs/assets/integrations/provider-connections.png)
*Het providerpaneel toont elke registratie met status, projecten en acties.*

1. Open **Koppelingen** en kies een losse providerkaart, bijvoorbeeld **Moneybird MCP** of **Slack**.
2. Het paneel toont elke registratie met status, identiteit, administratienummer, projecten en de modules die hem gebruiken. Een badge **Beperkt** betekent dat alleen sommige mensen of agents hem mogen gebruiken.
3. Gebruik **Verifiëren**, **Hernoemen** of **Ontkoppelen** op een rij. Ontkoppelen haalt hem weg als modulestandaard en verwijdert zijn projectkoppelingen.
4. Kies **Nog een registratie toevoegen** om een tweede account te koppelen. Dezelfde administratie twee keer werkt de bestaande rij bij.
5. Voor Moneybird API, KING of Bjorn Lunden open je **Boekhouding** en beheer je registraties bovenaan die pagina.

## Gebruik een koppeling alleen voor één klant of afdeling

Koppel een registratie aan projecten wanneer hij bij één klant of afdeling hoort.

1. Open de providerkaart op **Koppelingen** (of de modulepagina) en kies **Beheren** bij de registratie.
2. Selecteer onder **Projecten** een of meer projecten en kies **Projecten opslaan**.
3. Een gekoppelde registratie is exclusief: agents gebruiken hem alleen voor werk in die projecten (een gesprek dat op het project staat, of een run met dat project). Daarbuiten is hij niet beschikbaar.
4. Zonder geselecteerd project toont de registratie **Alle projecten** en werkt hij overal. Binnen een project kiezen agents de registratie van dat project vóór de modulestandaard.

Je kunt ook koppelen vanaf de projectpagina; zie [Projecten](/docs/ai/folders).

## Kies wie een koppeling mag gebruiken

Bepaal welke mensen, agents en teams een registratie mogen gebruiken of beheren.

1. Kies **Beheren** bij de registratie en daarna de knop onder **Toegang** (standaard **Alle mensen en agents**).
2. Kies per team, persoon of agent **Gebruiken** (de tools ervan draaien) of **Beheren** (verifiëren, hernoemen, projecten koppelen, toegang wijzigen). **Geen toegang** verbergt hem voor hen.
3. Kies **Opslaan**. **Terug naar standaard** geeft alle mensen en agents weer **Gebruiken**. Eigenaren en beheerders beheren altijd elke koppeling.
4. Een agent zonder toegang kan de registratie niet bereiken; de poging staat in het auditlog. Agents kunnen een wijziging voorstellen met `set_connection_scope`, wat altijd om goedkeuring vraagt.

**Bankieren** is installeerbaar met een read-only GoCardless Bank Account Data-koppeling (saldi en transacties; betalingen verschijnen alleen als voorstel). **Beleggen** en **Documenten** zijn klaargezet maar nog niet installeerbaar; zij en hun geplande packages (Twelve Data, Bitvavo, TradingView, Google Drive, OneDrive / SharePoint, Dropbox) staan faded op Koppelingen. **Accountant** is hetzelfde soort idee: faded, nog niet installeerbaar, en het hergebruikt de pakketten van Boekhouding (Moneybird, KING, Bjorn Lunden, en de geplande Exact-, SnelStart-, Twinfield- en Yuki-logins) in plaats van een eigen login.

## Agenda-accounts koppelen

Elk Google- of Microsoft-account is één koppeling; voeg er zoveel toe als nodig en kies per account welke agenda's in [Agenda](/docs/ai/agenda) staan.

![Agenda-accounts](/api/docs/assets/integrations/calendar-accounts.png)
*Het filter Agenda op Koppelingen toont elk agenda-account met status en agenda's.*

1. Open **Koppelingen** en kies het filter **Agenda**. Kies onder **Agenda-accounts** **Google Calendar koppelen** of **Outlook Calendar koppelen** en rond de aanmelding af. Is er al een account gekoppeld, dan heten de knoppen **Google-account toevoegen** en **Microsoft-account toevoegen**.
2. Elke accountrij toont het adres, de synchronisatiestatus, het aantal afspraken en een gekleurde stip per aangezette agenda. **Met jou gedeeld** markeert een account dat iemand anders koppelde.
3. Kies **Beheren**. Zet onder **Agenda's** de agenda's aan die moeten synchroniseren (eerst staat alleen de hoofdagenda aan) en kies de **Standaardagenda voor nieuwe afspraken**. Agenda's met alleen leesrechten synchroniseren wel, maar krijgen nooit nieuwe afspraken. Aangezette agenda's worden automatisch bijgewerkt in Agenda.
4. Kies onder **Toegang** wie het account mag zien en gebruiken. Een nieuw account beheer jij, en agents mogen het lezen. Geef een collega **Gebruiken** om het in diens Agenda te tonen, of **Beheren** om agenda's en toegang te laten wijzigen. Eigenaren en beheerders beheren altijd.
5. Staat er **Log opnieuw in om deze agenda bij te houden**, kies dan **Opnieuw koppelen**. **Ontkoppelen** haalt het account en zijn afspraken uit Agenda; in Google of Outlook verandert niets.

## Stuur boekhoudschrijfacties en agent-toegang

1. Open Boekhouding vanuit **Koppelingen**. De schrijfbanner toont **Schrijven uit — alleen ophalen** of **Schrijven aan — goedgekeurde beslissingen worden uitgevoerd**.
2. Gebruik als owner of admin **Schrijven toestaan in deze workspace** om goedgekeurde beslissingen naar het pakket te laten schrijven. Schrijven blijft uit zolang de platformschakelaar ook uit staat, dus goedkeuringen ronden altijd veilig af.
3. Open op de tab **Setup** van de module het toegangspaneel achter het instellingen-icoon bij een toegewezen agent. Zet **Schrijftoegang** aan zodat die agent boekhoudschrijfacties mag voorstellen; agents zonder deze vlag krijgen alleen leestools.
4. Kies onder **Administratie-scope** de administraties die de agent mag benaderen. Geen selectie betekent toegang tot alle administraties.
5. Elke voorgestelde schrijfactie landt als beslissingskaart met de administratie en de inhoud. Goedkeuren voert de actie alleen uit als beide schrijfschakelaars aan staan.

## Installeer een werkstroom-sjabloon

Modules leveren één cataloguspakket met hashtags, voorgebouwde draaiboeken en optioneel een Project. Voorbeelden zijn **Btw-aangifte voorbereiden** en **Maandafsluiting beoordelen** op Boekhouding en **Bankreconciliatie** op Bankieren.

1. Open de modulepagina vanuit **Koppelingen**. Als de module aan staat, toont het paneel **Werkstroom-sjablonen** wat de module meelevert, met het aantal stappen per sjabloon.
2. Een sjabloon dat nog niet kan draaien, laat zien waarom (moduleverbinding ontbreekt, vereiste agentrol niet toegewezen). Los eerst die vereiste op.
3. Kies **Installeren**. De werkstroom wordt naar je workspace gekopieerd — jij bent eigenaar en mag de kopie bewerken. **Open werkstroom** brengt je ernaartoe onder [Werkstromen](/docs/ai/workstreams).
4. Voor elke run van een geïnstalleerd sjabloon controleert Bokito de vereisten opnieuw; een kapotte vereiste pauzeert de run met een beslissing in plaats van stil te falen.

## Indexeer modulebronnen

1. Open op de module-home de tab **Bronnen**. Platformpacks verschijnen als de module geïnstalleerd is (Boekhouding: Belastingdienst, NBA HRA, RJNet, KvK jaarrekening, BW2 Titel 9). Indexeren start vanzelf.
2. Elk pack haalt curated startpagina's op en volgt daarna beperkt same-origin links (`robots.txt` wordt gerespecteerd, geen inlogmuren). Status gaat **Wacht** → **Indexeren** → **Klaar** (of **Fout** als de site geen leesbare publieke tekst heeft, zoals een paywall). Je kunt een platformpack **Opnieuw indexeren** of **Uitschakelen**; verwijderen kan niet.
3. Kies **URL toevoegen** voor kantoorpagina's. Die volgen dezelfde beperkte crawl met een lager paginalimiet. Agents zoeken in klaar-bronnen via modulebron-tools.

## Rond setup af met de toegewezen agent

1. Open op de module-home de tab **Setup**.
2. Wijs minstens één agent toe als dat nog niet gebeurd is, bekijk de checklist en kies **Doorgaan met toegewezen agent**.
3. De standaard toegewezen agent begeleidt optionele integraties, standaarden en bronnen, en kan beslissingen op de thread zetten wanneer goedkeuring nodig is.
4. Ga terug naar de modulepagina en kies **Setup afronden** wanneer de checklist klaar is.

## Zet klantchat-tools en modulehashtags aan

1. Open een geïnstalleerde module zoals **Boekhouding**.
2. Zet onder **Klantchat-tools** een actie alleen aan wanneer de websitewidget de eigen gegevens van die bezoeker mag opzoeken nadat ze een korte e-maillink bevestigen.
3. Kies onder **Hashtags** **Installeren** bij een sjabloon (bijvoorbeeld billing inquiry). Koppel een draaiboek aan de hashtag zodat chat er een ticket op kan vastleggen; zie [Categorieën en tickets](/docs/ai/categories).

## Zet wat agents mogen aanroepen

1. Open na het koppelen [Govern](/docs/govern/govern) **Beleid**.
2. Zet Integraties (en Berichten, als die kan versturen) zodat agents je niet verrassen.
3. Test eenmaal vanuit een agentgesprek.

## Wat nu

Koppel één tool die je al gebruikt. Voeg een [MCP-server](/docs/integrations/mcp) toe via de chip **Tools** wanneer de vermelde apps niet genoeg zijn. De server verschijnt daarna onder **Custom MCP-servers** op Koppelingen.
