# Taak: Bokito vereenvoudigen tot één product — plan maken, nog niet bouwen

## Context
Lees eerst `docs/plans/een-product.md`. Dat is een productreview van Bokito (dev 1.2.18, commit baabd1d), gebaseerd op de featurepagina, een rondgang door de app en een eerste lezing van deze repo. De conclusie: het datamodel is grotendeels al één product. De versnippering zit in de naamgeving, de rail, dubbele ingangen en de manier waarop autonomie wordt getoond. Daardoor is Bokito voor een niet-technische gebruiker moeilijk te begrijpen.

Onze eigen noordster (`.cursor/rules/bokito-core-intent.mdc`) schrijft dit al voor: één object per idee, mappen in plaats van projecten, geen "actietag", autonomie als één dial in Govern, en de oude surface verwijderen in dezelfde wijziging. Dit werk is dus het afdwingen van regels die we al hebben, geen nieuwe richting.

## Wat ik van je wil
Maak een uitvoerbaar plan voor de opruimronde "Eén product". Schrijf nog geen code. Behandel elke bewering in `docs/plans/een-product.md` als een hypothese en controleer die eerst in de code. Klopt iets niet, of is het groter of kleiner dan beschreven, zeg dat dan expliciet.

## Harde randvoorwaarden
- **Geen herbouw.** We werken op V1 (`apps/api`, `apps/dashboard`, `apps/mobile`). De V2-herbouw is op 1 oktober verwijderd (`BOKITO_KNOWLEDGE.md` §42). Stel geen parallelle stack, nieuwe app of grote rewrite voor.
- **De backend is de ruggengraat** (`.cursor/rules/backend-backbone.mdc`). Productregels en het berekenen van het effectieve niveau horen in de API, niet in de dashboard-bundle.
- **Elke fase is los te shippen** en laat de app werkend achter. Oude URL's krijgen een redirect, maar oude namen, componenten, i18n-sleutels en dode code verdwijnen in dezelfde wijziging.
- **Dit gaat vóór `docs/plans/shared-ui-library.md`.** Geef aan welke stappen moeten landen voordat die migratie begint.
- **Copy-regels:** één term per begrip, NL en EN, geen emoji, geen gemengde talen in de NL-UI.
- **Documentatie:** elke zichtbare wijziging werkt `docs/product-help/` bij (EN+NL, screenshots, `sync_product_help.py`). Interne feiten gaan naar `BOKITO_KNOWLEDGE.md`.

## Doelbeeld (toets dit, neem het niet blind over)
- **Vijf begrippen voor de gebruiker:** Gesprek, Map, Flow, Agent en Autonomie. Label, afdeling, kanaal en contact blijven bestaan als eigenschap of filter, niet als bestemming.
- **Een rail van 7 items:** Communicatie (met Vandaag als startweergave, dat was Overview), Agenda, Mappen, Flows, Agents (met Kennis), Workforce (met Grid) en Instellingen. Nieuw gesprek wordt een knop. De rail staat in `apps/dashboard/src/lib/navigation.ts`.
- **Autonomie als één dial in Govern**, met drie lagen: plafond per agent, standaard per kanaal en override per gesprek. Elk scherm toont het effectieve niveau uit `resolve_ai_handling()`. Govern toont niet langer de naam van de preset als plafond.

## Wat ik in het plan wil zien
1. **Verificatie.** Per bevinding uit het document: bevestigd, weerlegd of anders, met bestand en regel. Neem in elk geval mee:
   - de plafond-tegenstrijdigheid (`governance_ceiling()` tegenover de preset in Govern)
   - de Bokito-assistent als agent-rij (`acts_for_user`) in de tenant-lijsten
   - de dubbel opgeslagen fasen (`Workstream.stages_json` en `workstream_stages`)
   - dode of verborgen surfaces (`routers/custom_db.py`, `/ops`, `/learn`) en de 139 redirects in `App.tsx`
   - de verhouding tussen project en map in `locales/` en in de TSX-bestanden
2. **Woordenlijst.** Eén voorstel met per begrip:
   - de UI-term (NL en EN)
   - de code- en API-naam
   - de URL-slug

   Beslis per begrip of de interne naam (Signal, Workstream, Project, Department) blijft of meegaat, en waarom. Hernoem geen tabellen tenzij het iets oplevert.
3. **Fasering.** Gebruik de vijf fasen uit het document als startpunt. Kies je een andere indeling, onderbouw die dan. Per fase:
   - doel en wat de gebruiker merkt
   - concrete bestanden en modules die veranderen
   - schema- of Alembic-migraties, en de omgang met bestaande tenantdata
   - API-wijzigingen en de gevolgen voor mobiel, de widget en de MCP-plugin
   - wat verwijderd wordt
   - tests: unit en e2e (Playwright), en hoe we regressies op routes en redirects vangen
   - risico's en een ruwe omvang (S/M/L)
4. **"Waarom?"-weergave.** Een minimale versie die de bestaande payload van `resolve_ai_handling()` (`source`, `clamped_by`) toont, plus waarom een gesprek in een map of flow staat.
5. **Open beslissingen voor mij.** Kort opgesomd, elk met jouw advies. Denk aan:
   - Govern of Instellingen als thuis van de dial
   - de naam "Vandaag"
   - autonomie op contactniveau schrappen of verbergen
   - de module Beleggen in de standaardcatalogus
   - de naam van de boekhoudagent

## Werkwijze
- Lees in deze volgorde:
  1. `docs/plans/een-product.md`
  2. `.cursor/rules/bokito-core-intent.mdc` en `.cursor/rules/backend-backbone.mdc`
  3. `apps/dashboard/src/lib/navigation.ts` en `apps/dashboard/src/App.tsx`
  4. `apps/api/app/services/ai_handling.py` en `apps/api/app/tools/policy.py`
  5. de modellen in `apps/api/app/models/` en `apps/dashboard/src/locales/nl/`
  6. de relevante delen van `BOKITO_KNOWLEDGE.md` (§38 en verder)

  Gebruik subagents voor brede zoekopdrachten als dat sneller is.
- Stel vragen alleen als het antwoord het plan echt verandert. Neem voor de rest een verdedigbare keuze en noteer die als aanname.
- Houd het plan scanbaar: per fase een korte lead en daarna lijsten. Herhaal het document niet.
