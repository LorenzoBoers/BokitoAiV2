---
title: Zo werkt Workforce
intro: Mensen, agents en afdelingen op één pagina, met wie er beschikbaar is.
description: Nodig mensen uit, zie mensen en agents in één directory, bouw de afdelingsboom, kies per afdeling het aanspreekpunt en de bezetting, meld je afwezig en lees de Grid van binnenkomst tot resultaat.
keywords: workforce, team, leden, uitnodigen, rollen, afdelingen, organisatie, aanspreekpunt, verantwoordelijk, bezetting, focus, beschikbaarheid, afwezig, om de beurt, minst open, oppakken, grid, lens, labels, knelpunten
sort: 60
related: setup-guide,communication,agents,channels
---

# Zo werkt Workforce

Workforce toont iedereen die gesprekken afhandelt: de mensen in de workspace, de bedrijfsagents en de afdelingen waarin je ze groepeert. Open **Workforce** in de rail onder **Team** om iemand uit te nodigen, de directory te bekijken of een afdeling te maken. Een tweede menu sluit aan op de linker rail: **Mensen en agents**, **Afdelingen**, **Grid** (`/workforce/grid`), **Workflow** (`/workforce/workflow`) en **Organogram** (`/workforce/organogram`). De Grid laat in 3D zien hoe het bedrijf is ingericht. Workflow laat zien hoe werk door het bedrijf loopt: van het kanaal waar het binnenkomt, langs de persoon of agent die het oppakt en het werk waarin het loopt, naar het resultaat waar het landt. Het organogram toont dezelfde afdelingen als een boom, met de root bovenaan en elke subafdeling onder haar ouder.

## Nodig iemand uit

![Uitnodigen op Workforce](/api/docs/assets/team/invite.png)
*Eigenaren en beheerders nodigen mensen uit bovenaan Workforce.*

1. Open **Workforce**. Vul onder **Personen uitnodigen** een volledig e-mailadres in en kies **Rol**: **Beheerder** of **Lid**. Bij **Lid** kies je ook **Scope**: **Workspace** (de hele werkruimte, de standaard) of **Afdelingen**. Kies **Wat mag welke rol** tussen de rol en **Uitnodigen** als je de rechtenmatrix nodig hebt.
2. Kies **Uitnodigen**. Kan deze server geen mail versturen, gebruik dan **Uitnodigingslink kopiëren** en deel die zelf.
3. Openstaande uitnodigingen staan in de directory onder **In afwachting**. Gebruik **Uitnodiging opnieuw versturen** of **Uitnodiging intrekken**. Op een actief iemand wijzig je de rol of kies je **Deactiveren**. Alleen de **Eigenaar** kan een eigenaar promoveren, degraderen of deactiveren.

Leden beantwoorden gesprekken. Eigenaren en beheerders koppelen ook kanalen, wijzigen autonomie en nemen Govern-voorstellen aan. Zie [Govern](/docs/govern/govern).

## Neem nieuwe agents aan

1. Onderaan **Workforce** (of **Agents**) staat de banner **Afdeling toevoegen**.
2. Kies **Aanbod**. Die opent Koppelingen gefilterd op modules (`/connections?kind=modules`), waar je specialisten naast het team installeert.

## Meld je afwezig

1. Open je accountmenu (onderaan de rail) en kies **Online**, **Afwezig** of **Niet beschikbaar**. Afwezig maakt je stip grijs: in de lijst, in het gesprek, bij toewijzen en op Workforce.
2. Zolang je afwezig bent, bellen agents je niet. De bel mag nog wel. Bij **Niet beschikbaar** slaan ze ook de bel en een push over en schrijven ze alleen in het gesprek. Afdelingen geven je geen nieuwe gesprekken, en de websitechat telt je niet mee als beschikbaar voor een live overdracht.
3. Zet aanwezigheid weer op beschikbaar als je terug bent. Iemand telt als beschikbaar zolang Bokito open staat op een van zijn apparaten.

Agents tonen een paarse hoekmarkering: stil als ze op standby staan, pulsend als ze echt aan een gesprek of run werk.

## Lees de directory

1. Op **Workforce** toont de directory mensen, openstaande uitnodigingen en bedrijfsagents samen. Onder de naam van een agent staat de functie in de kleur van die agent. **Type** is gewone tekst: **Persoon** voor mensen en uitnodigingen, **AI agent** voor bedrijfsagents (`ai_agent`). Filter met **Alles**, **Mensen**, **Agents**, **In afwachting** of **Gedeactiveerd**, of zoek op naam. **Alles**, **Mensen** en **Agents** verbergen gedeactiveerde rijen. De kolom **Laatst actief** toont wanneer iemand voor het laatst online was en wanneer een agent voor het laatst draaide. Via Gerelateerd open je **Agents** (zelfde filter **Gedeactiveerd** daar).
2. Elke rij heeft de kolommen **Rol / plafond**, **Scope** en **Uren**. **Scope** toont **Workspace**, of de afdelingen waarin die persoon of agent zit. Een uitnodiging toont de scope die je bij het uitnodigen koos. In **Rol / plafond** wijzigt een eigenaar of beheerder de rol van een persoon, en het plafond van een agent met hetzelfde soort menu: **Handmatig**, **Geassisteerd** of **Autonoom**. Alleen een eigenaar of beheerder kan een plafond naar **Autonoom** zetten. Elke persoon toont open werk onder de naam, en aanwezigheid als stip op het gezicht (**Beschikbaar**, **Afwezig**, **Offline**). Elke agent gebruikt dezelfde markering als op Agents en in Communicatie. Open een agent voor 30-dagencijfers en regels (zie [Agents](/docs/ai/agents)). **Open in Grid** in de paginakop opent de Grid (zelfde knop op Agents, Werk en Mappen).
3. Mensen en agents gebruiken hun eigen markering. Op de tab **Afdelingen** toont elke rij links het afdelingsicoon en rechts een stapel gezichten van de leden. De hoekpunten volgen één hiërarchie: groen als een persoon beschikbaar is, paars pulsend als een agent in het team bezig is, oranje als iemand afwezig is, stil paars als alleen agents beschikbaar zijn, grijs als iedereen offline is.

## Deactiveer een persoon of agent

1. Open op **Workforce** de rij van een persoon of bedrijfsagent. Kies **Deactiveren**. Die verdwijnt uit het werkrooster: kiezers, afdelingen, toewijzing en chatdoelen slaan hen over. Geschiedenis in gesprekken en agentruns blijft.
2. Open het filter **Gedeactiveerd** om iedereen te zien die buiten het rooster staat. Op de agentpagina blijft de status **Gedeactiveerd**.
3. Kies **Opnieuw activeren** op de rij, of **Opnieuw activeren** op de agentpagina, om hen terug te zetten. Dezelfde e-mail opnieuw uitnodigen brengt een gedeactiveerd persoon ook terug als die de uitnodiging accepteert.

## Maak een afdeling

Afdelingen vormen een boom. De **Organisatie** is de top; afdelingen hangen eronder, maximaal twee niveaus diep.

1. Kies op **Workforce** → **Afdelingen** voor **Nieuwe afdeling**.
2. Geef een naam en eventueel een omschrijving. Kies onder **Valt onder** voor **De organisatie** of een afdeling om haar onder te hangen.
3. Kies onder **Gesprekken oppakken** wat er gebeurt met nieuwe gesprekken van de afdeling als er geen agent op zit:
   - **Mensen pakken op**: het gesprek blijft bij de afdeling; wie als eerste reageert, neemt het.
   - **Om de beurt**: elk nieuw gesprek gaat direct naar het volgende beschikbare lid.
   - **Minst open**: elk nieuw gesprek gaat naar het beschikbare lid met de minste open gesprekken.
4. Kies **Opslaan**. De afdelingspagina opent, zodat je meteen de bezetting toevoegt (zie hieronder). Elke afdeling verschijnt onder **Afdelingen** in de Communicatie-zijbalk.
5. Terug op **Workforce** → **Afdelingen** toont elke rij het afdelingsicoon, het aanspreekpunt en een stapel gezichten van de leden. De bovenste rij, **Organisatie**, opent de organisatiepagina. Agents die nog op geen afdeling zitten staan onder **Nog niet ingedeeld**; die pakken alleen werk op dat direct aan hen wordt doorgegeven. Eigenaren en beheerders kiezen **Plaatsen** naast zo'n agent en kiezen een afdeling; de agent komt als lid in die bezetting.

Een afdeling onder een bestaande afdeling maak je vanaf die afdeling: kies **Nieuwe subafdeling** naast **Afdelingen eronder**. Het formulier opent met **Valt onder** al ingevuld. Een afdeling op twee niveaus diep heeft die knop niet.

Zit er een agent op de afdeling, dan begint nieuw werk bij het aanspreekpunt. Om de beurt en minst open geven alleen werk aan mensen die beschikbaar zijn en agents die het kanaal mogen afhandelen. Past niemand, dan blijft het gesprek bij de afdeling. Elke toewijzing staat in de tijdlijn en in het auditlog. Maak een afdeling eigenaar van een kanaal onder **Instellingen**, **Kanalen** (zie [Kanalen](/docs/inbox/channels)).

## Bepaal wie er op een afdeling zit

Elke afdeling heeft één aanspreekpunt: de agent die het werk oppakt en de anderen vraagt. Eén persoon kan verantwoordelijk zijn: die beantwoordt wat het aanspreekpunt niet uit het werk kan halen.

1. Open de afdelingspagina. Onder de titel zie je waar de afdeling in de organisatie zit, en de bezetting met **Aanspreekpunt** en **Verantwoordelijk** gemarkeerd.
2. Eigenaren en beheerders kiezen **Bewerken** naast de bezetting.
3. Voeg agents en mensen toe met **Agent of persoon toevoegen**. Kies per rij een **Rol** (**Aanspreekpunt**, **Verantwoordelijk** of **Lid**) en eventueel een **Focus**, bijvoorbeeld facturen en herinneringen.
4. Kies **Bezetting opslaan**. Wijzigt het aanspreekpunt, dan vraagt Bokito om bevestiging en zet de wijziging in het afdelingsgesprek. **Ongedaan maken** in de melding zet de vorige bezetting terug.

Zonder gekozen aanspreekpunt neemt de eerste agent in de lijst die rol, gemarkeerd als **automatisch**. Gepauzeerde agents houden hun plek maar tonen pas weer als ze actief zijn. Een agent kan ook vanuit een gesprek een andere bezetting voorstellen; er verandert niets tot iemand de beslissing goedkeurt.

## Leid de organisatie

De organisatiepagina (`/organisatie`) is de top van de boom, onder de naam van de werkruimte.

1. Kies **Organisatie** op **Workforce** → **Afdelingen**, of de eerste stap in het pad op een afdelingspagina.
2. Het aanspreekpunt hier is de lead van de werkruimte: die pakt op wat geen afdeling bezit en geeft afdelingswerk door aan het aanspreekpunt van die afdeling. Eigenaren en beheerders zitten op de organisatie door hun rol.
3. Onder **Afdelingen** toont elke afdeling haar aanspreekpunt en open werk. Kies er een om haar te openen.

**Bewerken** op de bezetting van de organisatie waarschuwt dat agents op organisatieniveau alle afdelingen zien en sturen, en noemt de eigenaren en beheerders die er door hun rol zitten. Houd die bezetting klein.

## Zet de organisatieregels aan

Met de organisatieregels aan volgen agents de afdelingsboom: één agent handelt in een gesprek, de anderen lezen mee of worden gevraagd.

1. Kies op de organisatiepagina het tandwiel rechtsboven. Kies onder **Organisatieregels** **Aan**. Eigenaren en beheerders kunnen het omzetten; **Uit** houdt het oude gedrag.
2. De agent die een gesprek houdt handelt erin: hij antwoordt, archiveert en past het aan. Een andere agent leest mee of wordt gevraagd. Een persoon kan altijd overnemen; de tijdlijn toont wie oppakt, bijvoorbeeld "Opgepakt door Lisa (via Support)".
3. Zet op een afdelingspagina in het tandwiel **Zichtbaarheid** op **Afgeschermd** om het werk bij die afdeling, de afdelingen eronder en erboven, en eigenaren en beheerders te houden.
4. Agents praten langs de boom: omhoog naar de afdeling erboven, omlaag naar de afdelingen eronder, en met het aanspreekpunt van een zusterafdeling. Een vraag die niemand beantwoordt gaat omhoog naar de verantwoordelijke erboven; de melding zegt via welke afdeling hij kwam.
5. Moduletools en koppelingen volgen de boom ook. Agents in de afdeling van een module en de afdelingen eronder krijgen de tools ervan, een koppeling kan bij één afdeling horen (zie [Koppelingen](/docs/integrations/integrations)), en werk dat zijn tools onder **Gebruikt** noemt beperkt zijn gesprekken tot die (zie [Werk](/docs/ai/flows)).

## Geef een freelancer beperkt zicht

Een freelancer werkt in een of twee afdelingen en ziet alleen dat werk.

1. Nodig de persoon uit op **Workforce**. Kies **Rol** **Lid** en **Scope** **Afdelingen**. **Workspace** is de standaard. De kolom **Scope** toont daarna **Workspace**, of de namen van de afdelingen waarin die zit.
2. Zet de persoon in de afdelingen waarin die werkt (zie hierboven). Die ziet de gesprekken, tickets en mappen van die afdelingen, en wat aan hem of haar is toegewezen.
3. Vul bij **Uren per week** in hoeveel uur die voor je werkt. Laat het leeg als het niet van toepassing is.
4. Tickets met een veld **Uren** tellen mee voor dat aantal; het aanspreekpunt van de afdeling waarschuwt in de ochtendbriefing als iemand boven zijn uren is ingepland.

## Leid een afdeling vanaf de afdelingspagina

Een afdelingspagina toont wie erop zit, wie oppakt, en hoe elk werk van de afdeling loopt.

1. Kies de afdeling onder **Afdelingen** in het menu links, tussen **Werk** en **Team**. Elke afdeling waarin je werkt staat daar in het blauw, net als **Nieuw gesprek**, met het aantal open tickets. Eigenaren en beheerders zien alle afdelingen; een lid ziet de afdelingen waarin die zit en de afdelingen daaronder.
2. Het icoon staat naast de titel. Eigenaren en beheerders klikken erop om het icoon te kiezen dat de afdeling in het menu draagt.
3. Tussen de titel en de tabbladen staan het pad van de organisatie naar deze afdeling en de bezetting (zie [Bepaal wie er op een afdeling zit](#bepaal-wie-er-op-een-afdeling-zit)). **Open in Grid** en het tandwiel blijven rechtsboven. Onder de titel staan de autonomie van de afdeling en de module waar die uit komt. Een lid ziet de afdelingen waarin die zit en de afdelingen daaronder, niet het werk van de afdeling erboven.
4. Het tabblad **Overzicht** bevat de hele afdeling: **Open**, **Wacht**, **Over tijd** en **Beslissingen**, daarna **Vandaag** met wat nu aandacht vraagt (werk zonder eigenaar, werk over tijd of deze week af, en de laatste oriëntatie van het aanspreekpunt). Daaronder staan het flowbord, de agenda, **Werkt in**, de documentatie en de afdelingen eronder.
5. Onder **Werk** is elk werk een pijplijn: een cirkel per fase met de open tickets, een stip waar iets over tijd is, en een balk met de verdeling over de fases. Uit de scorekaart toont die **Autonoom**, **Gecorrigeerd** en **Gesloten (7 dagen)**. **Bord openen** opent het werk. De afdeling van een werk stel je in op de werkpagina.
6. Daaronder toont **Team** de bezetting met hun rol, open werk en uren per week; agents tonen ook waar ze mee bezig zijn en hun kosten over 7 dagen. **Verbetervoorstellen** toont wat het aanspreekpunt voorstelde.
7. Naast **Overzicht** staat een tabblad per map waar het werk van de afdeling landt, thuismappen eerst. Een map is een filter: het tabblad zoomt dezelfde tellingen, pijplijnen, het flowbord, de agenda, **Werkt in** en de documentatie in op die map. **Toevoegen aan Werkt in** en een nieuw document horen bij die map. De mappagina zelf is de container: gesprekken, bestanden en canvases open je daar.
8. Elke werkdagochtend zet het aanspreekpunt een briefing in het afdelingsgesprek: wat te laat is, wat te lang op een klant wacht, wat onvolledig is, en wie boven capaciteit zit. Op maandag noemt die ook een verbetering. Een afdeling die naar buiten kijkt, zoals Research, zet in plaats daarvan eens per week trends per klant (zie [Agenda](/docs/ai/agenda)).

## Vertel een afdeling waar ze op let

Het aanspreekpunt wordt zelf wakker als er iets gebeurt in zijn domein, niet alleen bij de ochtendoriëntatie. Deze instellingen horen bij de afdeling: kies je een ander aanspreekpunt, dan neemt die dezelfde gebeurtenissen, het budget en de brief over.

1. Kies op de afdelingspagina het tandwiel rechtsboven om **Waar het aanspreekpunt op let** te openen. Vink de **Gebeurtenissen die het aanspreekpunt volgt** aan, zoals **Nieuwe berichten**, **Stapwissels** of **Deadlines**, stel het **Dagbudget (EUR)** en de **Voorstellen per oriëntatie** in, en kies **Opslaan**. Zonder aanspreekpunt vraagt het venster eerst **Kies een aanspreekpunt**.
2. Op het tabblad **Overzicht**, onder **Domeinvragen**, vraagt het aanspreekpunt de verantwoordelijke wat het niet uit het werk kan lezen, bijvoorbeeld welke klanten voorgaan. Typ het antwoord en kies **Antwoorden**; het feit komt in de brief die het elke keer leest als het wakker wordt, samen met de bezetting en hun focus.
3. **Wat deze afdeling kan bereiken** toont wie het aanspreekpunt mag pushen of bellen: de persoon voor wie een beslissing is, of iedereen in de afdeling als het werk dringend is. Ieder stelt stille uren en oproepen in op de eigen pagina **Notificaties**.
4. De maptabbladen tonen waar het werk van de afdeling eindigt, **Pushes en oproepen** de recente pogingen om iemand te bereiken, en **Uitkomsten** hoe het laatst afgesloten werk ging. Elke poging staat ook in het gesprek waar die over ging.

## Lees het organogram

Het organogram is de boom van afdelingen, van boven naar beneden. De organisatie staat bovenaan. Elke afdeling hangt onder haar ouder.

1. Open **Workforce** en kies **Organogram**.
2. Lees van de organisatie naar beneden. Een lijn verbindt elke afdeling met de afdelingen eronder. Elke kaart toont het afdelingsicoon, de naam, het aanspreekpunt en hoeveel mensen en agents erin zitten.
3. Kies een kaart om die afdeling te openen, of de organisatiepagina voor de bovenste kaart.

## Bekijk de Grid

De Grid is de organisatiekaart in 3D: het bedrijf in het midden en elke afdeling als eiland met haar mensen en agents, en de mappen, werken en koppelingen waarmee ze werk.

1. Open **Workforce** en kies **Grid**.
2. Sleep om te schuiven, sleep met rechts om te kantelen en scroll om te zoomen. Namen bij de markeringen verschijnen vanaf **160%**; daaronder toont de kaart alleen de markeringen. Wijs een markering aan om de naam te lezen. Eilandnamen en de bedrijfsnaam blijven zichtbaar.
3. Wijs een item in de legenda aan om het en zijn directe koppelingen te laten oplichten. Klik erop om het op de kaart te vinden; klik op de kaart om de pagina ervan te openen.

**Open in Grid** op Agents, Werk en Mappen opent deze kaart met dat item gevonden.

## Volg werk in Workflow

![Workflow in 2D met de lens Stroom](/api/docs/assets/team/grid.png)
*Binnenkomst links, uitvoerders per afdeling, werk, en rechts het resultaat.*

1. Open **Workforce** en kies **Workflow**. Vier kolommen lees je van links naar rechts: **Binnenkomst**, **Aanpak · wie, per afdeling**, **Soort · werklabel, % autonoom** en **Uitkomst**. Een werk toont welk deel van zijn werk zonder correctie liep, bijvoorbeeld **82% autonoom**. De dikte van een lijn is het aantal gesprekken in de gekozen periode (**7 dagen**, **30 dagen** of **90 dagen**).
2. Kies een lens. **Stroom** toont de stroom. **Labels** kleurt een lijn in de kleur van het werk-label, met hetzelfde icoon als elders. Labels zonder werk staan samen als **Overig**, in grijs. Kies een label om alleen dat label door de keten te volgen. **Autonomie** kleurt uitvoerders naar wat ze zelf mogen (**Autonoom**, **Geassisteerd**, **Handmatig**). Het paneel rechts begint met **Knelpunten**: knooppunten die aandacht vragen, zoals werk dat niemand oppakt, of een persoon of agent met meer dan 15 open gesprekken of meer dan twee keer wat in het team gewoon is.
3. Workflow opent in **3D**: de vier lagen staan als platen naast elkaar. Kies **2D** voor het platte bord met dezelfde knooppunten. Sleep om te verschuiven, scroll om te zoomen en kies **Beginbeeld** om terug te gaan naar het startbeeld.
4. Kies een knooppunt. Het paneel rechts toont waar het werk vandaan komt en waar het heen gaat, elk met het eigen icoon, en de verdeling per label. Zijn er knelpunten, dan staat links van het paneel een knop met een uitroepteken en het aantal. Kies die en de lijst Knelpunten verschijnt op die plek, naast het paneel. Sluit de lijst en de knop komt terug. Het item blijft open. Is het knooppunt een agent of een persoon, dan staat het gezicht links, de functie in kleur ernaast en de omschrijving eronder. Een agent ademt als hij vrij is en toont de werkbeweging als hij bezig is. Een persoon houdt dezelfde opbouw, met zijn foto. **Open gesprekken** opent dat werk in Communicatie. Op een map opent **Toevoegen aan Werkt in** het maptabblad van de thuisafdeling, met het toevoegformulier klaar.
5. Heeft veel werk van een knooppunt geen label, kies dan **Labels voorstellen**. Er opent een agentchat met dat werk zonder label, de afzenders en bedrijven, en de agent stuurt één labelplan; er verandert niets tot je het goedkeurt. Zie [Labels en tickets](/docs/ai/categories).

De kolom Resultaat zegt **Geschat** zolang nog niet elk resultaat als oplevering is vastgelegd. Een map in die kolom telt het werk van de mappen hierin mee; kies hem om elke map hierin met een eigen aantal te zien. Iets wat via een koppeling is weggeschreven die in geen map staat, zoals een factuur in het boekhoudpakket, krijgt een eigen resultaat met de naam van de koppeling. Een gesloten gesprek zonder vastgelegde bestemming landt in **Afgerond**; het paneel ervan toont hoeveel er gesloten zijn als **Geen antwoord nodig**. Een gesprek telt onder zijn werk-label, of zonder werk-label onder het label dat het als eerste kreeg. Het oranje vak **Zonder afdeling** bevat mensen en agents die gesprekken afhandelen maar in geen afdeling zitten.

In 2D is elke afdeling een baan met haar mensen en agents links en haar werk rechts; werken zonder afdeling staan onder de banen. **Open in Grid** op een afdelingspagina opent Workflow met die baan in beeld. Elk knelpunt noemt de afdeling en het aanspreekpunt die ervan zijn.

## Persoonlijke instellingen blijven persoonlijk

Iedereen heeft **Profiel** en **Notificaties**. Op Profiel (**Instellingen** → **Profiel & beveiliging**) kies je **Voornaam**, **Achternaam**, **Taal** (Nederlands of Engels voor de dashboard-UI — menu's en labels; dat is niet de werktaal van de organisatie), **Startpagina**, **Weergave**, en optioneel een persoonlijke **E-mailhandtekening** (terugval wanneer een mailbox ieders eigen handtekening gebruikt; placeholders zoals `{{name}}`, `{{first_name}}` en `{{last_name}}` komen uit het profiel). Gedeelde mailbox-handtekeningen staan onder **Instellingen** → **Kanalen**. De werktaal van de organisatie (hoe agents voor het team schrijven) staat onder **Instellingen** → **Communicatie**. Op Notificaties kies je per niveau wat je bereikt: **Nu** (een gesprek of vraag voor jou, een nieuw bericht op een gesprek van jou of je team — standaard aan met in-app en push — een vermelding, een klant die op een mens wacht), **Later** (systeemmeldingen zoals een mislukte run of een Govern-voorstel, nooit als push) en **Overzicht** (teamactiviteit en afgeronde runs, ingeklapt in de bel en als dagelijkse e-mail). Gesprekken die jou nodig hebben staan in **Voor jou** in Communicatie; de belbadge volgt dat aantal en opent **Voor jou**, terwijl de lijst onder de bel systeemmeldingen houdt. **Wanneer agents je mogen bereiken** stelt stille uren in, het maximum aantal pushes per dag, en of agents je mogen bellen over een beslissing. Een beslissingspush heeft **Goedkeuren**, **Afwijzen** en **Bel me**; in de mobiele app opent **Bel me** de oproep, waar je beslist of opneemt in de web-app.

## Wat nu

Rond de [setupgids](/docs/getting-started/setup-guide) af, koppel daarna [kanalen](/docs/inbox/channels) en kies welk team elk kanaal bezit.
