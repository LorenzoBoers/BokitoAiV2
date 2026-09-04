---
title: Zo werken Werkstromen
intro: Een werkstroom is een herhaalbaar stappenproces dat agents uitvoeren — met een volledig werklog per run.
description: Definieer werkstromen met agent-, wacht- en gate-stappen, start runs met elke input, volg het werklog en promoveer resultaten naar kennis.
keywords: werkstromen, stappen, runs, werklog, gate, wachten, deadline, draaiboek, sjablonen
sort: 45
related: projects,agenda,agents,knowledge,cases
---

# Zo werken Werkstromen

Een werkstroom is een gedefinieerd proces voor werk dat terugkomt: cijfers verzamelen voor een aangifte, de maand afsluiten, een rapport bijwerken. Open **Werkstromen** (AI-groep) om de stappen één keer te definiëren en agents ze run na run te laten uitvoeren, met een werklog dat je terugleest.

## Maak een werkstroom

1. Open **Werkstromen** en kies **Nieuwe werkstroom**. Geef het proces een naam en druk op Enter.
2. Koppel de werkstroom optioneel aan een project. Een projectgebonden werkstroom mag de documentatie van dat project bewerken; agent-bewerkingen aan projectdocumentatie gebeuren alleen binnen werkstroom-runs.
3. Laat **Ingeschakeld** aan staan. Een uitgeschakelde werkstroom behoudt definitie en historie, maar kan geen nieuwe runs starten.

## Definieer de stappen

1. Open de werkstroom en kies **Stap toevoegen**. Een werkstroom heeft minimaal één stap; stappen lopen op volgorde.
2. Kies per stap een soort:
   - **Agent-stap** — schrijf het doel dat de agent moet behalen. Kies een specifieke agent of een rol; de rol wordt bij de run vertaald naar een actieve agent.
   - **Wacht-stap** — de run parkeert tot er input binnenkomt, een event afgaat of tijd verstrijkt. Stel een deadline in uren in en wat er gebeurt als die verloopt: doorgaan, herinneren en doorgaan, of falen.
   - **Gate-stap** — de run pauzeert voor menselijke goedkeuring. De beslissing landt in Berichten.
3. Koppel kennissecties aan een stap zodat de agent precies het handboekmateriaal leest dat die stap nodig heeft.
4. Herschik of verwijder stappen wanneer je wilt; lopende runs houden de stappenlijst waarmee ze zijn gestart.

## Start en volg een run

1. Kies **Run starten**, typ de input (het verzoek, de periode of de context waar deze run over gaat) en bevestig. Runs starten ook vanaf een queue-item op een project, vanaf een trigger op de Agenda, vanuit een module, of vanuit een [signaal](/docs/ai/cases) dat aan deze werkstroom is gekoppeld.
2. Het run-detail toont de status (**Actief**, **Wachtend**, **Wacht op gate**, **Afgerond**, **Mislukt**, **Geannuleerd**), de input en een stap-voor-stap werklog: wat elke agent-stap deed, wanneer de run wachtte en welke beslissingen zijn genomen.
3. Een wachtende run gaat verder wanneer je **Hervatten** kiest met de input waar hij op wacht. Een gate wordt opgelost via de beslissingskaart in Berichten; goedkeuring promoveert ook doc-secties die de run schreef van **Review** naar **Definitief**.
4. **Annuleren** stopt een run; het werklog blijft bewaard.

## Promoveer een run naar kennis

1. Open een afgeronde run.
2. Kies **Promoveer naar kennis**. De agent destilleert de uitkomst tot een kennissectie, zodat de volgende run slimmer start.

## Installeer een werkstroom vanuit een module

Modules leveren voorgebouwde werkstromen mee (bijvoorbeeld btw-aangifte voorbereiden op Boekhouding). Installeer er een vanaf de modulepagina onder **Werkstroom-sjablonen**; de kopie is van jou en mag je bewerken. Voor elke run controleert Bokito opnieuw of de module is geïnstalleerd, de verbinding werkt en de agents bestaan — een run met een kapotte vereiste pauzeert met een beslissing in plaats van stil te falen.

## Wat nu

Leid terugkerend queue-werk via werkstromen op [Projecten](/docs/ai/projects). Accepteer chat-intake op de Over-kaart — zie [Signalen](/docs/ai/cases). Plan een werkstroom met een trigger op de [Agenda](/docs/ai/agenda). Sjablonen komen uit [Integraties](/docs/integrations/integrations).
