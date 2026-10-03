---
title: Zo werken Projecten
intro: Een project houdt een doel vast — canvas, implementatie-queue, documentatie, wie het leidt, en hoeveel het mag uitgeven.
description: Werk het AI-onderhouden projectcanvas, de implementatie-queue, slimme documentatie en gekoppelde resources, en laat agents queue-items voorstellen vanuit gesprekken.
keywords: projecten, canvas, dashboard, widgets, queue, documentatie, secties, resources, repository, budget, orkestratie
sort: 40
related: agenda,knowledge,communication,workstreams
---

# Zo werken Projecten

Een project is werk over dagen. Open **Projecten** wanneer een doel een thuis moet hebben in plaats van alleen in chat te leven. Een projectdetail heeft vier tabbladen: **Canvas** (levend overzicht), **Queue** (wat er moet gebeuren), **Documentatie** (wat waar is) en **Instellingen** (wie het uitvoert en waar het op werkt).

## Maak of open een project

![Projectenlijst](/api/docs/assets/projects/project.png)
*Elke kaart toont de projectagent, open queue-items en het budget.*

1. Open **Projecten**. Kies **Nieuw project** (of zoek **Nieuw project** in het commandopalet) en geef het doel een naam, daarna Enter. De URL-slug wordt automatisch gemaakt; open **Geavanceerd: URL-slug** alleen als je die wilt wijzigen.
2. Lees de kaart: projectagent, open queue-items, documentatiegezondheid, repo-status, resterend budget. Zoek op naam of agent als de lijst groeit. Als niets past, toont **Zoekopdracht wissen** alle projecten weer.
3. Open die. Je landt op het tabblad **Canvas**. Het tabblad **Instellingen** bevat de kaart **Wie dit uitvoert**; gebruik **Projectagent wijzigen** om een andere agent te kiezen of er een te maken. Leden kunnen een project lezen; ze kunnen het niet verwijderen of de naam wijzigen.

## Houd een levend canvas bij

Het canvas is een flexibel bord met tegels (metrics, status, markdown, grafieken, tabellen, embeds en live queue/budget/resources). Agents onderhouden het via Govern; jij herschikt en voegt toe wat je wilt zien.

1. Open het tabblad **Canvas**. Het standaardbord toont al gezondheid, queue-puls, budget, resources en open queue-items.
2. Kies **Metric toevoegen** om zelf een getal te pinnen, of **Bord resetten** om de standaardindeling terug te zetten.
3. Vraag in [Communicatie](/docs/inbox/communication) een bedrijfsagent om het canvas bij te werken — bijvoorbeeld een status-tegel, een grafiek of een markdown-briefing. Wijzigingen gaan via [Govern](/docs/govern/govern) wanneer autonomie goedkeuring vraagt.
4. Live tegels vernieuwen vanuit queue, budget, resources en workbench-jobs; statische tegels houden de inhoud die de agent (of jij) het laatst schreef. Wanneer een codingtool een pull request voor dit project opent, verschijnt die onder **Resources** en op de tegel **Workbench-jobs**.

## Werk de implementatie-queue af

1. Kies op het tabblad **Queue** voor **Aan queue toevoegen**. Geef het verzoek een titel, kies een soort (**Verbetering**, **Probleem**, **Verzoek**, **Idee**, **Risico**) en een prioriteit, en kies **Toevoegen**.
2. Items zijn gegroepeerd op status: **Voorgesteld**, **Geaccepteerd**, **In analyse**, **Gepland**, **In uitvoering**, **In verificatie**, **Klaar**, **Afgewezen**. Open een item om de context, impactanalyse en gekoppelde kennisdocumenten te lezen.
3. Kies **Accepteren** op een voorgesteld item. De projectagent leidt het naar de best passende project-[werkstroom](/docs/ai/workstreams) en er start een run met het item als input. Elk project heeft standaard een werkstroom **Beoordeel en voer uit**, dus er is altijd een uitvoerbaar pad. De itemstatus volgt de run: een afgeronde run rondt het item af, een mislukte of geannuleerde run zet het terug naar **Gepland**. Op een open item kun je ook **Document koppelen** kiezen om een project- of organisatiekennispagina te hangen.
4. Als het werk klaar is, kies je **Klaar voor verificatie** en daarna **Verifieer**. De agent toetst de documentatie aan de realiteit voordat het item naar **Klaar** gaat.

Items die uit een gesprek zijn ontstaan tonen **Brongesprek openen**, dat je terugbrengt naar het exacte gesprek in [Communicatie](/docs/inbox/communication).

## Laat gesprekken de queue voeden

1. Koppel een gesprek aan een project in het detailpaneel van het gesprek (**Project**).
2. Als iemand een bug beschrijft of iets nieuws vraagt, stelt de agent een queue-item voor. Er verschijnt een **Queue-voorstel**-kaart in het gesprek.
3. Kies **Aan queue toevoegen** om te accepteren, of **Afwijzen**. Kies **Altijd toestaan** als de agent items mag toevoegen zonder te vragen. Hoeveel een agent zonder vragen mag doen, is één workspacebrede knop: zie [Autonomy](/docs/govern/autonomy).

## Houd projectdocumentatie bij

1. Open het tabblad **Documentatie** (een contextuele weergave van dezelfde docs als Kennis, gefilterd op dit project). Kies **Nieuw document**, geef het een naam en schrijf in **Schrijven** of **Markdown**. Inhoud wordt altijd als markdown opgeslagen.
2. Actieve gekoppelde queue-aanvragen tonen chips op het document. De status blijft op het queue-item.
3. Klap **Secties** uit om per `##`-sectie te werken, elk met een status: **Concept**, **Review** of **Definitief**. Een sectie die een agent tijdens een werkstroom-run schrijft, gaat naar **Review**; gate-goedkeuring promoveert haar naar **Definitief**.
4. Jij bewerkt direct; agents mogen projectdocumentatie alleen bewerken binnen een [werkstroom](/docs/ai/workstreams)-run, zodat achter elke agent-wijziging een werklog zit.
5. Kies **Openen in Kennishub** om hetzelfde document onder Kennis → Projecten te bewerken.

## Koppel resources

1. Open het tabblad **Instellingen**. De repositorykaart koppelt een GitHub-repo zoals voorheen; de status gaat van **Repo indexeren** naar **Repo klaar**.
2. Kies onder **Resources** voor **Resource koppelen** om andere omgevingen aan te haken waar het project op werkt: een drive-map, een Notion-pagina, een spreadsheet, een codeertool of een website.
3. Kies een type, voeg een label en een referentie toe (URL of ID), en kies **Koppelen**. Resources zijn nu gekoppeld op referentie; connectors die synchroniseren en handelen haken hier later op aan.

## Beperk uitgaven

1. Open het tabblad **Instellingen** van het project.
2. Zet dag- en uurbudgetten voor tokens zodat één doel niet het hele workspaceplafond opmaakt.
3. Als een project het plafond raakt, toont de kaart **Tokenbudget bereikt**. Workspaceplafonds blijven op Cockpit **Verbruik**.

## Wat nu

Definieer de terugkerende processen achter de queue onder [Werkstromen](/docs/ai/workstreams). Hang een planning op de [Agenda](/docs/ai/agenda). Bekijk dezelfde projectdocs onder [Kennis](/docs/ai/knowledge) door op die projectnaam te klikken; workspacebrede kennis blijft op de workspace-chip.
