---
title: Privacy en beveiliging
intro: Bewaartermijnen, dataregio, verzoeken van betrokkenen en AI-datagebruik staan onder Data en privacy.
description: Stel één bewaartermijn voor de workspace in, kies waar AI data mag verwerken, bepaal of AI berichtteksten mag gebruiken, en exporteer of wis persoonsgegevens voor een e-mailadres.
keywords: privacy, beveiliging, bewaartermijn, AVG, GDPR, inzage, export, wissen, dataregio, EU, subverwerkers
sort: 40
related: govern,autonomy,communication,models
---

# Privacy en beveiliging

Owners en admins beheren bewaartermijnen, dataregio en verzoeken van betrokkenen via **Instellingen**, daarna **Data en privacy**. Juridische concepten staan in de repo onder `docs/legal` en moeten door een jurist of FG worden gereviewed vóór productie met klantdata.

## Data en privacy openen

1. Open **Instellingen**.
2. Kies onder **Govern** voor **Data en privacy**.
3. Onder **Juridische documenten** open je **Verwerkersovereenkomst**, **Privacyverklaring**, **Subverwerkers** of **Beveiligingsoverzicht** wanneer je de operatorconcepten nodig hebt. Gebruik daarna bewaartermijn, gegevensverwerking en verzoeken van betrokkenen hieronder.

## Bewaartermijn en AI-tekstgebruik instellen

1. Open **Bewaartermijn en AI**. Stel **Bewaartermijn workspace (dagen)** in (standaard 365). Eén termijn geldt voor berichten, agenda-items en auditgegevens in deze workspace.
2. De bewaartaak wist oudere berichten, agenda-items en auditrijen. Platformwijzigingen en beslissingen blijven. De gespreksschil kan blijven.
3. Zet **AI mag berichtteksten gebruiken** aan of uit. Uit = AI-afhandeling toont Handmatig op elk gesprek en er worden geen concepten geschreven; metadata-only stromen kunnen doorgaan.
4. Verlaat het veld om op te slaan. Wijzigingen gelden alleen voor deze workspace.

## Niet-EU modellen toestaan of blokkeren

![Gegevensverwerking](/api/docs/assets/privacy-security/data-region.png)
*Bokito AI blijft op EU-gehoste modellen tot jij een doorgifte toestaat.*

1. Op **Data en privacy** open je **Gegevensverwerking**. Bokito AI draait standaard op EU-gehoste infrastructuur.
2. Zet **Niet-EU platformmodellen toestaan** aan of uit. De schakelaar staat standaard uit. Zolang hij uit staat, draait een agent die naar een niet-EU platformmodel wijst in plaats daarvan op Bokito AI.
3. Zet de schakelaar alleen aan als je verwerkersovereenkomst die doorgifte dekt. Eigenaren en beheerders kunnen hem wijzigen; je eigen providersleutels worden nooit omgeleid.
4. Als actieve agents al naar niet-EU modellen wijzen, toont de pagina die slugs. Kennis-embeddings draaien nog op een US-gehost model tot er een EU-alternatief is.

## Gegevens van een betrokkene exporteren of wissen

1. Vul onder **Verzoeken van betrokkenen** het **E-mail van betrokkene** in.
2. Kies **Persoonsgegevens exporteren** om een JSON-pakket voor dat adres in deze workspace te downloaden.
3. Of kies **Persoonsgegevens wissen** en bevestig het scrubben van contactvelden, berichtteksten en bijpassende agenda-deelnemers. Bijbehorende items in de Prullenbak worden ook gepurged. Dit kan niet ongedaan worden gemaakt.
4. Volledige workspace-wipe: eigenaren gebruiken **Instellingen → Algemeen → Workspace verwijderen**. Platform support kan een tenant ook verwijderen via **Ops** (type de slug ter bevestiging). Account verwijderen is iets anders dan subject-erase.

## Herstellen of definitief verwijderen uit de Prullenbak

Operator-verwijderingen (gesprekken, projecten, canvassen, kennis, contacten, draaiboeken, triggers, teams, regels) gaan naar de **Prullenbak**, niet meteen weg. Agent deactiveren en mailbox archiveren blijven buiten de Prullenbak.

1. Open **Instellingen**. Onderaan de zijbalk, boven **Support**, kies **Prullenbak**.
2. Filter op type of zoek op titel. Elke rij toont wie het verwijderde en **Weg op** de datum waarop het verdwijnt.
3. Kies **Herstellen** om het item en de kinderen terug te zetten. Als de slug al bestaat, voegt Bokito `-restored` toe. Elke rij toont wie het verwijderde en wanneer het verdwijnt.
4. Kies **Definitief verwijderen** voor één item, of **Prullenbak legen** (typ `leeg`) om alles te purgen. De voettekst noemt hoe veel dagen items blijven (platformstandaard 60).
5. Nieuwe mail op een gesprek in de Prullenbak herstelt dat gesprek in plaats van een duplicaat te openen.
