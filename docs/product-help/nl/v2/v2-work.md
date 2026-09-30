---
title: Werk in V2: agents, draaiboeken, triggers en runs
intro: Geef een agent een paspoort, beschrijf terugkerend werk als stappen, start het op een schema en lees het grootboek.
description: Configureer V2-agents met een autonomiegrens, schrijf draaiboeken als geordende stappen, start ze handmatig, via een cron- of webhooktrigger, en lees elke run met zijn kosten in het grootboek.
keywords: v2, werk, agents, paspoort, draaiboek, stappen, trigger, cron, webhook, runs, grootboek
sort: 40
related: v2-communication,v2-govern,v2-knowledge
---

# Werk in V2

**Werk** bevat de vier dingen die agents productief maken: **Agents**, **Draaiboeken**, **Triggers** en **Runs**. Draaiboeken draaien in een thread onder hetzelfde beleid als een antwoord, dus niets hier omzeilt Govern.

## Een agent aanmaken

Een agent is een paspoort: naam, rol, instructies, model en autonomiegrens.

1. Open **Werk**, **Agents** en druk op **Nieuwe agent**.
2. Vul **Naam**, **Rol** en **Instructies** in. Instructies zijn de vaste opdracht; procedures horen onder Kennis.
3. Laat **Model** leeg voor de workspace-standaard (EU managed model of je eigen sleutel), of kies een gekoppelde modelprovider.
4. Stel de **Autonomiegrens** in of houd **Volg workspace-posture**. De agent handelt nooit boven de grens.
5. Houd onder **Tools** de optie **Alle tools die het beleid toestaat** of beperk de lijst. Sla op; markeer een agent als **Standaard** om nieuwe interne threads te beheren.

## Een draaiboek schrijven

Een draaiboek is een lijst stappen die een agent op volgorde uitvoert.

1. Open **Werk**, **Draaiboeken** en druk op **Nieuw draaiboek**.
2. Geef het een **Naam** en een **Omschrijving**.
3. Voeg stappen toe met **Stap toevoegen**: een **Titel van de stap** en een **Instructie voor de agent**.
4. Kies de **Agent** of laat **Standaardagent** staan.
5. Sla op. Opslaan legt een wijziging vast onder **Govern**, **Wijzigingen** die je kunt terugdraaien.

## Een draaiboek nu of op schema starten

1. Open een draaiboek en druk op **Nu starten**. Verschijnt de melding **Deze run wacht op goedkeuring.**, keur dan de beslissing goed in de interne thread die is aangemaakt.
2. Voor terugkerend werk open je **Werk**, **Triggers**, **Nieuwe trigger**.
3. Kies **Soort**: **Schema** met een **Cron-expressie** (vijf velden, UTC; `0 9 * * 1-5` is werkdagen om 09:00), **Interval** met **Elke (minuten)**, of **Webhook**.
4. Kies een **Draaiboek**, of geef de standaardagent in plaats daarvan instructies.
5. Kopieer bij een webhook de URL en het secret dat een keer wordt getoond: stuur `POST /api/hooks/{id}` met header `X-Bokito-Secret`.

## Het grootboek lezen

Elk antwoord, draaiboek, trigger en elke toolaanroep is een run.

1. Open **Werk**, **Runs**.
2. Filter op **Status** (**In wachtrij**, **Bezig**, **Wacht**, **Klaar**, **Mislukt**, **Geannuleerd**) en lees **Actor**, **Vertrouwen** en **Kosten**.
3. Klik een run voor zijn **Events** en **Uitvoer**.
4. Runs gestart door de workbench (een codeer-agent die aan een repository werkt) staan hier ook, met een link naar de pull request als hij klaar is.

## Wat nu

- Laad procedures en tone of voice: [/docs/v2/v2-knowledge](/docs/v2/v2-knowledge)
- Geef een run door aan een codeer-workbench of een bedrijfssysteem: [/docs/v2/v2-connections](/docs/v2/v2-connections)
