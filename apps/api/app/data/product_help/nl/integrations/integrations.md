---
title: Koppelingen
intro: Geef agents tools buiten Bokito — modules, partnerlogins en AI-tools op één pagina.
description: Gebruik Koppelingen om modules te installeren, partnerlogins en AI-tools te koppelen en te sturen wat agents mogen aanroepen.
keywords: koppelingen, koppelingen, verbonden, github, slack, mcp, modules, boekhouding, moneybird, ai-tools, cursor
sort: 10
related: mcp,models,channels,govern,categories
---

# Koppelingen

Koppelingen zijn partnerlogins. Een **module** is één pakket met labels, werk en een afdeling, plus de tools voor toegestane partners. **Koppelingen** in de zijbalk heeft twee weergaven: **Ontdekken** (\/connections\) om te vinden en te koppelen, en **Geïnstalleerd** (\/connections/installed\) om elke registratie te beheren — ook meerdere administraties bij één host. Een module installeren voegt nooit een zijbalkitem toe; open de module vanuit Koppelingen. Alleen koppelen geeft agents geen tools; installeer de module en wijs een agent toe.

## Zie wat geïnstalleerd is

![Koppelingen](/api/docs/assets/integrations/connections.png)
*Koppelingen: Ontdekken met de moduleshowcase, of Geïnstalleerd met kaarten en een lijst.*

1. Open **Koppelingen** en kies **Geïnstalleerd**. Elke login en administratie verschijnt als eigen kaart (of rij in **Lijst**), zodat twee King-boekhoudingen twee aparte items blijven.
2. Gebruik de categorie-chips en zoeken om te filteren. Schakel **Kaarten** / **Lijst** wanneer je een dicht overzicht met status en type nodig hebt.
3. Kies een rij om het providerpaneel te openen (of de modulepagina wanneer die login is gekoppeld). Mailboxen openen **Kanalen**; Agenda-apps openen [Agenda](/docs/ai/agenda). Gebruik **Koppeling toevoegen** om terug te gaan naar Ontdekken.

## Zoek en koppel iets nieuws

![Koppelpaneel](/api/docs/assets/integrations/connect-panel.png)
*Een kaart kiezen opent een showcase-modal: beschrijving, endpoint, mogelijkheden en de koppelknop.*

1. Op **Ontdekken** toont de **Modules**-showcase domeinpakketten (Boekhouding, Bankieren, enzovoort) met partnerlogo's en **Bekijken**. Daaronder filteren categorie-chips **Communicatie**, **Agenda**, **Apps**, **Tools**, **Code**, **Modules** en **AI-tools**. Zoeken dekt namen en beschrijvingen, en matcht ook een module wanneer je een partternaam typt (bijvoorbeeld **Moneybird** toont **Boekhouding**). De chip staat in de URL (\/connections?kind=mcp\ voor Tools).
2. Cataloguskaarten zijn één platte lijst van partnerlogins en AI-tools. Modulepakketten (Moneybird API, KING, Bjorn Lunden, en hetzelfde patroon voor Bankieren / Documenten wanneer die live gaan) krijgen **geen** eigen catalogkaart; die koppel je vanaf de modulepagina. Hosted MCP-kaarten (bijvoorbeeld **Moneybird MCP**) blijven in het grid. Microsoft 365, Outlook Calendar en Microsoft Graph hebben elk een eigen kaart.
3. Kies een **module**-slide (**Bekijken**) of een **integratiekaart**. Er opent een showcase-modal: modules openen met de expert en **Installeren** / **Module openen**; koppelingen tonen beschrijving, endpoint, mogelijkheden en **Koppelen**. Rond OAuth of setup af; je keert hier terug met de modal open. Een login blijft op Koppelingen tot je hem aan een module hangt.
4. Agents linken rechtstreeks naar deze modal: een kaart in een gesprek opent \/connections?connect=slack_mcp\ met de Slack-modal al open. Een modulepakket-vermelding zoals Moneybird opent de pagina **Boekhouding**.
5. Communicatie-apps voegen wachtrijen toe (e-mail, WhatsApp). Code-apps hangen aan een [map](/docs/ai/folders). Agenda-apps syncen naar [Agenda](/docs/ai/agenda). Tool-apps landen onder **Tools** of **Custom MCP-servers**. Zie [MCP](/docs/integrations/mcp).

WhatsApp zelf configureer je onder **Kanalen**, niet alleen hier. De kaart wijst je daarheen.

## Koppel de tools van een contentbureau

Notion, Canva, Google Drive en Sheets, Mailblue, Metricool en Zapier koppel je vanuit hetzelfde raster.

1. Zoek de tool op **Koppelingen** en kies de kaart. **Notion** en **Canva** log je in bij de aanbieder. **Google Drive** dekt Drive en Sheets: agents zoeken en lezen bestanden en schrijven rijen naar een sheet.
2. **Mailblue** vraagt de **Account-URL** en de **API-sleutel**. **Metricool** vraagt de **API-token**, de **Gebruikers-id** en, als je wilt, een **Standaard merk-id**. **Zapier** vraagt je **Persoonlijke MCP-server-URL**, met de acties die je in Zapier aanzette.
3. Kies **Koppelen**. Bokito test de login meteen en toont een fout als een veld niet klopt.
4. Gebruik de koppeling alleen voor één klant of afdeling met de sectie hieronder, en noem hem op een werk bij **Gebruikt** zodat de agents ermee werken.

## Een koppeling opnieuw verbinden

Bokito test elke koppeling een keer per dag.

1. Antwoordt een koppeling niet meer of verloopt de login, dan verschijnt een gesprek **Connection {naam} needs attention** voor de afdeling die de koppeling heeft, of voor de werkruimte.
2. Open **Koppelingen** en kies de tegel van de koppeling. Kies opnieuw **Koppelen** en rond de login af of vul de nieuwe sleutel in.
3. De afdelingsleider noemt de koppeling ook in de ochtendbriefing tot hij weer werkt.

## Koppel een AI- of codingtool

1. Kies de chip **AI-tools**. **AI-tool**-kaarten (Cursor, Claude Code, Claude Desktop, Codex CLI, VS Code, Windsurf, ChatGPT) gebruiken deze workspace via MCP; **Codingtool**-kaarten (Cursor Cloud Agents, Claude Managed Agents, Devin) nemen een bug of feature over uit een gesprek en brengen de pull request terug.
2. Kies **Instellen** op een kaart. Dat opent het bijbehorende onderdeel op **Instellingen → Developers**, waar de OAuth- of token-snippets staan. Zie [AI-tools koppelen](/docs/developers/mcp-endpoint).

## Installeer een bedrijfsmodule

1. Open **Koppelingen** in de zijbalk onder **Organisatie**. Kies **Ontdekken** en de **Modules**-showcase, of de chip **Modules**, om een preset te vinden die nog niet geïnstalleerd is. Geïnstalleerde modules staan onder **Geïnstalleerd**.
2. Open **Boekhouding** (of een andere live module) en kies **Afdeling toevoegen**. Een module is een afdeling in een doos: een specialist-agent, labels en werk. Kies onder **Afdeling** een **Nieuwe afdeling** of een bestaande afdeling die al vergelijkbaar werk doet; Bokito stelt de beste match voor. Kies de **Eindverantwoordelijke**. Heeft de afdeling al een leider, vink dan **Laat de specialist leiden** aan om de specialist eerste te maken; anders sluit hij aan als lid. Bokito kopieert de labels, werk, bronnen en skill. De catalog-kaart toont **Geïnstalleerd** met een vinkje en **Beheren**. Latere bewerkingen op die afdeling blijven van jou.
3. De toast biedt **Praat met specialist**. De modulepagina noemt de afdeling en haar aanspreekpunt, met **Afdeling openen**. Agents in die afdeling, en in de afdelingen eronder, krijgen de tools van deze module; zet een agent in de afdeling om hem de tools te geven. Een modulegrant aan een andere afdeling opent de tools daar ook. **Deïnstalleren** archiveert de specialist. Een afdeling die de module zelf maakte wordt soft-verwijderd; een afdeling waar hij bij aansloot blijft met haar eigen werk. Partnerlogins blijven op Koppelingen.
4. Bekijk **Wat agents kunnen doen**: elke actie toont een korte beschrijving, het pad (`accounting_list_companies`, …), **Lezen** of **Goedkeuring nodig**, en **Websitechat** wanneer de tool in de widget mag (aanzetten onder Overzicht). Als partners gekoppeld zijn, toont **Tools van gekoppelde MCP-servers** de ontdekte MCP-namen.
5. Bovenaan de modulepagina, onder **Koppelingen**, kies je **Nieuwe registratie** om het modulepakket (Moneybird, KING of Bjorn Lunden) te koppelen en toe te voegen, of **Bestaande koppeling gebruiken** wanneer er al een login bestaat. Geplande pakketten (Exact Online, SnelStart) blijven grijs. De overige tabs zijn **Overzicht**, **Bronnen** en **Setup**.
6. Koppel een partnerlogin wanneer je live data wilt. Tot die tijd is de module geïnstalleerd maar nog incompleet voor koppelingen; na koppelen is die **Gekoppeld**. Labels en draaiboeken blijven via hun bestaande schermen bereikbaar; de module voegt geen zijbalkitem toe.

## Koppel een optionele boekhoudintegratie

![Module-home](/api/docs/assets/integrations/module-home.png)
*Modulepagina toont registraties bovenaan, daarna Overzicht, Bronnen en Setup.*

1. Open **Boekhouding** via de kaart op **Koppelingen**. Registraties staan bovenaan de modulepagina (niet op een aparte tab). De lijst toont alleen attached registraties, niet elke Moneybird-login in de workspace.
2. Kies **Nieuwe registratie** om vanuit de module te koppelen (die login wordt automatisch attached), of **Deze koppeling gebruiken** voor een login die al op Koppelingen staat.
3. Rond setup af met echte credentials (OAuth voor Moneybird, partner key plus administraties voor KING, client id/secret voor Bjorn Lunden, Trading API-key plus secret voor Alpaca). Alleen een willekeurige naam maakt geen werkende koppeling.
4. Elke rij toont status (**Geverifieerd**, **Credentials nodig**, **Niet geverifieerd** of **Fout**), optionele provider-identiteit, de mappen (of **Alle mappen**), en acties: **Verifiëren**, **Als standaard** (alleen als geverifieerd), **Hernoemen**, **Uit module halen** (de login blijft op Koppelingen), **Ontkoppelen** en **Beheren** voor mappen en toegang.
5. Elke administratie koppel je één keer. Dezelfde Moneybird-administratie of KING-omgeving opnieuw koppelen werkt de bestaande registratie bij en toont **Deze administratie was al gekoppeld**, in plaats van een tweede rij toe te voegen.
6. Alleen agents in de afdeling van de module, of een afdeling eronder, mogen de gedeelde boekhoud-toolset gebruiken. Propose-tools landen als een [beslissing](/docs/ai/decisions) die jij goedkeurt.

## Beheer koppelingen met één provider

Losse catalog-logins (inbox, agenda, hosted MCP, custom tools) openen een providerpaneel. Modulepakketten zoals Moneybird API beheer je op de pagina **Boekhouding**.

![Providerkoppelingen](/api/docs/assets/integrations/provider-connections.png)
*Het providerpaneel toont elke registratie met status, mappen en acties.*

1. Open **Koppelingen** en kies een losse providerkaart, bijvoorbeeld **Moneybird MCP** of **Slack**.
2. Het paneel toont elke registratie met status, identiteit, administratienummer, mappen en de modules die hem gebruiken. Een badge **Beperkt** betekent dat alleen sommige mensen of agents hem mogen gebruiken.
3. Gebruik **Verifiëren**, **Hernoemen** of **Ontkoppelen** op een rij. Ontkoppelen haalt hem weg als modulestandaard en verwijdert zijn folderkoppelingen.
4. Kies **Nog een registratie toevoegen** om een tweede account te koppelen. Dezelfde administratie twee keer werkt de bestaande rij bij.
5. Voor Moneybird API, KING of Bjorn Lunden open je **Boekhouding** en beheer je registraties bovenaan die pagina.

## Gebruik een koppeling alleen voor één klant of afdeling

Koppel een registratie aan mappen wanneer hij bij één klant of afdeling hoort.

1. Open de providerkaart op **Koppelingen** (of de modulepagina) en kies **Beheren** bij de registratie.
2. Selecteer onder **Mappen** een of meer mappen en kies **Mappen opslaan**.
3. Een gekoppelde registratie is exclusief: agents gebruiken hem alleen voor werk in die mappen (een gesprek in de map, of een run met die map). Daarbuiten is hij niet beschikbaar.
4. Zonder geselecteerde map toont de registratie **Alle mappen** en werkt hij overal. Binnen een map kiezen agents de registratie van die map vóór de modulestandaard.

Je kunt ook koppelen vanaf de pagina van de map; zie [Mappen](/docs/ai/folders). Het koppelingspaneel noemt die lijst **Mappen** en de knop **Mappen opslaan**.

## Houd een koppeling binnen één afdeling

Met de organisatieregels aan kan een registratie bij één afdeling horen, zodat alleen gesprekken van die afdeling hem gebruiken.

1. Kies **Beheren** bij de registratie.
2. Kies onder **Afdeling** de afdeling. **Hele organisatie** houdt hem open voor elke afdeling.
3. Kies **Mappen opslaan**. Gesprekken van die afdeling, of een afdeling eronder, kunnen de registratie gebruiken; elders krijgen agents een korte reden.
4. Combineer het met mappen: binnen een map wint de registratie van de dichtstbijzijnde map omhoog in de keten, vóór de modulestandaard.
5. Werk kan het verder versmallen: noemt werk koppelingen of moduletools, dan gebruiken de gesprekken daarvan alleen die. Zie [Werk](/docs/ai/flows).

Koppelt een agent via de chat iets nieuws, dan vraagt hij voor welke afdeling (standaard de hele organisatie) en welke mappen de koppeling is.

## Kies wie een koppeling mag gebruiken

Bepaal welke mensen, agents en afdelingen een registratie mogen gebruiken of beheren.

1. Kies **Beheren** bij de registratie en daarna de knop onder **Toegang** (standaard **Alle mensen en agents**).
2. Kies per team, persoon of agent **Gebruiken** (de tools ervan draaien) of **Beheren** (verifiëren, hernoemen, mappen koppelen, toegang wijzigen). **Geen toegang** verbergt hem voor hen.
3. Kies **Opslaan**. **Terug naar standaard** geeft alle mensen en agents weer **Gebruiken**. Eigenaren en beheerders beheren altijd elke koppeling.
4. Een agent zonder toegang kan de registratie niet bereiken; de poging staat in het auditlog. Agents kunnen een wijziging voorstellen met `set_connection_scope`, wat altijd om goedkeuring vraagt.

**Bankieren** is installeerbaar met een read-only GoCardless Bank Account Data-koppeling (saldi en transacties). Een IBAN-check, de toestemmingsperiode en een betaalchecklist werken al voordat een bank gekoppeld is. Een betalingsvoorstel verstuurt geen overboeking. **Documenten** is installeerbaar. Google Drive en Sheets zijn de live koppeling; de bewaartermijn (7 jaar voor een factuur, 10 jaar voor onroerend goed), de indeling en citaten werken al voordat Drive gekoppeld is. **Beleggen** is installeerbaar en voegt geen brokerlogin toe. Investo weigert een persoonlijk advies over een specifiek instrument en maakt alleen een order die de operator al koos. Koersen en posities wachten op een broker. **Accountant** is installeerbaar en voegt geen pakketlogin toe. Accounto maakt het jaarwerk klaar: grootteklasse, aansluitvragen, schattingen, de commerciële-naar-fiscale brug en deponeerdatums. Boekingen, facturen en bankmatches blijven bij Boekhouding en Bankieren. Accounto tekent geen samenstellingsverklaring en deponeert niet bij de Kamer van Koophandel of de Belastingdienst.

## Agenda-accounts koppelen

Elk Google- of Microsoft-account is één koppeling; voeg er zoveel toe als nodig en kies per account welke agenda's in [Agenda](/docs/ai/agenda) staan.

![Agenda-accounts](/api/docs/assets/integrations/calendar-accounts.png)
*Na de eerste koppeling toont het filter Agenda de gekoppelde accounts met status en agenda's.*

1. Open **Koppelingen** en kies het filter **Agenda**. Kies op de cataloguskaart **Google Calendar** of **Outlook Calendar** **Koppelen** en rond de aanmelding af. Is er al een account gekoppeld, dan verschijnt daarboven **Agenda-accounts** met **Google-account toevoegen** en **Microsoft-account toevoegen**.
2. Elke accountrij toont het adres, de synchronisatiestatus, het aantal afspraken en een gekleurde stip per aangezette agenda. **Met jou gedeeld** markeert een account dat iemand anders koppelde.
3. Kies **Beheren**. Zet onder **Agenda's** de agenda's aan die moeten synchroniseren (eerst staat alleen de hoofdagenda aan) en kies de **Standaardagenda voor nieuwe afspraken**. Agenda's met alleen leesrechten synchroniseren wel, maar krijgen nooit nieuwe afspraken. Aangezette agenda's worden automatisch bijgewerkt in Agenda.
4. Kies onder **Toegang** wie het account mag zien en gebruiken. Een nieuw account beheer jij, en agents mogen het lezen. Geef een collega **Gebruiken** om het in diens Agenda te tonen, of **Beheren** om agenda's en toegang te laten wijzigen. Eigenaren en beheerders beheren altijd.
5. Staat er **Log opnieuw in om deze agenda bij te houden**, kies dan **Opnieuw koppelen**. **Ontkoppelen** haalt het account en zijn afspraken uit Agenda; in Google of Outlook verandert niets.

## Stuur boekhoudschrijfacties en agent-toegang

1. Open Boekhouding vanuit **Koppelingen**. De schrijfbanner toont **Schrijven uit — alleen ophalen** of **Schrijven aan — goedgekeurde beslissingen worden uitgevoerd**.
2. Gebruik als owner of admin **Schrijven toestaan in deze workspace** om goedgekeurde beslissingen naar het pakket te laten schrijven. Schrijven blijft uit zolang de platformschakelaar ook uit staat, dus goedkeuringen ronden altijd veilig af.
3. Agents in de afdeling van de module mogen boekhoudschrijfacties voorstellen. Wil je een administratie bij één klant of afdeling houden, koppel de registratie dan aan die map of afdeling (zie hierboven).
4. Elke voorgestelde schrijfactie landt als beslissingskaart met de administratie en de inhoud. Goedkeuren voert de actie alleen uit als beide schrijfschakelaars aan staan.

## Installeer een werksjabloon

Modules leveren één cataloguspakket met labels en voorgebouwd werk. Voorbeelden zijn **VAT filing preparation**, **Monthly close review** en **Invoice check** op Boekhouding, **Year-end file** op Accountant, **Bank reconciliation** en **Payment check** op Bankieren, **File a document** op Documenten, en **Order ticket** op Beleggen.

1. Open de modulepagina vanuit **Koppelingen**. Als de module aan staat, toont het paneel **Werksjablonen** wat de module meelevert, met het aantal stappen per sjabloon.
2. Een sjabloon dat nog niet kan draaien, laat zien waarom (moduleverbinding ontbreekt, vereiste agentrol niet toegewezen). Los eerst die vereiste op.
3. Kies **Installeren**. Het werk wordt naar je workspace gekopieerd — jij bent eigenaar en mag de kopie bewerken. **Werk openen** brengt je ernaartoe onder [Werk](/docs/ai/flows).
4. Voor elke run van een geïnstalleerd sjabloon controleert Bokito de vereisten opnieuw; een kapotte vereiste pauzeert de run met een beslissing in plaats van stil te falen.

## Indexeer modulebronnen

1. Open op de module-home de tab **Bronnen**. Platformpacks verschijnen als de module geïnstalleerd is. Boekhouding indexeert de Belastingdienstpagina's voor ondernemers, btw, loonheffingen, btw-tarieven en factuureisen, de pagina over de betalingstermijn op Ondernemersplein, en het Referentie GrootboekSchema. Bankieren indexeert de DNB- en Betaalvereniging-pagina's over instant payments. Documenten indexeert de pagina's over het bewaren van facturen. Beleggen indexeert de AFM-pagina's over advies en execution only. Accountant indexeert de NBA-samenstelstandaard, de Richtlijnen voor de jaarverslaggeving, de KvK-pagina's over bedrijfsklasse en SBR, BW2 Titel 9, en de Belastingdienstpagina's over vennootschapsbelasting en inkomstenbelasting. Indexeren start vanzelf.
2. Elk pack haalt curated startpagina's op en volgt daarna beperkt same-origin links (`robots.txt` wordt gerespecteerd, geen inlogmuren). Status gaat **Wacht** → **Indexeren** → **Klaar** (of **Fout** als de site geen leesbare publieke tekst heeft, zoals een paywall). Je kunt een platformpack **Opnieuw indexeren** of **Uitschakelen**; verwijderen kan niet.
3. Kies **URL toevoegen** voor kantoorpagina's. Die volgen dezelfde beperkte crawl met een lager paginalimiet. Agents zoeken in klaar-bronnen via modulebron-tools.

## Rond setup af met het aanspreekpunt

1. Open op de module-home de tab **Setup**.
2. Heeft de afdeling nog geen aanspreekpunt, kies dan **Specialist aannemen**. Bekijk daarna de checklist en kies **Verder met het aanspreekpunt**.
3. Het aanspreekpunt begeleidt optionele koppelingen, standaarden en bronnen, en kan beslissingen op de thread zetten wanneer goedkeuring nodig is.
4. Ga terug naar de modulepagina en kies **Setup afronden** wanneer de checklist klaar is.

## Zet klantchat-tools en modulelabels aan

1. Open een geïnstalleerde module zoals **Boekhouding**.
2. Zet onder **Klantchat-tools** een actie alleen aan wanneer de websitewidget de eigen gegevens van die bezoeker mag opzoeken nadat ze een korte e-maillink bevestigen.
3. Kies onder **Labels** **Installeren** bij een sjabloon (bijvoorbeeld billing inquiry). Koppel een draaiboek aan het label zodat chat er een ticket op kan vastleggen; zie [Categorieën en tickets](/docs/ai/categories).

## Zet wat agents mogen aanroepen

1. Open na het koppelen [Govern](/docs/govern/govern) **Beleid**.
2. Zet Koppelingen (en Berichten, als die kan versturen) zodat agents je niet verrassen.
3. Test eenmaal vanuit een agentgesprek.

## Wat nu

Koppel één tool die je al gebruikt. Voeg een [MCP-server](/docs/integrations/mcp) toe via de chip **Tools** wanneer de vermelde apps niet genoeg zijn. De server verschijnt daarna onder **Custom MCP-servers** op Koppelingen.
