---
title: Zo werkt Workforce
intro: Mensen, agents en teams op één pagina, met wie er beschikbaar is.
description: Nodig mensen uit, zie mensen en agents in één directory, groepeer ze in teams, kies hoe een team gesprekken oppakt, meld je afwezig en lees de teamcijfers.
keywords: workforce, team, leden, uitnodigen, rollen, teams, beschikbaarheid, afwezig, om de beurt, minst open, oppakken
sort: 60
related: setup-guide,communication,agents,channels
---

# Zo werkt Workforce

Workforce toont iedereen die gesprekken afhandelt: de mensen in de workspace, de bedrijfsagents en de teams waarin je ze groepeert. Open **Workforce** in de rail onder **Organisatie** om iemand uit te nodigen, de directory te bekijken of een team te maken.

## Nodig iemand uit

![Uitnodigen op Workforce](/api/docs/assets/team/invite.png)
*Eigenaren en beheerders nodigen mensen uit bovenaan Workforce.*

1. Open **Workforce**. Vul onder **Personen uitnodigen** een volledig e-mailadres in en kies **Rol**: **Beheerder** of **Lid**. Kies **Wat mag welke rol** tussen de rol en **Uitnodigen** als je de rechtenmatrix nodig hebt.
2. Kies **Uitnodigen**. Kan deze server geen mail versturen, gebruik dan **Uitnodigingslink kopiëren** en deel die zelf.
3. Openstaande uitnodigingen staan in de directory onder **In afwachting**. Gebruik **Uitnodiging opnieuw versturen** of **Uitnodiging intrekken**. Op een actief iemand wijzig je de rol of kies je **Deactiveren**. Alleen de **Eigenaar** kan een eigenaar promoveren, degraderen of deactiveren.

Leden beantwoorden gesprekken. Eigenaren en beheerders koppelen ook kanalen, wijzigen autonomie en nemen Govern-voorstellen aan. Zie [Govern](/docs/govern/govern).

## Neem nieuwe agents aan

1. Open op **Workforce**, onder **Personen uitnodigen**, de banner **Neem nieuwe agents aan**.
2. Kies **Marketplace** om specialisten te bekijken die je naast je team kunt zetten.
3. Na het aannemen van een agent verschijnt die in de directory onder **Agents** (zie [Agents](/docs/ai/agents)).

## Meld je afwezig

1. Open je accountmenu (onderaan de rail) en zet aanwezigheid op **Afwezig**. Je stip wordt overal grijs: in de lijst, in het gesprek, bij toewijzen en op Workforce.
2. Zolang je afwezig bent, slaan agents je over als ze kiezen wie ze iets vragen, geven teams je geen nieuwe gesprekken, en telt de websitechat je niet mee als beschikbaar voor een live overdracht.
3. Zet aanwezigheid weer op beschikbaar als je terug bent. Iemand telt als beschikbaar zolang Bokito open staat op een van zijn apparaten.

Agents tonen een paarse hoekmarkering: stil als ze op standby staan, pulsend als ze echt aan een gesprek of run werken.

## Lees de directory

1. Op **Workforce** toont de directory mensen, openstaande uitnodigingen en bedrijfsagents samen. Filter met **Alles**, **Mensen**, **Agents**, **In afwachting** of **Gedeactiveerd**, of zoek op naam. **Alles**, **Mensen** en **Agents** verbergen gedeactiveerde rijen. De kolom **Laatst actief** toont wanneer iemand voor het laatst online was en wanneer een agent voor het laatst draaide. Via Gerelateerd open je **Agents** (zelfde filter **Gedeactiveerd** daar).
2. Elke persoon toont rol, teams, open werk en aanwezigheid (**Beschikbaar**, **Afwezig**, **Offline**). Elke agent gebruikt dezelfde markering als op Agents en in Communicatie, en Status is **Standby**, **Bezig** of **Fout** — geen vraagtellers. Open een agent voor 30-dagencijfers en regels (zie [Agents](/docs/ai/agents)).
3. Mensen en agents gebruiken hun eigen markering; teams gebruiken een facepile van leden. De hoekpunten volgen één hiërarchie: groen als een persoon beschikbaar is, paars pulsend als een agent in het team bezig is, oranje als iemand afwezig is, stil paars als alleen agents beschikbaar zijn, grijs als iedereen offline is.

## Deactiveer een persoon of agent

1. Open op **Workforce** de rij van een persoon of bedrijfsagent. Kies **Deactiveren**. Die verdwijnt uit het werkrooster: kiezers, teams, toewijzing en chatdoelen slaan hen over. Geschiedenis in gesprekken en agentruns blijft.
2. Status op die rij (en op de agentpagina) is **Gedeactiveerd**. Open het filter **Gedeactiveerd** om iedereen te zien die buiten het rooster staat.
3. Kies **Opnieuw activeren** op de rij, of **Opnieuw activeren** op de agentpagina, om hen terug te zetten. Dezelfde e-mail opnieuw uitnodigen brengt een gedeactiveerd persoon ook terug als die de uitnodiging accepteert.

## Maak een team

1. Scroll naar **Teams** en kies **Nieuw team**. **Alle mensen** en **Alle agents** bestaan altijd; hun leden volgen de workspace. Die systeemteams kun je niet bewerken of qua oppakken wijzigen, en ze verschijnen nooit als map in Communicatie.
2. Geef een eigen team een naam en eventueel een omschrijving. Vink de mensen en agents aan. Een team mag beide mengen. De teammarkering is altijd de facepile van de leden — er is geen aparte keuze voor initialen of icoon.
3. Kies onder **Gesprekken oppakken** wat er gebeurt met nieuwe gesprekken van het team:
   - **Mensen pakken op**: het gesprek blijft bij het team; wie als eerste reageert, neemt het.
   - **Agent eerst**: een agent in het team antwoordt eerst; mensen springen bij als hij iets vraagt.
   - **Om de beurt**: elk nieuw gesprek gaat direct naar het volgende beschikbare lid.
   - **Minst open**: elk nieuw gesprek gaat naar het beschikbare lid met de minste open gesprekken.
4. Kies **Opslaan**. Elk eigen team verschijnt onder **Teams** in de Communicatie-zijbalk als map met **Voor jou**, **Open**, **Niet toegewezen** en **Gesloten**.
5. Open in **Communicatie** die teammap en kies **Groepschat**. Bokito opent (of maakt) één vast intern gesprek van het team, zodat leden kunnen praten zonder een klantgesprek.
6. Terug op **Workforce** openen de naam van een eigen team en de knop **Gesprekken** diezelfde teammap. Links op elke teamrij — en in de toewijskieser, vermeldingen en Communicatie-mappen — staat die facepile: tot drie overlappende ledenmarkeringen (mensen en agents); bij meer staat op de vierde plek **+N**. Agentmarkeringen op Workforce openen de agentpagina en komen overeen met de markering op die pagina. De systeemteams **Alle mensen** en **Alle agents** hebben geen map; hun naam blijft gewone tekst.

Om de beurt en minst open geven alleen werk aan mensen die beschikbaar zijn en agents die het kanaal mogen afhandelen. Past niemand, dan blijft het gesprek bij het team. Elke toewijzing staat in de tijdlijn en in het auditlog. Maak een team eigenaar van een kanaal onder **Instellingen**, **Kanalen** (zie [Kanalen](/docs/inbox/channels)).

## Persoonlijke instellingen blijven persoonlijk

Iedereen heeft **Profiel** en **Notificaties**. Op Profiel (**Instellingen** → **Profiel & beveiliging**) kies je **Voornaam**, **Achternaam**, **Taal** (Nederlands of Engels voor de dashboard-UI — menu's en labels; dat is niet de werktaal van de organisatie), **Startpagina**, **Weergave**, en optioneel een persoonlijke **E-mailhandtekening** (terugval wanneer een mailbox ieders eigen handtekening gebruikt; placeholders zoals `{{name}}`, `{{first_name}}` en `{{last_name}}` komen uit het profiel). Gedeelde mailbox-handtekeningen staan onder **Instellingen** → **Kanalen**. De werktaal van de organisatie (hoe agents voor het team schrijven) staat onder **Instellingen** → **Communicatie**. Op Notificaties kies je per niveau wat je bereikt: **Nu** (een gesprek of vraag voor jou, een nieuw bericht op een gesprek van jou of je team — standaard aan met in-app en push — een vermelding, een klant die op een mens wacht), **Later** (systeemmeldingen zoals een mislukte run of een Govern-voorstel, nooit als push) en **Overzicht** (teamactiviteit en afgeronde runs, ingeklapt in de bel en als dagelijkse e-mail). Gesprekken die jou nodig hebben staan in **Voor jou** in Communicatie; de belbadge volgt dat aantal en opent **Voor jou**, terwijl de lijst onder de bel systeemmeldingen houdt.

## Wat nu

Rond de [setupgids](/docs/getting-started/setup-guide) af, koppel daarna [kanalen](/docs/inbox/channels) en kies welk team elk kanaal bezit.
