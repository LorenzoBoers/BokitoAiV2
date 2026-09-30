---
title: Kennis in V2
intro: Documenten, vaardigheden en geheugen die agents lezen; geïndexeerd op het moment dat je opslaat.
description: Voeg V2-kennisdocumenten toe in Markdown, kies een soort zoals vaardigheid of snippet, zoek wat agents kunnen zien en laat agents documenten zelf onderhouden binnen het beleid.
keywords: v2, kennis, documenten, vaardigheid, persona, geheugen, snippet, zoeken, markdown, rag
sort: 50
related: v2-work,v2-communication,v2-developers
---

# Kennis in V2

**Kennis** is wat agents lezen voordat ze antwoorden: beleid, prijzen, procedures, tone of voice. Documenten zijn Markdown, worden voor agents geïndexeerd zodra ze zijn opgeslagen en zijn ook als resources beschikbaar voor MCP-clients.

## Een document toevoegen

1. Open **Kennis** en druk op **Nieuw document**.
2. Vul **Titel** in. **Pad** is optioneel en wordt standaard een slug van de titel.
3. Kies een **Soort**: **Document** voor feiten en procedures, **Vaardigheid** voor hoe een agent een taak moet doen, **Persona** voor tone of voice, **Snippet** voor herbruikbare tekst, **Geheugen** voor wat agents hebben geleerd.
4. Schrijf de **Inhoud** in Markdown en sla op.
5. Het document is **Gepubliceerd** en geïndexeerd. Agents gebruiken het in het volgende antwoord.

## Vinden wat agents kunnen zien

1. Typ in **Zoek in kennis**.
2. Filter op soort met **Alles** of een van de soorten.
3. Open een treffer om het document te lezen precies zoals een agent het leest.
4. Documenten met het label **Onderhouden door agents** zijn geschreven of bijgewerkt door een agent via de tool `write_doc` binnen het beleid; bewerk ze als elk ander document.

## Documenten uit modules

Een module installeren voegt zijn vaardigheidsdocumenten toe, bijvoorbeeld hoe je een factuurvraag beantwoordt met de gekoppelde boekhouding. Ze dragen de modulenaam als label en worden weer uitgeschakeld als de module wordt verwijderd.

## Wat nu

- Geef de standaardagent een persona en zie het verschil in de volgende thread: [/docs/v2/v2-work](/docs/v2/v2-work)
- Lees documenten vanuit een MCP-client als `bokito://docs/{path}`: [/docs/v2/v2-developers](/docs/v2/v2-developers)
