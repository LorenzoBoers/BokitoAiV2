---
title: Privacy en beveiliging
intro: Bewaartermijnen, verzoeken van betrokkenen en AI-datagebruik staan onder Vertrouwen en privacy.
description: Stel één bewaartermijn voor de workspace in, bepaal of AI berichtteksten mag gebruiken, en exporteer of wis persoonsgegevens voor een e-mailadres.
keywords: privacy, beveiliging, bewaartermijn, AVG, GDPR, inzage, export, wissen, trust, subverwerkers
sort: 40
related: govern,autonomy,communication
---

# Privacy en beveiliging

Owners en admins beheren bewaartermijnen en verzoeken van betrokkenen via **Instellingen**, daarna **Vertrouwen en privacy**. Juridische concepten staan in de repo onder `docs/legal` en moeten door een jurist of FG worden gereviewed vóór productie met klantdata.

## Trust en privacy openen

1. Open **Instellingen**.
2. Kies onder **Govern** voor **Vertrouwen en privacy**.
3. Onder **Juridische documenten** open je **Verwerkersovereenkomst**, **Privacyverklaring**, **Subverwerkers** of **Beveiligingsoverzicht** wanneer je de operatorconcepten nodig hebt. Gebruik daarna bewaartermijn en verzoeken van betrokkenen hieronder.

## Bewaartermijn en AI-tekstgebruik instellen

1. Open **Bewaartermijn en AI**. Stel **Bewaartermijn workspace (dagen)** in (standaard 365). Eén termijn geldt voor berichten, agenda-items en auditgegevens in deze workspace.
2. Oudere gegevens die onder het beleid vallen worden door de bewaartaak gepurged; de thread-schil kan blijven.
3. Zet **AI mag berichtteksten gebruiken** aan of uit. Uit = inbox-AI die volledige tekst nodig heeft blijft uit; metadata-only stromen kunnen doorgaan.
4. Verlaat het veld om op te slaan. Wijzigingen gelden alleen voor deze workspace.
5. Waar AI die teksten verwerkt bepaal je onder [Modellen](/docs/govern/models): Bokito AI draait standaard op EU-gehoste modellen en US-gehoste platformmodellen blijven uit totdat jij ze toestaat.

## Gegevens van een betrokkene exporteren of wissen

1. Vul onder **Verzoeken van betrokkenen** het **E-mail van betrokkene** in.
2. Kies **Persoonsgegevens exporteren** om een JSON-pakket voor dat adres in deze workspace te downloaden.
3. Of kies **Persoonsgegevens wissen** en bevestig het scrubben van contactvelden, berichtteksten en bijpassende agenda-deelnemers. Dit kan niet ongedaan worden gemaakt.
4. Volledige workspace-wipe: eigenaren gebruiken **Instellingen → Algemeen → Workspace verwijderen**. Platform support kan een tenant ook verwijderen via **Ops** (type de slug ter bevestiging). Account verwijderen is iets anders dan subject-erase.
