---
title: Autonomie instellen
intro: Eén dial voor de hele werkruimte bepaalt hoe ver agents zelf mogen gaan. Kanalen, agents en flows blijven op of onder dat niveau.
description: Zet de ene Autonomie-dial op Govern (Handmatig, Geassisteerd, Autonoom), zie wat eronder mag staan en stel toolrechten apart in.
keywords: autonomie, dial, plafond, houding, handmatig, geassisteerd, autonoom, altijd controle, toolrechten, apply-modi
sort: 20
related: govern,agents,inbox-ai,flows
---

# Autonomie instellen

Autonomie is één dial op [Govern](/docs/govern/govern): **Handmatig**, **Geassisteerd** of **Autonoom**. Elk kanaal, gesprek, elke agent en flow blijft op of onder dat niveau, dus de dial is het meeste wat een deel van de werkruimte zelf mag doen.

## De dial zetten

![De Autonomie-dial op Govern](/api/docs/assets/autonomy/dial.png)
*Drie standen. De huidige draagt een badge.*

1. Open **Instellingen**, daarna **Govern**, daarna **Beleid**. De eerste kaart is **Autonomie**.
2. Kies **Handmatig** (agents lezen en bereiden voor, een mens doet de rest), **Geassisteerd** (agents stellen antwoorden voor en stellen acties voor, een mens verstuurt) of **Autonoom** (agents antwoorden en handelen zelf binnen de toolrechten).
3. Bij **Autonoom** vraagt Bokito eerst **Autonoom aanzetten?** Alleen een eigenaar of beheerder kan de dial wijzigen; anderen zien **Alleen een eigenaar of beheerder kan de dial wijzigen.**
4. De dial slaat op zodra je kiest.

## Wat onder de dial mag staan

1. Een kanaal of één open gesprek kan lager staan. Die staan onder **Per kanaal** op dezelfde pagina; kies **Weer de standaard volgen** om er een weg te halen. Zie [Autonomie](/docs/inbox/inbox-ai).
2. Elke agent heeft een eigen niveau (zie [Agents](/docs/ai/agents)). Een gesprek dat die agent afhandelt gaat nooit hoger.
3. Een flow met **Altijd controle** houdt elk antwoord op zijn tickets op Geassisteerd. Zie [Flows](/docs/ai/flows).
4. **Privacy** die AI weghoudt van berichtinhoud zet alles op Handmatig, en een geactiveerde noodrem houdt een kanaal op Geassisteerd tot iemand het hervat.

Ga met de muis over de modus in een gesprekskop om te zien welke van deze besliste.

## Toolrechten instellen

Toolrechten staan los van de dial: ze zeggen wat tools mogen wijzigen zonder op jou te wachten, niet hoe ver agents klanten antwoorden.

1. Open op dezelfde pagina **Standaardrechten voor tools**.
2. Kies een preset voor werkruimte- en structuurtools, of zet elke categorie op **Weigeren**, **Eerst vragen** of **Toestaan**.
3. **Eerst vragen** maakt een [beslissingskaart](/docs/ai/decisions) in het gesprek. Berichten op **Eerst vragen** of **Weigeren** houdt ook klantantwoorden tegen die zelf zouden gaan; geen preset laat een gesprek verder gaan dan de dial.

## Begin voorzichtig

1. Zet de dial eerst op **Geassisteerd** terwijl je leert hoe de werkruimte zich gedraagt.
2. Kijk welke concepten ongewijzigd de deur uit gaan. Bokito stelt Autonoom voor zodra minstens 80% van 50 of meer concepten ongewijzigd verstuurd is.
3. Zet flows die altijd gecontroleerd moeten worden op **Altijd controle** voordat je de dial verhoogt.

Websitebezoekers wijzigen de werkruimte nooit zelf, wat de dial ook zegt.

## Wat nu

Zet waarborgen en overdracht onder [Autonomie](/docs/inbox/inbox-ai). Vergrendel tools op [Govern](/docs/govern/govern).
