---
title: Wat Bokito V2 is
intro: Een gespreksoppervlak voor het bedrijf, met agents die handelen binnen het beleid dat jij instelt.
description: Bokito V2 op v2.bokito.ai in een pagina. De vijf objecten, hoe agents en mensen een lijst delen, waar beslissingen landen en hoe je je eerste workspace aanmaakt.
keywords: v2, bokito v2, overzicht, gesprek, agent, beslissing, draaiboek, contact, workspace
sort: 10
related: v2-communication,v2-govern,v2-work,v2-connections,v2-developers
---

# Wat Bokito V2 is

Bokito V2 draait op `https://v2.bokito.ai` naast het huidige platform. Klanten, partners en collega's schrijven waar ze al schrijven; het bedrijf antwoordt in een lijst waarin mensen en AI-agents naast elkaar werken, en elke actie van een agent is zichtbaar, bestuurd en terug te draaien vanuit diezelfde thread.

## Vijf objecten, niets meer

V2 is gebouwd op vijf begrippen. Elk scherm toont er een; meer bestaat er niet.

| Object | Wat het is | Waar je het ziet |
| --- | --- | --- |
| Gesprek | Een thread met een klant, partner, collega of agent | Communicatie |
| Contact en Organisatie | Wie aan de andere kant zit, met het geheugen dat agents over hen bijhouden | Contactpaneel in een thread |
| Agent | Een paspoort: naam, rol, instructies, model en autonomiegrens | Werk, Agents |
| Draaiboek | Stappen die een agent op volgorde uitvoert, in een thread, onder hetzelfde beleid als een antwoord | Werk, Draaiboeken |
| Beslissing | Een vraag die een agent stelt voordat hij handelt; inline beantwoord, vastgelegd in Govern | Thread, Overview, Govern |

Een Signaal is een getypeerde herkenning op een gesprek (een factuurvraag, een klacht, een lead). Signaaltypes komen mee met modules en voegen nooit een scherm toe.

## Hoe een bericht reist

1. Een bericht komt binnen via een gekoppeld kanaal: e-mail, WhatsApp, websitechat of een interne thread.
2. De agent die het kanaal beheert leest de thread, het contactgeheugen en je documenten onder Kennis.
3. Hij handelt binnen het workspacebeleid. Lezen en concepten maken is vrij; naar een klant sturen of een extern systeem aanroepen wordt uitgevoerd, gevraagd of geweigerd, afhankelijk van je **Autonomie-posture**.
4. Als hij vraagt, verschijnt een Beslissing in de thread en op Overview. Daar keur je goed of af.
5. Elke toolaanroep landt in het run-grootboek met zijn kosten. 's Nachts telt V2 welke gesprekken agents hebben opgelost zonder dat een mens hoefde in te grijpen.

## Waar V2 verschilt van V1

- Een lijst in plaats van een inbox, een casewachtrij en een takenbord. Filters doen de rest.
- Autonomie is een draaiknop per workspace, met toestemmingen per toolcategorie en een korte lijst tools die altijd vragen.
- Tools zijn de enige manier waarop agents iets veranderen. Dezelfde tools zitten achter het commandopalet, de REST-API en het MCP-endpoint, zodat het beleid een keer wordt toegepast.
- Het EU managed model is de standaard. Breng je eigen sleutel mee als je wilt; verbruik en het EU-aandeel van modelaanroepen zie je onder Govern.
- Modules voegen signaaltypes, draaiboeken en tools toe voor een werkgebied. De eerste koppelt Moneybird voor boekhouding.

## Een workspace aanmaken

V2 heeft een eigen database en eigen accounts. Er wordt niets van het huidige platform verplaatst.

1. Open `https://v2.bokito.ai` en kies **Workspace aanmaken**.
2. Vul **Je naam**, **E-mail**, **Wachtwoord** en **Naam van de workspace** in.
3. Kies de standaard **Taal**; agents antwoorden en vermelden AI-gebruik in die taal.
4. Je landt in **Communicatie**. Druk op **Nieuw** om een interne thread met de standaardagent te starten en vraag hem wat hij kan.
5. Nodig collega's uit onder **Instellingen**, **Leden**, **Nodig een collega uit**.

## Wat nu

- Leer de lijst en de thread kennen: [/docs/v2/v2-communication](/docs/v2/v2-communication)
- Stel de autonomie-posture in voordat je een klantkanaal koppelt: [/docs/v2/v2-govern](/docs/v2/v2-govern)
- Koppel e-mail, WhatsApp of de websitechat: [/docs/v2/v2-connections](/docs/v2/v2-connections)
