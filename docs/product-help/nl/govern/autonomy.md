---
title: Autonomie instellen
intro: Eén dial voor de hele werkruimte bepaalt hoe ver agents zelf mogen gaan. Kanalen, agents en werken blijven op of onder dat niveau.
description: Zet de ene Autonomie-dial op Govern (Handmatig, Geassisteerd, Autonoom), zie wat eronder mag staan en stel toolrechten apart in.
keywords: autonomie, dial, plafond, houding, handmatig, geassisteerd, autonoom, altijd controle, toolrechten, apply-modi, auto-review, prompt-injectie, verborgen instructies
sort: 20
related: govern,agents,inbox-ai,flows
---

# Autonomie instellen

Autonomie is één dial op [Govern](/docs/govern/govern): **Handmatig**, **Geassisteerd** of **Autonoom**. Elk kanaal, gesprek, elke agent en werk blijft op of onder dat niveau, dus de dial is het meeste wat een deel van de werkruimte zelf mag doen.

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
3. Elk werk heeft een eigen **Autonomie** op de werkpagina. Strenger dan de dial geldt meteen; losser wacht hier op akkoord. Een werk op **Geassisteerd** houdt elk antwoord op zijn tickets een concept. Zie [Werken](/docs/ai/flows).
4. **Privacy** die AI weghoudt van berichtinhoud zet alles op Handmatig, en een geactiveerde noodrem houdt een kanaal op Geassisteerd tot iemand het hervat.

Ga met de muis over de modus in een gesprekskop om te zien welke van deze besliste.

## Een voorstel uit de scorekaart accepteren

Bokito stelt een andere stand voor een werk voor als de uitkomsten dat laten zien.

1. Elk werklabel heeft een scorekaart: hoeveel tickets sloten, hoeveel zonder mens liepen, en hoeveel gecorrigeerd werden.
2. Heeft een werk op Geassisteerd in 30 dagen minstens 20 schone uitkomsten en minder dan een op de tien gecorrigeerd, dan stelt de afdelingsleider **Autonoom** voor in het afdelingsgesprek. Wordt een autonome werk vaak gecorrigeerd, dan stelt de leider **Geassisteerd** voor.
3. Accepteer of wijs het voorstel af in het gesprek of onder **Govern**. Een werk krijgt hoogstens een voorstel per richting per 30 dagen.
4. Geaccepteerde voorstellen staan op [Vandaag](/docs/getting-started/cockpit) onder **Wat is verbeterd**, met het aandeel autonoom ervoor en nu.

## Toolrechten instellen

Toolrechten staan los van de dial: ze zeggen wat tools mogen wijzigen zonder op jou te wachten, niet hoe ver agents klanten antwoorden.

1. Open op dezelfde pagina **Standaardrechten voor tools**.
2. Kies een preset voor werkruimte- en structuurtools, of zet elke categorie op **Weigeren**, **Eerst vragen** of **Toestaan**.
3. **Eerst vragen** maakt een [beslissingskaart](/docs/ai/decisions) in het gesprek. Berichten op **Eerst vragen** of **Weigeren** houdt ook klantantwoorden tegen die zelf zouden gaan; geen preset laat een gesprek verder gaan dan de dial.

## Laat auto-review eerst kijken

Auto-review is een tweede AI-controle op een actie die anders op jouw akkoord zou wachten.

1. Zoek op dezelfde pagina de kaart **Auto-review**.
2. Kies **Uit** (elke afgeschermde actie vraagt een mens), **Meekijken** (elke afgeschermde actie vraagt nog steeds; de kaart toont wat auto-review zou hebben gedaan) of **Afdwingen**.
3. Bij **Afdwingen** houdt auto-review acties tegen die het fout vindt en voert het routinewerk uit als het minstens 80% zeker is. Ingrijpende acties, zoals versturen naar een klant, vragen altijd nog. Dat geldt ook voor elke beurt die een bericht met mogelijk verborgen instructies las.
4. Schrijf onder **Beoordelingsinstructies** waar de beoordelaar op moet letten en kies **Instructies opslaan**.
5. De kaart toont hoe vaak mensen het in de laatste 30 dagen eens waren met auto-review. Begin op **Meekijken** en schakel naar **Afdwingen** als dat getal hoog is.

## Verborgen instructies in berichten

Klantberichten, webpagina's en toolresultaten kunnen tekst bevatten die de AI wil sturen, zoals "negeer je vorige instructies".

1. Agents behandelen die inhoud altijd als gegevens, nooit als opdracht.
2. Een bericht dat leest als een opdracht aan de AI krijgt in het gesprek de badge **Mogelijk verborgen instructies**.
3. Zolang een agent met zulke inhoud werkt, vraagt elke afgeschermde actie eerst een mens, wat de dial en auto-review ook zeggen.

## Begin voorzichtig

1. Zet de dial eerst op **Geassisteerd** terwijl je leert hoe de werkruimte zich gedraagt.
2. Kijk welke concepten ongewijzigd de deur uit gaan. Bokito stelt Autonoom voor zodra minstens 80% van 50 of meer concepten ongewijzigd verstuurd is.
3. Zet werken die altijd gecontroleerd moeten worden op de werkpagina op **Geassisteerd** voordat je de dial verhoogt.

Websitebezoekers wijzigen de werkruimte nooit zelf, wat de dial ook zegt.

## Wat nu

Zet waarborgen en overdracht onder [Autonomie](/docs/inbox/inbox-ai). Vergrendel tools op [Govern](/docs/govern/govern).
