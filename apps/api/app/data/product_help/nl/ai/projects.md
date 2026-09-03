---
title: Zo werken Projecten
intro: Een project houdt een doel vast — de implementatie-queue, de documentatie, wie het leidt, en hoeveel het mag uitgeven.
description: Werk de implementatie-queue af, houd slimme documentatie met sectiestatussen bij, koppel resources zoals een repo of drive, en laat agents queue-items voorstellen vanuit gesprekken.
keywords: projecten, queue, documentatie, secties, resources, repository, budget, orkestratie
sort: 40
related: agenda,knowledge,communication
---

# Zo werken Projecten

Een project is werk over dagen. Open **Projecten** wanneer een doel een thuis moet hebben in plaats van alleen in chat te leven. Een projectdetail heeft drie tabbladen: **Queue** (wat er moet gebeuren), **Documentatie** (wat waar is) en **Instellingen** (wie het uitvoert en waar het op werkt).

## Maak of open een project

![Projectenlijst](/api/docs/assets/projects/project.png)
*Elke kaart toont de projectagent, open queue-items en het budget.*

1. Open **Projecten**. Kies **Nieuw project** (of zoek **Nieuw project** in het commandopalet) en geef het doel een naam, daarna Enter. De URL-slug wordt automatisch gemaakt; open **Geavanceerd: URL-slug** alleen als je die wilt wijzigen.
2. Lees de kaart: projectagent, open queue-items, documentatiegezondheid, repo-status, resterend budget. Zoek op naam of agent als de lijst groeit. Als niets past, toont **Zoekopdracht wissen** alle projecten weer.
3. Open die. Je landt op het tabblad **Queue**. Het tabblad **Instellingen** bevat de kaart **Wie dit uitvoert**; gebruik **Lead wijzigen** om een andere agent te kiezen of er een te maken. Leden kunnen een project lezen; ze kunnen het niet verwijderen of de naam wijzigen.

## Werk de implementatie-queue af

1. Kies op het tabblad **Queue** voor **Aan queue toevoegen**. Geef het verzoek een titel, kies een soort (**Feature**, **Bug**, **Taak**, **Idee**, **Risico**) en een prioriteit, en kies **Toevoegen**.
2. Items zijn gegroepeerd op status: **Voorgesteld**, **Geaccepteerd**, **In analyse**, **Gepland**, **In uitvoering**, **In verificatie**, **Klaar**, **Afgewezen**. Open een item om de context, impactanalyse en gekoppelde kennisdocumenten te lezen.
3. Kies **Accepteren** op een voorgesteld item. De projectagent analyseert het tegen de documentatie, koppelt de documenten die het raakt en schrijft een impactsamenvatting. Gebruik **Analyseer** om dat opnieuw te draaien. Op een open item kun je ook **Document koppelen** kiezen om een project- of organisatiekennispagina te hangen.
4. Als het werk klaar is, kies je **Klaar voor verificatie** en daarna **Verifieer**. De agent toetst de documentatie aan de realiteit voordat het item naar **Klaar** gaat.

Items die uit een gesprek zijn ontstaan tonen **Brongesprek openen**, dat je terugbrengt naar het exacte gesprek in [Communicatie](/docs/inbox/communication).

## Laat gesprekken de queue voeden

1. Koppel een gesprek aan een project in het detailpaneel van het gesprek (**Project**).
2. Als iemand een bug beschrijft of iets nieuws vraagt, stelt de agent een queue-item voor. Er verschijnt een **Queue-voorstel**-kaart in het gesprek.
3. Kies **Aan queue toevoegen** om te accepteren, of **Afwijzen**. Kies **Altijd toestaan** als de agent items mag toevoegen zonder te vragen.
4. Zet **Autonome modus** aan op het tabblad **Instellingen** van het project om de acceptatiestap over te slaan: gespreksitems worden automatisch geaccepteerd en de analyse start direct.

## Houd projectdocumentatie bij

1. Open het tabblad **Documentatie** (een contextuele weergave van dezelfde docs als Kennis, gefilterd op dit project). Kies **Nieuw document**, geef het een naam en schrijf in **Schrijven** of **Markdown**. Inhoud wordt altijd als markdown opgeslagen.
2. Actieve gekoppelde queue-aanvragen tonen chips op het document. De status blijft op het queue-item.
3. Sectiestatussen onder elke `##`-kop blijven beschikbaar wanneer je **Secties** uitklapt; ze zijn secundair ten opzichte van documentkoppelingen.
4. Kies **Openen in Kennishub** om hetzelfde document onder Kennis → Projecten te bewerken.

## Koppel resources

1. Open het tabblad **Instellingen**. De repositorykaart koppelt een GitHub-repo zoals voorheen; de status gaat van **Repo indexeren** naar **Repo klaar**.
2. Kies onder **Resources** voor **Resource koppelen** om andere omgevingen aan te haken waar het project op werkt: een drive-map, een Notion-pagina, een spreadsheet, een codeertool of een website.
3. Kies een type, voeg een label en een referentie toe (URL of ID), en kies **Koppelen**. Resources zijn nu gekoppeld op referentie; connectors die synchroniseren en handelen haken hier later op aan.

## Beperk uitgaven

1. Open het tabblad **Instellingen** van het project.
2. Zet dag- en uurbudgetten voor tokens zodat één doel niet het hele workspaceplafond opmaakt.
3. Als een project het plafond raakt, toont de kaart **Tokenbudget bereikt**. Workspaceplafonds blijven op Cockpit **Verbruik**.

## Wat nu

Hang een planning op de [Agenda](/docs/ai/agenda). Bekijk dezelfde projectdocs onder [Kennis](/docs/ai/knowledge) door op die projectnaam te klikken; workspacebrede kennis blijft op de workspace-chip.
