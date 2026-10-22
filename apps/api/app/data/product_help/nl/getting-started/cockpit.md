---
title: Zo werkt Vandaag
intro: Begin hier als je wilt weten of werk doorloopt en waar aandacht nodig is.
description: Gebruik Vandaag in Communicatie voor de dagelijkse scan. Tokenbudget en kosten staan onder Instellingen, Verbruik. Agentactiviteit staat op Agents.
keywords: vandaag, cockpit, dashboard, overzicht, verbruik, budget, activiteit
sort: 50
related: communication,categories,agent-runs,decisions,agenda,agents
---

# Zo werkt Vandaag

Vandaag is de ochtendscan binnen Communicatie. Open **Communicatie**, dan **Vandaag**, om te zien waar jij nodig bent, welke tickets openstaan, wat loopt en hoe het traject zich ontwikkelt, en spring daarna in het onderliggende gesprek of de run. Het adres is `/communication/today`. Onder **Instellingen → Profiel** kies je als startpagina na inloggen **Nieuwe chat** (standaard), **Inbox**, **Agenda** of **Vandaag**.

## Scan de dag op Vandaag

![Vandaag](/api/docs/assets/cockpit/overview.png)
*Vandaag toont open werk, beslissingen en recente runs.*

1. Open **Vandaag** vanuit Communicatie. Je landt op de scan. De titel op de pagina is de workspacenaam; het hulp-icoon naast **Vandaag** in de bovenbalk opent deze gids. De ondertitel begroet je en toont de datum van vandaag. De grijze regel `environment · tenant-slug · Live · 1.2.01` is voor support (API-environment, deze tenant, websocket, releaseversie). Klik de slug om de hele regel te kopiëren. Dezelfde regel staat onderaan het accountmenu. De dev-host toont de volgende patch, één stap voor op productie.
2. **Voor jou** staat bovenaan over de volle breedte: open beslissingen en gesprekken die aan jou zijn toegewezen (dezelfde lijst als **Voor jou** in Communicatie). Is die leeg, gebruik **Voor jou openen** of **Kanaal koppelen**.
3. Daaronder toont **AI-activiteit** een gestapelde area-grafiek van gewogen **AI**-werk (paars) over **handmatig** werk (grijs), **Tijd bespaard** (geschatte minuten uit AI-resultaten: autonome sends, geassisteerde concepten die verstuurd of door een persoon voortgezet zijn, stille no-reply-triage, bevestigde no-reply-sluitingen, door AI vastgelegde tickets, afgeronde werken) en **AI-aandeel** (het deel van de gewogen acties dat AI afhandelt). Met de switcher **7 dagen** / **30 dagen** / **90 dagen** (zelfde als bij **Instellingen → Verbruik**) kies je het venster; bij beide cijfers staat een groene pijl omhoog of een rode pijl omlaag met het procentuele verschil ten opzichte van de vorige even lange periode, als die data er is. Rechts staat een cirkeldiagram van gewogen **Autonoom**-, **Geassisteerd**- en **Handmatig**-acties voor de gekozen periode (met open-gesprekstellers onder de legenda). **Instellingen Autonomie** opent de workspace-draaiknop. Zie [Autonomie](/docs/inbox/inbox-ai).
4. Onder **Verder in de workspace** staan drie secundaire blokken: **Open tickets per categorie**, **Lopend en straks** en **Traject**. **Lopend en straks** waarschuwt voor openstaande check-ups en verlopen kijkmomenten, toont de eerstvolgende items uit [Agenda](/docs/ai/agenda), daarna de lopende runs, en eindigt met **Agenda openen**. Traject vergelijkt deze week met vorige week: **Tickets vastgelegd (7 dagen)** telt alleen bevestigde tickets, en het blok linkt naar afgeronde runs, Govern-voorstellen en Verbruik.
5. Klik een rij om het gesprek, de run of een gefilterde lijst te openen. Een rij onder **Open tickets per categorie** opent de rij van die categorie in Communicatie. Heeft een open gesprek 14 dagen geen bericht, dan staat het onder **Al 14 dagen stil** met **Afsluiten**. Zonder terugkerende taak staat bovenaan eenmalig de banner **Laat een agent je verder helpen** met **Taak instellen**. Die opent **Plannen** al ingevuld: elke werkdag om 09:00, de hoofdagent, en een opdracht die noemt wat openstaat en volgende stappen voorstelt. Na **Opslaan** land je in dat gesprek, waar de agent elke keer schrijft. **Verbergen** haalt de banner weg voor deze workspace.

Accepteerde je de laatste 30 dagen een voorstel uit de scorekaart van een werk, dan toont **Wat is verbeterd** dat werk met het aandeel autonoom nu en ervoor, bijvoorbeeld **Op Autonoom gezet; was 64% autonoom**. Klik erop om het werk te openen. Zie [Autonomie](/docs/govern/autonomy).

In een nieuwe workspace kan Vandaag nog setupvoortgang tonen. Rond die af via de [setupgids](/docs/getting-started/setup-guide).

## Vind een canvas

Vandaag heeft geen canvastab. Een canvas is een werkplek in een map: open de map en vind het onder **Werkt in**, of open `/cockpit/canvas`, dat je naar het laatst gebruikte canvas brengt of naar de map **Algemeen**. Zie [Mappen](/docs/ai/folders).

## Open werk dat op jou wacht

![Today-aandachtspunten](/api/docs/assets/cockpit/awaiting-decision.png)
*Voor jou opent hetzelfde gesprek als Beslissingen in Communicatie.*

1. Zoek het gesprek onder **Voor jou**. De rij toont dezelfde avatar, hetzelfde onderwerp en dezelfde beslissingsmarkering als Communicatie.
2. Open het. Je landt op het bijbehorende gesprek in Communicatie.
3. Handel de beslissing af in het gesprek en keer terug naar Vandaag.

## Lees agentactiviteit

1. Open **Agents** voor de Activiteit-swimlane. Vandaag zelf houdt **Voor jou** vooraan, daarna de secundaire contextblokken.
2. Scan resultaten, niet elke denkstap.
3. Spring naar een gesprek of agent wanneer een rij follow-up vraagt. Zie [Agentactiviteit volgen](/docs/inbox/agent-runs).

## Check Verbruik

1. Open **Instellingen**, daarna **Verbruik**. Bovenaan staat **Tokengebruik**: een grafiek per dag voor **7 dagen**, **30 dagen** of **90 dagen**, met **Tokens** en **Kosten** voor die periode ernaast. Daaronder staan **Budget (platformsleutels)** (tokens vandaag en factureerbare spend deze maand), **Resultaat** (gesprekken, autonomieratio, tijd bespaard, gemiddelde feedback, klantbeoordeling en open beslissingen van deze week) en **Uitsplitsing** (**Per model**, **Per agent**, **Per gebruiker**, **Per dataregio**). **Tijd bespaard** is een schatting over 7 dagen: vaste minuten per autonome antwoorden, geassisteerde concepten (ook als iemand daarna zelf antwoordde), stille no-reply-triage, bevestigde no-reply-sluitingen, door AI vastgelegde tickets en afgeronde werken. De dataregio-mix staat onder **Per dataregio**; wijzig het beleid onder [Data en privacy](/docs/govern/privacy-security). Kies **CSV exporteren** in de kop.
2. Owners en admins kiezen **Plafonds bewerken**. Zet een **Dagelijks tokenplafond** en een **Maandelijks spendplafond (USD)**, of laat een veld leeg voor **Geen plafond**. Meldingen gaan af bij 80% en 100%.
3. Als het budget op is, pauzeren AI-calls op Bokito-platformkeys tot je het plafond verhoogt of de periode reset. Modellen op je eigen keys blijven werken (**Eigen sleutel (geen kosten)**).
