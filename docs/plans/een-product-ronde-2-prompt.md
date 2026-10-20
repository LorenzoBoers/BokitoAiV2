# Taak: "Eén product" ronde 2 — herstellen, afmaken en de Grid vernieuwen

Plan mode: maak eerst een plan, schrijf nog geen code. Controleer elk punt hieronder in de code voordat je het overneemt; klopt iets niet, zeg dat.

## Context
Ronde 1 (`docs/plans/een-product.md`, `docs/plans/een-product-prompt.md`) staat als ongecommitte wijziging in de werkmap. De richting klopt: rail met 7 items, `docs/product-help/glossary.yaml`, `check-copy.mjs`, `legacy-redirects.json` met tests, expliciet plafond (`123_autonomy_ceiling`), contactlaag uit de resolver, `always_review` op flows, `thread_why.py`.

Een review van code en app (dev 1.2.18, 19 oktober) vond drie soorten problemen: regressies door de mechanische copy-rewrite, onderdelen die half af zijn, en de Grid die nog niets laat zien van hoe werk stroomt. Deze ronde lost alle drie op.

## Harde randvoorwaarden
- Alles uit `docs/plans/een-product-prompt.md` blijft gelden: geen herbouw, de backend is de ruggengraat, elke fase los te shippen, oude surfaces weg in dezelfde wijziging, product-help EN+NL bijwerken.
- **Geen regex-rewrites meer over copy.** Tekstwijzigingen gaan per i18n-sleutel, met de hand nagelezen per scherm. Nooit over keys, code of gewone zinnen.
- **Regeleinden:** voeg `.gitattributes` toe met `* text=auto eol=lf` en normaliseer de werkmap vóór je commit. Nu staan 270 bestanden op CRLF; de echte diff is ~3,5k regels erbij en ~6,2k eraf, maar git toont 85k.
- Commit geen `apps/api/scripts/dev/_probe_*`, `_codemod_*`, `_patch_*`, `*.sql`/`*.sh`-probes of `apps/api/tmp-label-sync.tar`. Verwijder ze of zet ze buiten de repo.

## Fase A — Regressies herstellen (eerst, los te shippen)
1. **"Logboek in/uit/opnieuw"** op 10 plekken in `locales/nl/*.json` en in `apps/mobile/src/lib/copy.ts` (oorzaak: `apply-glossary-copy.mjs` deed Ledger→Log en daarna Log→Logboek). Terug naar "Log in", "Log uit", "Log opnieuw in". Alleen het Govern-tabblad heet Logboek.
2. **Mobiele copy-keys** die het script hernoemde: `thread.today`→`thread.vandaag` en `home.autonomy`→`home.autonomie`. Zet de keys terug. In de Engelse tabel van `copy.ts` staat nu "Vandaag": herstel naar "Today". `src/lib/format.test.ts` moet weer slagen.
3. **"an today"** in `docs/product-help/en/ai/agenda.md` en `en/inbox/communication.md` (Overview→Today als gewoon woord). Zoek alle EN-copy op "today" als zelfstandig naamwoord en herstel naar "overview" waar het geen schermnaam is.
4. **"Foldermappen"** in `locales/nl/nav.json` (`folderNav`, `breadcrumb`) → "Mappen".
5. **Zinnen die door de vervanging krom zijn**, minstens: "Begrenst Autonomie zodat…", "Bedrijfsstandaard volgt de Autonomie van het gesprek", "Staat Autonomie toe tot Autonoom", "Kies specialisten uit de Aanbod". Lees elk scherm met "Autonomie", "Aanbod", "Map" en "Logboek" één keer door en herschrijf naar normaal Nederlands.
6. **Lint uitbreiden:** `check-copy.mjs` faalt ook op bekende foute uitkomsten ("Logboek in", "Logboek uit", "an today", "Foldermappen", "de Aanbod") en op ongelijke key-sets tussen nl en en (dashboard en mobiel). Laat de lint ook over hardcoded strings in `.tsx` lopen, of verplaats die strings eerst naar i18n (zie Fase B).
7. **Verwijder `apply-glossary-copy.mjs`** na deze fase, zodat niemand hem opnieuw draait.

## Fase B — Ronde 1 afmaken
1. **Rail met twee secties.** Zeven losse items lezen als één lijst. In `lib/navigation.ts`:
   ```ts
   export const PINNED_TABS: readonly Tab[] = []
   export const TAB_GROUPS = [
     { label: 'nav.groups.work', tabs: ['communication', 'agenda', 'folders', 'workstreams'] },
     { label: 'nav.groups.team', tabs: ['agents', 'team'] },
   ]
   ```
   Nieuw gesprek blijft de knop bovenaan; Instellingen staat vast onderaan bij het accountblok in `ShellSidebar.tsx`. Groepsnamen uit i18n (NL: Werk, Team; EN: Work, Team). Werk de kopcommentaar van `navigation.ts` bij; verwijder de `@deprecated` exports (`REPORTS_PATH`, `AGENDA_AUTOMATIONS_PATH`) en hun imports.
2. **Vandaag terug in Communicatie.** `/communication/today` staat nu buiten de `MessagesHub`-layout en geen link verwijst ernaar. Verplaats de route binnen `MessagesHub`, en zet "Vandaag" als eerste item in de Communicatie-zijbalk, boven Alle communicatie. Hardcoded copy in `components/cockpit/OverviewFourBlocks.tsx` ("Jij bent nodig", "Needs you", "Open tickets per actietag", "workbench-gebruik mist een categorie") gaat naar i18n met de woordenlijst-termen (Voor jou, label/flow). Geef het kostenlabel "workbench" een categorie.
3. **Eén plek voor Verbruik:** de tab op Vandaag verdwijnt, `/settings/usage` blijft.
4. **Nieuw gesprek één keer:** de knop bovenaan de Communicatie-zijbalk verdwijnt; de rail-knop blijft.
5. **Kennis en Grid vindbaar maken.** Agents krijgt tabs "Agents · Kennis" (`/agents`, `/agents/knowledge`); het kruimelpad wordt "Agents / Kennis". Workforce krijgt tabs "Mensen en agents · Afdelingen · Grid" (`/workforce`, `/workforce/grid`). "Open in Grid"-knoppen linken naar die tab.
6. **Autonomie echt op één plek.** Nu staan er twee pagina's (Instellingen › Autonomie op `/settings/communication`, en Govern) en Govern legt de tegenstrijdigheid uit ("Gespreksplafond: Autonoom" naast preset "Geassisteerd · Huidige instelling") in plaats van hem weg te nemen. Doel:
   - Eén pagina in Govern met bovenaan één dial (Handmatig / Geassisteerd / Autonoom) die het effectieve plafond is. De preset en de toolcategorie "Berichten" sturen niet meer los een plafond aan.
   - Daaronder: standaard per kanaal, Waarborgen (drempel, noodrem, nieuwe contacten, pingpong), overdracht.
   - Autonomie per label verdwijnt; per flow blijft alleen "altijd controle".
   - `/settings/communication` wordt een redirect; de hint "per kanaal en contact" verdwijnt.
   - In `resolve_ai_handling()`: haal de parameter `contact` en `tag_autonomy` weg in plaats van ze te negeren; laat `resolve_for_signal()` het contact niet meer laden. Pas aanroepers aan.
7. **Fasen.**
   - De fase-soort `waiting` heet "Wachtend" / "Waiting", niet "Actief" / "Active" (`121_flow_stage_names.py`).
   - Op dev staat bij flow `feature` nog "Active 2": controleer of migratie 121 gedraaid is en dit geval afdekt.
   - Eén opslag: kies `stages_json` of `workstream_stages` en migreer. `org_graph.py` en `setup_links.py` lezen nu de tabel.
8. **"Waarom?" afmaken.** `thread_why.py` geeft nu alleen autonomie. Voeg toe: welke agent antwoordde, welke kennis de laatste run las, en waarom het gesprek in deze map of flow staat (welke labels, van gesprek/contact/bedrijf). Toon het in `ThreadHeader.tsx` als één paneel.
9. **Restjes:**
   - Subtitel Agents: niet "Mensen en agents waarmee je kunt chatten" maar iets als "AI-medewerkers, hun kennis en wat ze mogen".
   - Dubbele sleutels in `nav.json` (`overview`/`cockpit`, `folders`/`projects`) samenvoegen.
   - "Teammates", "Workspace-configuratie", "boards en docs" in de NL-copy vertalen.
   - `/ops`, `/learn` en `/cockpit/canvas`: weghalen of achter staff-toegang; Canvas wordt "Rapport" op een map.

## Fase C — Grid: een stroomweergave naast een verbeterd 3D-model
Referentie: `docs/plans/grid-concept/grid-2d-stroom.html`, `grid-3d-lagen.html` en `grid-3d-labels.html` (statische concepten met echte dev-data; alleen de lijndiktes zijn verzonnen). Ze tonen de bedoeling, geen pixel-spec.

**Probleem nu:** de Grid toont een inventaris, geen werking. `services/org_graph.py` levert alleen opgeslagen relaties; alle lijnen zien er hetzelfde uit (geen richting, volume of status); de ring met eilanden heeft geen leesrichting; namen verschijnen pas vanaf 135% zoom en uitzoomen stopt op 70%; er zijn 13 node-soorten.

**Doel:** één Grid met een schakelaar 2D / 3D en vijf lenzen (Stroom, Labels, Structuur, Autonomie, Knelpunten). Beide weergaven gebruiken dezelfde data.

1. **Data (backend, `services/org_graph.py`):**
   - Lagen: `input` (kanalen), `routing` (afdelingen, plus een virtuele node "Niet toegewezen"), `executor` (agents en mensen), `work` (flows), `foundation` (kennis en koppelingen, zonder lijnen).
   - Alleen deze node-soorten in Stroom: kanaal, afdeling, agent, mens, flow. Labels, documenten, agenda's en webhooks alleen in Structuur.
   - Paden met tellingen over een periode (standaard 7 dagen) uit `Signal`: kanaal (`channel_account_id`, widget) → afdeling (`assignee_kind='department'` of de afdeling van de eigenaar/het kanaal; controleer welke bron klopt) → uitvoerder (`agent_id`, `owner_user_id`) → flow (`ticket_tag_id` → `SignalTag.workstream_id`). Gesprekken zonder uitvoerder lopen naar "Niet toegewezen".
   - Per pad: `count` en `mode` (autonoom / geassisteerd / handmatig / mens / niemand), via `resolve_for_signal()` met de `cache`-parameter.
   - Per pad ook `by_label`: tellingen per label (het flow-label `ticket_tag_id`, anders het eerste vrije label, anders `null` voor geen label).
   - Per node: `open`, `open_by_label` (zelfde sleutels als `by_label`), `waiting_on_you` (voor de ingelogde gebruiker), en `issues[]` (overbelast boven een drempel, geen afdeling, offline, niet toegewezen).
   - Lijst `issues` op workspaceniveau voor het knelpuntenpaneel. Geen nieuwe tabellen nodig.
   - Filter `acts_for_user` blijft.
2. **2D-weergave (nieuw):**
   - Vier kolommen links naar rechts: Binnenkomst, Afdelingen, Uitvoerders, Werk; Fundament als band eronder.
   - Gewone HTML/SVG, deterministische layout (geen physics), namen altijd zichtbaar.
   - Lijn: dikte = `count`, stijl = `mode` (groen doorgetrokken = autonoom, paars gestreept = geassisteerd, grijs = mens, oranje gestippeld = niemand).
   - Node: open-teller, rode stip bij wachten op jou, oranje rand bij een issue.
   - Rechts een paneel: eerst Knelpunten, na klik op een node de details met "Mag zelf" + waarom (uit dezelfde resolver) en acties ("Open gesprekken", "Werk verdelen").
3. **3D-model verbeteren (`components/org/OrgMakeScene.tsx`, Three.js en camera blijven):**
   - Vervang de ring met eilanden door vier platen in dezelfde volgorde als 2D, plus een fundamentplaat.
   - Hoogte betekent iets: een zuil per uitvoerder die meeschaalt met `open` (log-schaal, met een plafond), oranje boven de overbelastingsdrempel.
   - In de lens Labels is die zuil een gestapelde zuil: één segment per label in de kleur van dat label (`SignalTag`-kleur), grijs voor geen label, van onder naar boven gesorteerd op grootte. De totale hoogte blijft `open`.
   - Lijnen worden bogen met dezelfde dikte en stijl als 2D.
   - Labels altijd zichtbaar (klein, met achtergrond), niet pas vanaf 135%. Laat uitzoomen toe tot de hele organisatie in beeld is.
   - Hover op een node licht die node en zijn paden op en dimt de rest (nu wordt een eiland een vlakke grijze schijf; repareer dat). Hover in de legenda doet hetzelfde.
   - Klik opent dezelfde detailkaart als 2D.
   - Behoud de huidige stijl (donkere vloer, pucks, figuren rechtop).
4. **Lenzen:**
   - Stroom: paden met volume; kleur = autonomie.
   - Labels: lijnen en stapels krijgen de labelkleur, grijs = geen label, zodat je een label door de hele keten volgt (kanaal → afdeling → uitvoerder → flow). Een rij labelchips bovenaan isoleert één label (de rest dimt). De detailkaart toont de verdeling per label en, bij veel werk zonder label, de actie "Labels voorstellen". Autonomiekleuren (groen/paars) komen in deze lens niet voor, zodat kleuren niet botsen; ook de 2D-weergave krijgt deze lens.
   - Structuur: de huidige relaties (lidmaatschap, eigenaar, labels).
   - Autonomie: kleur per node naar effectief niveau.
   - Knelpunten: alleen nodes en paden met een issue, de rest gedimd.
5. **Tests:**
   - Backend-tests voor de paden en tellingen op een seed met bekende verdeling.
   - Een e2e-test die 2D en 3D opent, een node aanklikt en de detailkaart ziet.
   - Controleer dat de aantallen op Grid gelijk zijn aan Flows, Agents en Workforce: nu 5 flows tegenover 2, en 3 agents tegenover 4.

## Wat ik in het plan wil zien
- Per fase: wat de gebruiker merkt, de bestanden, eventuele migraties, wat verwijderd wordt, de tests en een omvang (S/M/L).
- Voor Fase A apart: de precieze lijst van alle plekken die de copy-rewrite heeft beschadigd. Vergelijk de waarden in `locales/`, `docs/product-help/` en `apps/mobile/src/lib/copy.ts` met `HEAD`, en geef per regel aan of het een goede of een foute vervanging is.
- Open beslissingen voor mij, elk met jouw advies. Denk aan:
  - de drempel voor "overbelast"
  - de standaardperiode van de Grid
  - welk label telt als een gesprek meerdere vrije labels heeft
  - of Structuur ook in 2D moet
  - stages in JSON of in een tabel

## Werkwijze
- Lees eerst deze prompt, `docs/plans/een-product.md`, `.cursor/rules/bokito-core-intent.mdc`, `lib/navigation.ts`, `App.tsx`, `services/ai_handling.py`, `services/org_graph.py`, `components/org/OrgMakeScene.tsx` en de twee conceptbestanden.
- Gebruik subagents voor de brede copy-vergelijking met `HEAD`.
- Vraag alleen wat het plan echt verandert. Neem voor de rest een verdedigbare keuze en noteer die als aanname.
