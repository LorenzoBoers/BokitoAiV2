---
title: Govern in V2
intro: Een autonomieknop, toestemmingen per categorie, wijzigingen met een weg terug en een audit die alleen aangroeit.
description: Stel de V2 autonomie-posture in, overschrijf toestemmingen per toolcategorie, houd ingrijpende tools op vragen, bekijk en draai wijzigingen terug, lees de audit en het EU-aandeel van modelverbruik.
keywords: v2, govern, autonomie, posture, toestemmingen, ingrijpend, beslissing, wijzigingen, terugdraaien, audit, verbruik, eu, disclosure
sort: 30
related: v2-communication,v2-work,v2-developers
---

# Govern in V2

**Govern** is waar je bepaalt hoeveel agents mogen doen zonder te vragen en waar elke configuratiewijziging wordt vastgelegd met een weg terug. Vraag inline, leg vast in Govern: beslissingen worden in threads beantwoord, de regels die ze veroorzaakten staan hier.

## De autonomie-posture instellen

Eén draaiknop voor de workspace. Agents en signaaltypen kunnen eronder zitten, nooit erboven.

1. Open **Govern**, **Beleid**.
2. Kies onder **Autonomie-posture** voor **Handmatig** (agents maken concepten, een mens verstuurt en past alles toe), **Geassisteerd** (agents lezen en schrijven binnen Bokito; communiceren en externe acties vragen eerst) of **Autonoom** (agents handelen binnen de toestemmingen; ingrijpende tools vragen altijd).
3. Sla op. De posture verhogen is zelf een bestuurde wijziging: de melding **Posture wijzigen vraagt goedkeuring. Er staat een beslissing in Govern.** verschijnt en een beheerder keurt goed.
4. Controleer **Overview**, **Posture** voor het actieve niveau.

## Een toestemming per categorie overschrijven

Elke tool hoort bij een categorie. De posture zet een standaardoordeel per categorie; jij kunt het overschrijven.

1. Zoek onder **Toestemmingen per categorie** de rijen **Lezen**, **Schrijven**, **Communiceren**, **Extern** en **Destructief**.
2. Laat **Posture** staan om te erven, of kies **Toestaan**, **Vragen** of **Weigeren**.
3. Bekijk onder **Altijd vragen** de tools die ongeacht de posture een beslissing vragen, zoals een factuur versturen vanuit een gekoppelde boekhouding.
4. Gebruik **Uitzonderingen per tool** voor een enkele tool die van zijn categorie moet afwijken.
5. Operators wordt nooit gevraagd: voer je zelf een tool uit, dan draait hij of wordt hij geweigerd. API-clients en agents krijgen de beslissing.

## De AI-disclosure-regel instellen

Kanalen met disclosure aan voegen een zin toe aan AI-geschreven antwoorden (EU AI Act, art. 50).

1. Lees onder **AI-disclosure (art. 50)** de standaard: *Dit antwoord is geschreven met hulp van een AI-assistent.*
2. Vervang hem door je eigen tekst of laat het veld leeg om de standaard te houden.
3. Schakel disclosure per kanaal onder **Verbindingen**, **AI-disclosure op uitgaand**.

## Een wijziging bekijken en terugdraaien

Draaiboekbewerkingen, beleidswijzigingen en agentupdates worden vastgelegd als wijzigingen die je ongedaan kunt maken.

1. Open **Govern**, **Wijzigingen**.
2. Elke rij toont wie hem voorstelde, de status (**Concept**, **Toegepast**, **Afgewezen**, **Teruggedraaid**) en **Voor en na**.
3. Druk op **Toepassen** bij een concept, **Afwijzen** om het te laten vallen, of **Terugdraaien** bij een toegepaste wijziging.
4. Het terugdraaien is zelf een nieuwe wijziging, dus het spoor blijft compleet.

## De audit en het verbruik lezen

1. Open **Govern**, **Audit** voor het alleen-toevoegen logboek van toolaanroepen en instellingswijzigingen. Gebruik **Filter op actie** om te verfijnen.
2. Open **Govern**, **Verbruik** voor **Totaal, 30 dagen**, **EU-aandeel** van model- en embedding-aanroepen, **Kosten per dag** en een **Uitsplitsing** per soort, provider en regio.
3. Open **Overview** voor **Opgelost door agents** en **Tijd bespaard**: gesprekken die een agent sloot zonder overdracht en die 72 uur gesloten bleven, elke nacht berekend.

## Wat nu

- Maak tokens voor scripts en MCP-clients onder **Govern**, **API-tokens**: [/docs/v2/v2-developers](/docs/v2/v2-developers)
- Geef een agent een eigen grens onder de workspace-posture: [/docs/v2/v2-work](/docs/v2/v2-work)
