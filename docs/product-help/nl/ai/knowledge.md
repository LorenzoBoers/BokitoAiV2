---
title: Zo werkt Kennis
intro: Markdown die de workspace bezit over organisatie-, project- en agentscopes. Dit is de brief die agents meenemen.
description: Beheer Kennis als hub voor org-, project- en agentdocs, bewerk in Schrijven of Markdown, en publiceer klantartikelen.
keywords: kennis, docs, stem, geheugen, skills, helpcenter, onderbouwing, projectdocumentatie
sort: 30
related: agents,communication,projects,workstreams
---

# Zo werkt Kennis

Kennis is wat agents bij elke run lezen. Open **Kennis** om organisatie-, project- en agentdocumenten in één hub te beheren — niet om een privéwiki te schrijven.

## Kies een scope

![Kennis-pagina](/api/docs/assets/knowledge/add-doc.png)
*Elke chip is een echte entiteit, gelabeld Platform, Project of Agent.*

1. Open **Kennis**.
2. Klik op je **workspacenaam** (standaard, met label **Platform**), een **projectnaam** of een **agentnaam**. Een document in die scope landt op dezelfde `WorkspaceDoc`-tabel als Projectdocumentatie.

De zijbalk groepeert documenten naar de soorten die er echt zijn — bijvoorbeeld Stem, Geheugen, Skills, Docs, Check-ins of Dagnotities wanneer die bestaan. Lege soorten blijven weg. Geheugen, check-ins en dagnotities onderhoudt de AI: bewerk ze als een feit fout is; behandel ze niet als tweede wiki.

## Voeg of bewerk een document

1. Open **Kennis**. Een lege bibliotheek biedt **Eerste document maken** en een dropzone voor een PDF of Word-bestand. Gebruik **Zoek in kennis** (Enter of **Zoeken**) als de lijst lang is, of **Zoekopdracht wissen** om weer te bladeren.
2. Kies **Nieuw document**, typ een titel (het pad wordt automatisch gemaakt) en daarna **Toevoegen**. Of gebruik **Document uploaden (PDF, Word, tekst)**.
3. Kies **Bewerken**. De editor opent standaard in **Schrijven** (WYSIWYG); schakel naar **Markdown** voor de ruwe bron. Inhoud wordt altijd als markdown opgeslagen.
4. **Opslaan** of druk op Ctrl/Cmd+S. Weggaan met niet-opgeslagen wijzigingen vraagt om bevestiging. Klik het documentpad om het te kopiëren. **Publiceren** vraagt of het artikel op de openbare helpsite mag. **Document verwijderen** haalt een pagina weg die je niet meer wilt.

Actieve queue-aanvragen die aan een document hangen, tonen subtiele chips onder de titel. De status blijft op het queue-item, niet op het document.

## Werk per sectie

Een document is een pagina opgebouwd uit `##`-secties; elke sectie is de atomaire eenheid die agents lezen, doorzoeken en bewerken — één onderwerp, grofweg 150 tot 400 woorden.

1. Open een document en klap **Secties** uit. Elke sectie toont de kop, de inhoud en een statuschip: **Concept**, **Review** of **Definitief**.
2. Bewerk één sectie zonder de rest van de pagina te raken. Voeg een sectie toe voor een nieuw onderwerp in plaats van een bestaande te laten groeien.
3. Stel de status per sectie in. Een sectie die een agent tijdens een werkstroom-run schrijft, gaat naar **Review**; goedkeuring van de gate van de run promoveert haar naar **Definitief**. Zet zelf alleen **Definitief** wanneer je de inhoud hebt geverifieerd.

## Onderbouw een concept

1. Voeg de pagina's toe die je team al gebruikt: prijzen, beleid, productfeiten.
2. Open een gesprek in [Communicatie](/docs/inbox/communication).
3. Concepten worden beter zodra er een handvol documenten is. Inbox AI volgt nog steeds [Inbox AI](/docs/inbox/inbox-ai); Kennis onderbouwt alleen de tekst.

## Publiceer voor klanten

1. Open een document van het soort **Docs**.
2. Kies **Publiceren**. Bevestig de prompt voor de openbare helpsite.
3. Deel de help-URL met klanten. Haal publicatie weg wanneer het artikel van de openbare site af moet.

## Wat nu

Houd projectsgebonden docs op het tabblad Documentatie van [Projecten](/docs/ai/projects) — ze verschijnen in Kennis wanneer je op die projectnaam klikt. Laat agents Skills en Geheugen gebruiken zodat antwoorden onderbouwd blijven.
