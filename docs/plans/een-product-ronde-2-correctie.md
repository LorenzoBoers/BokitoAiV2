# Correctie op ronde 2: werkmappen, de laag Resultaat en de Grid

Plan mode. Dit document **wijzigt** `docs/plans/een-product-ronde-2-prompt.md` en het plan dat je daarvoor schreef (`docs/plans/een-product-ronde-2-plan.md`). Lees die eerst. Waar ze tegenstrijdig zijn, wint dit document. Werk je plan bij en lever een lijst op van wat er aan je plan verandert. Bouw nog niets.

Wat al klaar is (rail met secties Werk en Team, herstel van "Logboek", `.gitattributes`) blijft staan.

## Waarom deze correctie
De Grid eindigde in ronde 2 bij "Werk" (de flows). Die laag zegt welk soort werk het is, niet waar het terechtkomt. Een organisatiekaart moet de hele keten laten zien: waar komt werk vandaan, wie pakt het op, hoe loopt het, en waar landt het.

Uit het gesprek met de product owner komt één nieuwe filosofie:

> **Een werkmap is de plek waar al het werk over één onderwerp samenkomt en terechtkomt**: een klant, een project of een afdelingstaak.

Accountancy werkt bijvoorbeeld in een werkmap: bestanden opslaan, cijfers beheren op een canvas, en boeken in Exact. Development werkt in een werkmap met een bord, bestanden en een GitHub-repo.

## Referenties
- `docs/plans/grid-concept/grid-2d-resultaat.html` — **nieuw, leidend**: 2D-weergave van binnenkomst tot resultaat, met afdelingen als zones en werkmappen met "Werkt in".
- `docs/plans/grid-concept/grid-3d-labels.html` — 3D, lens Labels (gestapelde zuilen per label).
- `docs/plans/grid-concept/grid-3d-lagen.html` — 3D, lens Stroom.
- `docs/plans/grid-concept/grid-2d-stroom.html` — **vervangen** door `grid-2d-resultaat.html`; alleen nog ter vergelijking.

De concepten laden een `support.js` die alleen in het ontwerpcanvas bestaat. Lees ze als HTML-referentie, niet als pixel-spec.

## Correctie 1 — Map heet Werkmap
- UI: NL **Werkmap / Werkmappen**, EN **Folder / Folders** (Engels verandert niet).
- Code, tabellen, API en URL blijven (`Project`, `/api/folders`, `/folders`).
- Werk `docs/product-help/glossary.yaml` bij: `id: folder`, `nl: Werkmap`, verboden synoniemen `Map` (als zelfstandige term voor dit begrip), `Project`, `Projecten`.
- **Geen regex-rewrite.** Pas per i18n-sleutel aan en lees elk scherm na. Let op samenstellingen en verbuigingen: "Submappen" wordt "Subwerkmappen" of liever "Werkmappen hierin"; "Nieuwe map" wordt "Nieuwe werkmap". Let ook op de botsing met de Excel-term "werkmap": gebruik in zinnen altijd "werkmap in Bokito" waar verwarring kan ontstaan, bijvoorbeeld in onboarding.
- De tenant blijft "werkruimte / workspace". Het CRM-bedrijf blijft zoals het is.

## Correctie 2 — "Werkt in" op de werkmap
Alles in een werkmap waar werk landt, staat onder één kop **"Werkt in"** (EN: "Works in"). Er komt geen nieuw zelfstandig begrip.

| Soort | Voorbeelden | Bron in de code |
|---|---|---|
| In Bokito | Bord, Bestanden, Canvas | bestaande tabs van de maphub, `ProjectCanvas` |
| Extern, via koppeling | GitHub-repo, Drive/OneDrive-map, Exact-administratie, Notion | `ProjectResource` (`models/project_work.py`) |

- De maphub krijgt één sectie "Werkt in" met dezelfde kaart voor elk item; een icoon laat zien of het in Bokito zit of een koppeling is. `ProjectResourcesSection.tsx` komt daarin op, niet meer weggestopt.
- **Regel:** een externe koppeling die werk ontvangt, hangt altijd aan een werkmap (desnoods "Algemeen"). Een `ProjectResource` zonder werkmap bestaat niet.
- **Modules:** een module-installatie (zoals Boekhouding) maakt een werkmap met het juiste "Werkt in"-item aan. Dit past bij `docs/architecture/module-one-time-drop.md`.
- Knop: "Toevoegen aan Werkt in" (canvas, koppeling of bestandsmap).

## Correctie 3 — Canvas blijft, als werkplek in een werkmap
Dit draait een eerder advies terug. Ronde 1 en 2 zeiden: "Canvas wordt Rapport", en "/cockpit/canvas weghalen". Dat vervalt.
- Een canvas is een werkoppervlak, bijvoorbeeld voor cijfers in accountancy, en hoort in een werkmap onder "Werkt in".
- De Canvas-tab op Vandaag verdwijnt. `/cockpit/canvas` wordt een redirect naar het canvas in de juiste werkmap, of naar een werkmap "Algemeen".
- Verversen via de agenda (zoals nu) blijft.

## Correctie 4 — De gebeurtenis "Opgeleverd"
Nieuw, de basis voor de laag Resultaat.
- Eén `SignalEvent` met kind `delivered` in het gesprek ("the thread is the log", dus geen nieuwe tabel). Payload: `target_kind` (`reply` | `folder` | `works_in` | `knowledge`), `folder_id`, `resource_id` of `canvas_id`, `ref` (PR-URL, bestand, boeking-id, bericht-id), `agent_id` of `user_id`, `flow_id`.
- **Waar het ontstaat:**
  - Uitgaand antwoord via een kanaal → `reply`.
  - Elke tool die schrijft via een koppeling → één hook in `tools/registry.py`. Die zoekt de `ProjectResource` op via `connection_id` plus `external_ref` en schrijft de gebeurtenis. Het gebeurt dus op één plek, niet per tool. Vindt hij geen resource, dan schrijft hij geen event maar logt hij een waarschuwing, zodat ontbrekende koppelingen zichtbaar worden.
  - Klaar van een `WorkJob` → `works_in` met de PR of branch uit `artifacts_json`.
  - Een canvas of bestand bijgewerkt door een agent → `works_in`.
  - Een geheugenregel of kennisdocument aangepast na een correctie → `knowledge`.
- **In het gesprek:** een chip "Opgeleverd in administratie › Exact". Klik opent de plek.
- **"Waarom?"** (`thread_why.py`) toont ook de laatste opleveringen.

## Correctie 5 — Vaste bestemming per flow
- Een flow krijgt een optioneel veld **"Levert op in"**: een werkmap plus optioneel een "Werkt in"-item. Bijvoorbeeld: "VAT filing preparation levert op in administratie › Exact".
- Zodra een ticket van die flow een fase van soort `done` bereikt, schrijft het systeem een `delivered`-event naar die bestemming, als er nog geen oplevering was.
- Op de flowpagina staat de bestemming onder de naam.

## Correctie 6 — Grid: van binnenkomst tot resultaat
Vervangt de laagindeling in Fase C van ronde 2. Alles wat er over lenzen, 2D/3D, labelstapels, hover en tests stond, blijft gelden.

**Lagen (links naar rechts):**
1. **Binnenkomst** — kanalen.
2. **Uitvoerders, gegroepeerd per afdeling** — afdelingen zijn geen eigen kolom meer, maar zones om de uitvoerders heen.
   - Iemand in meer afdelingen staat in de eerste zone vol en in de andere als "spook" met een stippelrand ("ook in Development").
   - Uitvoerders zonder afdeling staan in een zone "Zonder afdeling" met een oranje stippelrand.
   - "Niet toegewezen" staat onder de zones.
3. **Flow** — hoe werk loopt.
4. **Resultaat** — waar het landt:
   - **Antwoord aan de klant**, met chips per kanaal waarlangs is geantwoord.
   - **Werkmappen**, elk met hun "Werkt in"-items als chips (gevuld = in Bokito, omlijnd = koppeling).
   - **Kennis**, gevoed door correcties. In 2D is dat een gestippelde lijn langs de rechterrand vanaf "Antwoord aan de klant".
   - **Twee putten:** "Nog open" (som van open bij uitvoerders) en "Gesloten zonder resultaat" (gesprekken gesloten zonder `delivered`-event).

**Lijnen:**
- Uitvoerder → flow → resultaat.
- Gesprekken zonder flow lopen direct van uitvoerder naar resultaat. In 2D lopen die boven de flowkolom langs, nooit door een kaart heen.
- Tellingen komen uit `delivered`-events in de periode. Zolang die er niet zijn: uit `Signal.project_id` plus uitgaande berichten, en markeer dat in de API als `estimated: true`.

**Fundament:** valt weg als aparte band. Koppelingen verschijnen als "Werkt in"-chips in Resultaat; Kennis is een node in Resultaat.

**Detailpaneel bij een werkmap:** "Werkt in" met de herkomst (Bokito of koppeling), "Komt binnen via" (flows en uitvoerders), en de acties "Open werkmap" en "Toevoegen aan Werkt in".

**3D:**
- Dezelfde vier lagen als platen.
- Resultaat ligt in 3D in een **hoefijzer** naast Binnenkomst, zodat de kringloop dichtgaat. In 2D niet: daar blijft het van links naar rechts.
- Werkmappen zijn pucks met kleine kubussen per "Werkt in"-item. Afdelingen zijn gekleurde zones op de uitvoerdersplaat.
- De labelstapels uit `grid-3d-labels.html` blijven bij de uitvoerders.

**Data (`services/org_graph.py`):**
- Voeg laag `result` toe met de node-soorten `reply`, `folder` (met `works_in[]`), `knowledge`, `sink_open` en `sink_closed_without_result`.
- Laag `routing` verdwijnt als kolom; afdelingen worden een `zone`-eigenschap per uitvoerder (een lijst, voor wie in meer afdelingen zit).
- Per pad `count`, `mode` en `by_label` zoals al gepland, nu ook voor flow → resultaat en uitvoerder → resultaat.

## Wat ik in je bijgewerkte plan wil zien
- Een lijst van wat er aan je ronde-2-plan verandert (toegevoegd, vervallen, anders).
- Per correctie: bestanden, migraties (veld "Levert op in" op `Workstream`; eventuele opschoning van `ProjectResource` zonder werkmap), API-wijzigingen, wat verwijderd wordt, tests en omvang (S/M/L).
- De volgorde. Mijn voorstel:
  1. Correctie 1 (naam) samen met de rest van Fase A en B.
  2. Correctie 2 en 3 (Werkt in, Canvas).
  3. Correctie 4 en 5 (Opgeleverd, bestemming).
  4. Correctie 6 (Grid), omdat die van 4 afhangt.
- Open beslissingen, elk met jouw advies:
  - wat er gebeurt met tool-writes waarvan de koppeling aan geen werkmap hangt
  - of "Gesloten zonder resultaat" ook gesprekken telt die terecht zonder resultaat sluiten (spam, geen antwoord nodig)
  - of een flow meer dan één bestemming mag hebben

## Werkwijze
- Lees eerst:
  1. dit document
  2. je ronde-2-plan
  3. `grid-2d-resultaat.html`
  4. `models/project_work.py`, `models/workbench.py`, `tools/registry.py`, `services/org_graph.py`, `services/thread_why.py`
  5. `components/projects/ProjectResourcesSection.tsx`
- Geen regex over copy. Lees elk aangepast scherm in NL en EN één keer na.
- Vraag alleen wat het plan echt verandert. Neem voor de rest een verdedigbare keuze en noteer die als aanname.
