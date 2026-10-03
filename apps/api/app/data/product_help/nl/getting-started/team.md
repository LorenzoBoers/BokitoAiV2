---
title: Zo werkt Team
intro: Mensen, agents en teams in één overzicht, met wie er beschikbaar is.
description: Nodig mensen uit, groepeer mensen en agents in teams, kies hoe een team gesprekken oppakt, meld je afwezig en lees de teamcijfers.
keywords: team, leden, uitnodigen, rollen, teams, beschikbaarheid, afwezig, om de beurt, minst open, oppakken
sort: 60
related: setup-guide,communication,agents,channels
---

# Zo werkt Team

Team toont iedereen die gesprekken afhandelt: de mensen in de workspace, de bedrijfsagents en de teams waarin je ze groepeert. Open **Team** in de rail om iemand uit te nodigen, een team te maken of te zien wie er nu beschikbaar is.

## Nodig iemand uit

![Tab Mensen op Team](/api/docs/assets/team/invite.png)
*Eigenaren en beheerders nodigen mensen uit op de tab Mensen.*

1. Open **Team** en daarna de tab **Mensen**.
2. Vul onder **Nodig een teammate uit** een volledig e-mailadres in en kies **Rol**: **Beheerder** of **Lid**. De tabel **Wat elke rol mag** toont uitnodigen, agents wijzigen en gesprekken afhandelen.
3. Kies **Uitnodigen**. Kan deze server geen mail versturen, gebruik dan **Uitnodigingslink kopiëren** en deel die zelf.
4. Volg openstaande uitnodigingen onder **In afwachting** met **Uitnodiging opnieuw versturen** of **Uitnodiging intrekken**. Open een actief iemand om de rol te wijzigen of kies **Lid verwijderen**. Alleen de **Eigenaar** kan een eigenaar promoveren, degraderen of verwijderen.

Leden beantwoorden gesprekken. Eigenaren en beheerders koppelen ook kanalen, wijzigen autonomie en nemen Govern-voorstellen aan. Zie [Govern](/docs/govern/govern).

## Meld je afwezig

1. Zet bovenaan **Team** de schakelaar **Afwezig** aan. Je stip wordt overal grijs: in de lijst, in het gesprek, bij toewijzen en op Team.
2. Zolang je afwezig bent, slaan agents je over als ze kiezen wie ze iets vragen, geven teams je geen nieuwe gesprekken, en telt de websitechat je niet mee als beschikbaar voor een live overdracht.
3. Zet **Afwezig** uit als je terug bent. Iemand telt als beschikbaar zolang Bokito open staat op een van zijn apparaten.

Agents zijn altijd beschikbaar, tenzij ze gepauzeerd zijn.

## Maak een team

1. Open de tab **Teams** en kies **Nieuw team**. **Alle mensen** en **Alle agents** bestaan altijd; hun leden volgen de workspace.
2. Geef het team een naam, eventueel een omschrijving, en vink de mensen en agents aan. Een team mag beide mengen.
3. Kies onder **Gesprekken oppakken** wat er gebeurt met nieuwe gesprekken van het team:
   - **Mensen pakken op**: het gesprek blijft bij het team; wie als eerste reageert, neemt het.
   - **Agent eerst**: een agent in het team antwoordt eerst; mensen springen bij als hij iets vraagt.
   - **Om de beurt**: elk nieuw gesprek gaat direct naar het volgende beschikbare lid.
   - **Minst open**: elk nieuw gesprek gaat naar het beschikbare lid met de minste open gesprekken.
4. Zet **Tonen in de zijbalk van Communicatie** aan om iedereen een map voor dit team te geven met **Voor jou**, **Open**, **Niet toegewezen** en **Gesloten**. Kies **Opslaan**.

Om de beurt en minst open geven alleen werk aan mensen die beschikbaar zijn en agents die het kanaal mogen afhandelen. Past niemand, dan blijft het gesprek bij het team. Elke toewijzing staat in de tijdlijn en in het auditlog. Maak een team eigenaar van een kanaal onder **Instellingen**, **Kanalen** (zie [Kanalen](/docs/inbox/channels)).

## Lees de teamcijfers

1. Open de tab **Agents**. Elke agent toont zijn open gesprekken, zijn plafond en vier cijfers over de laatste 30 dagen: **Vragen**, **Ongewijzigd goedgekeurd**, **Antwoordtijd** en **Opgepakt**.
2. Open de tab **Teams**. Elke teamkaart toont hoeveel vragen naar het team gingen, hoe snel ze beantwoord werden en hoeveel gesprekken het team uitdeelde.
3. Is **Ongewijzigd goedgekeurd** laag, dan passen mensen vaak aan of wijzen ze af wat de agent voorstelt. Open de agent en pas zijn regels aan (zie [Agents](/docs/ai/agents)).

## Persoonlijke instellingen blijven persoonlijk

Iedereen heeft **Profiel** en **Notificaties**. Op Profiel kies je **Startpagina**, **Weergave**, taal en een persoonlijke **E-mailhandtekening**. Op Notificaties kies je per niveau wat je bereikt: **Nu** (een gesprek of vraag voor jou, een vermelding, een klant die op een mens wacht), **Later** (systeemmeldingen zoals een mislukte run of een Govern-voorstel, nooit als push) en **Overzicht** (teamactiviteit en afgeronde runs, ingeklapt in de bel en als dagelijkse e-mail). Gesprekken die jou nodig hebben staan in **Voor jou** in Communicatie; de bel houdt alleen systeemmeldingen.

## Wat nu

Rond de [setupgids](/docs/getting-started/setup-guide) af, koppel daarna [kanalen](/docs/inbox/channels) en kies welk team elk kanaal bezit.
