---
title: Zo werken Draaiboeken
intro: Een draaiboek is een herhaalbaar stappenproces dat agents uitvoeren — met een volledig werklog per run.
description: Definieer draaiboeken met zes geordende stapsoorten, één run per gevolgd signaal en een leesbaar werklog.
keywords: werkstromen, draaiboeken, stappen, runs, werklog, beslissing, antwoord, planning, sjablonen
sort: 45
related: projects,agenda,agents,knowledge,cases
---

# Zo werken Draaiboeken

Een draaiboek is een gedefinieerd proces voor werk dat terugkomt: cijfers verzamelen voor een aangifte, de maand afsluiten, een rapport bijwerken. Open **Draaiboeken** (Werk-groep) om de stappen één keer te definiëren en agents ze run na run te laten uitvoeren, met een werklog dat je terugleest.

## Maak een draaiboek

1. Open **Draaiboeken** en kies **Nieuw draaiboek**. Geef het proces een naam en druk op Enter.
2. Koppel het draaiboek optioneel aan een project. Een projectgebonden draaiboek mag de documentatie van dat project bewerken; agent-bewerkingen aan projectdocumentatie gebeuren alleen binnen draaiboek-runs.
3. Laat **Ingeschakeld** aan staan. Een uitgeschakeld draaiboek behoudt definitie en historie, maar kan geen nieuwe runs starten.

## Definieer de stappen

1. Open het draaiboek en kies **Stap toevoegen**. Een draaiboek heeft minimaal één stap; stappen lopen op volgorde.
2. Kies per stap één van zes soorten:
   - **Bericht sturen** — stuur een bericht in het gevolgde gesprek. Velden zoals `{amount}` gebruiken waarden uit de runinput.
   - **Agenttaak** — geef een agent een doel. Kies een specifieke agent of laat Bokito de lead-agent bepalen.
   - **Wachten op antwoord** — parkeer de run tot het contact antwoordt; optionele antwoordtakken leiden passende antwoorden naar een andere stap.
   - **Beslissing vragen** — toon een inline beslissing in het gesprek; elke optie kan naar een andere stap leiden.
   - **Tool aanroepen** — voer een Bokito-tool uit met JSON-argumenten. Argumenten ondersteunen dezelfde veldsjablonen.
   - **Inplannen** — wacht het ingestelde aantal uren en ga daarna verder.
3. Koppel kennissecties aan een stap zodat de agent precies het handboekmateriaal leest dat die stap nodig heeft.
4. Herschik of verwijder stappen wanneer je wilt; lopende runs houden de stappenlijst waarmee ze zijn gestart.

## Start en volg een run

1. **Run starten** blijft uit tot het draaiboek minstens één stap heeft en **Ingeschakeld** is (niet gepauzeerd). Voeg eerst een stap toe, kies daarna **Run starten**, typ de input (het verzoek, de periode of de context waar deze run over gaat) en bevestig. Auto-start komt van het signaaltype (**Start het draaiboek direct** onder [Signalen](/docs/ai/cases)) of van geaccepteerde intake op de Over-kaart — maximaal één run per gevolgd signaal en draaiboek, ook als meerdere herkende signalen in het gesprek ernaar verwijzen.
2. Het run-detail toont de status (**Actief**, **Wachtend**, **Wacht op gate**, **Afgerond**, **Mislukt**, **Geannuleerd**), de input en een stap-voor-stap werklog: wat elke agent-stap deed, wanneer de run wachtte en welke beslissingen zijn genomen.
3. Een wachtende run gaat verder wanneer je **Hervatten** kiest met het verwachte antwoord. Een beslissing wordt inline in het gevolgde gesprek opgelost; de gekozen tak bepaalt de volgende stap.
4. **Annuleren** stopt een run; het werklog blijft bewaard.

## Handel een mislukte stap af

1. Bokito probeert een mislukte of vastgelopen stap automatisch opnieuw. De workspace-standaard is twee nieuwe pogingen.
2. Na de limiet wordt het gevolgde signaal **Wachtend** en verschijnt een beslissingskaart in hetzelfde gesprek.
3. Kies **Opnieuw proberen**, **Stap overslaan** of **Draaiboek stoppen**. Afgeronde agent-runs verschijnen als agentberichten in dat gesprek, zodat de thread het werklog blijft.

## Promoveer een run naar kennis

1. Open een afgeronde run.
2. Kies **Promoveer naar kennis**. De agent destilleert de uitkomst tot een kennissectie, zodat de volgende run slimmer start.

## Installeer een draaiboek vanuit een module

Modules leveren voorgebouwde draaiboeken mee (bijvoorbeeld btw-aangifte voorbereiden op Boekhouding). Installeer er een vanaf de modulepagina onder **Draaiboeksjablonen**; de kopie is van jou en mag je bewerken. Voor elke run controleert Bokito opnieuw of de module is geïnstalleerd, de verbinding werkt en de agents bestaan — een run met een kapotte vereiste pauzeert met een beslissing in plaats van stil te falen.

## Stel een draaiboek op vanuit chat

1. Vertel een agent welk draaiboek je wilt maken of hoe de geordende stappen moeten veranderen.
2. De agent stelt `create_workstream` of `update_workstream` voor als PlatformChange met de volledige stappenlijst.
3. Beoordeel het concept in Govern. Toepassen werkt hetzelfde draaiboek op **Draaiboeken** bij; `/os` blijft de kaartweergave.

## Wat nu

Leid terugkerend queue-werk via draaiboeken op [Projecten](/docs/ai/projects). Accepteer chat-intake op de Over-kaart — zie [Signalen](/docs/ai/cases). Plan een draaiboek met een trigger op de [Agenda](/docs/ai/agenda). Sjablonen komen uit [Integraties](/docs/integrations/integrations).
