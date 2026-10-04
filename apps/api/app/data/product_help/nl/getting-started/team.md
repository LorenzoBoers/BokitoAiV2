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

1. Open **Workforce**. Vul onder **Nodig een teammate uit** een volledig e-mailadres in en kies **Rol**: **Beheerder** of **Lid**. Open **Wat elke rol mag** als je de rechtenmatrix nodig hebt.
2. Kies **Uitnodigen**. Kan deze server geen mail versturen, gebruik dan **Uitnodigingslink kopiëren** en deel die zelf.
3. Openstaande uitnodigingen staan in de directory onder **In afwachting**. Gebruik **Uitnodiging opnieuw versturen** of **Uitnodiging intrekken**. Op een actief iemand wijzig je de rol of kies je **Lid verwijderen**. Alleen de **Eigenaar** kan een eigenaar promoveren, degraderen of verwijderen.

Leden beantwoorden gesprekken. Eigenaren en beheerders koppelen ook kanalen, wijzigen autonomie en nemen Govern-voorstellen aan. Zie [Govern](/docs/govern/govern).

## Meld je afwezig

1. Open je accountmenu (onderaan de rail) en zet aanwezigheid op **Afwezig**. Je stip wordt overal grijs: in de lijst, in het gesprek, bij toewijzen en op Workforce.
2. Zolang je afwezig bent, slaan agents je over als ze kiezen wie ze iets vragen, geven teams je geen nieuwe gesprekken, en telt de websitechat je niet mee als beschikbaar voor een live overdracht.
3. Zet aanwezigheid weer op beschikbaar als je terug bent. Iemand telt als beschikbaar zolang Bokito open staat op een van zijn apparaten.

Agents tonen een paarse hoekmarkering: stil als ze op stand-by staan, pulsend als ze echt aan een gesprek of run werken.

## Lees de directory

1. Op **Workforce** toont de directory mensen, openstaande uitnodigingen en bedrijfsagents samen. Filter met **Alles**, **Mensen**, **Agents** of **In afwachting**, of zoek op naam.
2. Elke persoon toont rol, teams en open werk. Elke agent toont plafond, open gesprekken en een korte 30-dagenregel (vragen en antwoordtijd). Open een agent voor volledige cijfers en regels (zie [Agents](/docs/ai/agents)).
3. Mensen, agents en teams gebruiken dezelfde soort markering: twee letters (of een icoon/afbeelding als die is gezet). De hoekpunten volgen één hiërarchie: groen als een persoon beschikbaar is, paars pulsend als een agent in het team bezig is, oranje als iemand afwezig is, stil paars als alleen agents op stand-by staan, grijs als iedereen offline is.

## Maak een team

1. Scroll naar **Teams** en kies **Nieuw team**. **Alle mensen** en **Alle agents** bestaan altijd; hun leden volgen de workspace. Die systeemteams kun je niet bewerken, pinnen of qua oppakken wijzigen, en ze verschijnen nooit als map in Communicatie.
2. Geef een eigen team een naam, eventueel een omschrijving, en kies een **Teammarkering** (initialen of icoon). Vink de mensen en agents aan. Een team mag beide mengen.
3. Kies onder **Gesprekken oppakken** wat er gebeurt met nieuwe gesprekken van het team:
   - **Mensen pakken op**: het gesprek blijft bij het team; wie als eerste reageert, neemt het.
   - **Agent eerst**: een agent in het team antwoordt eerst; mensen springen bij als hij iets vraagt.
   - **Om de beurt**: elk nieuw gesprek gaat direct naar het volgende beschikbare lid.
   - **Minst open**: elk nieuw gesprek gaat naar het beschikbare lid met de minste open gesprekken.
4. Zet **Tonen in de zijbalk van Communicatie** aan om iedereen een map voor dit team te geven met **Voor jou**, **Open**, **Niet toegewezen** en **Gesloten**. Kies **Opslaan**.

Om de beurt en minst open geven alleen werk aan mensen die beschikbaar zijn en agents die het kanaal mogen afhandelen. Past niemand, dan blijft het gesprek bij het team. Elke toewijzing staat in de tijdlijn en in het auditlog. Maak een team eigenaar van een kanaal onder **Instellingen**, **Kanalen** (zie [Kanalen](/docs/inbox/channels)).

## Persoonlijke instellingen blijven persoonlijk

Iedereen heeft **Profiel** en **Notificaties**. Op Profiel kies je **Startpagina**, **Weergave**, taal en een persoonlijke **E-mailhandtekening**. Op Notificaties kies je per niveau wat je bereikt: **Nu** (een gesprek of vraag voor jou, een vermelding, een klant die op een mens wacht), **Later** (systeemmeldingen zoals een mislukte run of een Govern-voorstel, nooit als push) en **Overzicht** (teamactiviteit en afgeronde runs, ingeklapt in de bel en als dagelijkse e-mail). Gesprekken die jou nodig hebben staan in **Voor jou** in Communicatie; de bel houdt alleen systeemmeldingen.

## Wat nu

Rond de [setupgids](/docs/getting-started/setup-guide) af, koppel daarna [kanalen](/docs/inbox/channels) en kies welk team elk kanaal bezit.
