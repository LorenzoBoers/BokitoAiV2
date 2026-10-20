# Bokito "Eén product": de volledige opdracht

Dit document bundelt alle context van de vereenvoudiging van Bokito: de review, ronde 1 en 2, de correcties en het Grid-ontwerp. Het is zelfstandig te lezen. Waar het afwijkt van eerdere documenten in `docs/plans/`, **wint dit document**.

**Werkwijze voor de agent:** plan mode. Lees dit document volledig, stel de huidige stand vast in code en app (wat is al gedaan, wat niet), en lever eerst:
1. een statuslijst per onderdeel hieronder (klaar / deels / niet), met bewijs (bestand en regel);
2. een plan voor wat er nog moet, in los te shippen stappen.

Bouw niets voordat het plan is goedgekeurd.

---

## 1. Waarom
Bokito is één gesprek voor het bedrijf: klanten schrijven waar ze al schrijven, team en agents antwoorden in dezelfde lijst, en het werk wordt vanuit gesprekken gestart, gevolgd en gecorrigeerd. De doelgroep is **niet-technische mkb-gebruikers**.

Een productreview (19 oktober 2026, dev 1.2.18) liet zien:
- **Te veel namen:** hetzelfde ding heette op verschillende plekken anders (Map/Project, Flow/Playbook/workstream, Voor jou/Jij bent nodig).
- **Autonomie op te veel plekken:** het stond op ruim tien plaatsen, met een plafond dat elkaar tegensprak.
- **Dubbele ingangen.**
- **Een Grid zonder inhoud:** een organisatiekaart die alleen een inventaris toonde.

Het datamodel was grotendeels al één product. De versnippering zat in copy, navigatie en presentatie.

De eigen noordster (`.cursor/rules/bokito-core-intent.mdc`) schrijft dit al voor: één object per idee, autonomie als één dial in Govern, en het oude scherm weghalen in dezelfde wijziging. Deze opdracht dwingt die regels af.

## 2. Harde randvoorwaarden
- **Geen herbouw.** Werk op V1 (`apps/api`, `apps/dashboard`, `apps/mobile`). De V2-herbouw is op 1 oktober 2026 verwijderd (`BOKITO_KNOWLEDGE.md` §42).
- **De backend is de ruggengraat** (`.cursor/rules/backend-backbone.mdc`): productregels en berekeningen staan in de API, niet in de client.
- **Elke stap is los te shippen** en laat de app werkend achter. Oude URL's krijgen een redirect via `apps/dashboard/src/lib/legacy-redirects.json`. Oude namen, componenten, keys en dode code verdwijnen in dezelfde wijziging.
- **Copy:**
  - Pas copy aan per i18n-sleutel, met de hand, en lees elk scherm in NL en EN na. **Nooit regex-rewrites over waarden, keys of zinnen.** Een eerdere rewrite maakte "Log in" tot "Logboek in", hernoemde mobiele keys en schreef "an today".
  - `docs/product-help/glossary.yaml` is de bron voor alle termen. `apps/dashboard/scripts/check-copy.mjs` bewaakt verboden synoniemen, bekende foute uitkomsten en gelijke keys tussen nl en en.
- **Documentatie:** elke zichtbare wijziging werkt `docs/product-help/` bij in EN en NL, met nieuwe screenshots en `sync_product_help.py`. Interne feiten gaan naar `BOKITO_KNOWLEDGE.md`.
- **Hygiëne:**
  - LF-regeleinden (`.gitattributes`).
  - Geen probe-scripts, tar-bestanden of tijdelijke codemods in commits.
  - Eén Alembic-head.
  - Migraties die kolommen droppen, schrijven de oude waarden eerst weg (`settings_json` of een export), zodat ze te herstellen zijn.

## 3. Het model: vijf begrippen
| NL | EN | Code | Betekenis |
|---|---|---|---|
| Gesprek | Conversation | `Signal` | Alles wat binnenkomt of wordt gestart. Een status maakt het een ticket, een datum zet het op de agenda. |
| Werkmap | Folder | `Project` | **De plek waar al het werk over één onderwerp samenkomt en terechtkomt** (een klant, project of afdelingstaak). Werkmappen kun je nesten. |
| Flow | Flow | `Workstream` | Hoe één soort werk loopt: fasen, eigenaar per fase en een optionele bestemming. Het label is het mechanisme eronder. |
| Agent | Agent | `Agent` | Een AI-medewerker met een plafond. |
| Autonomie | Autonomy | `ai_handling` | Wat een agent zelf mag; één dial in Govern. |

Label, afdeling, kanaal en contact zijn eigenschappen en filters, geen bestemmingen. De tenant blijft "werkruimte / workspace". De Bokito-assistent (`Agent.acts_for_user`) is de hulp in de hoek, geen agent in lijsten.

## 4. Navigatie
- **Rail:**
  - Nieuw gesprek (knop)
  - sectie **Werk**: Communicatie, Agenda, Werkmappen, Flows
  - sectie **Team**: Agents, Workforce
  - Instellingen onderaan, bij het accountblok
- **Vandaag** (was Overview) is het eerste item in de Communicatie-zijbalk, binnen de Communicatie-layout. Er is geen eigen tab Verbruik meer; Verbruik staat in Instellingen.
- **Tabs:**
  - Agents · Kennis (`/agents`, `/agents/knowledge`)
  - Workforce: Mensen en agents · Afdelingen · Grid (`/workforce`, `/workforce/grid`)
- **Instellingen** bevat onder andere Kanalen, Labels, Govern, Modellen, Data en privacy, Koppelingen, Verbruik en Voor ontwikkelaars.
- **Nieuw gesprek** bestaat één keer, als knop in de rail.

## 5. Autonomie op één plek
- **Govern › Beleid**, van boven naar beneden:
  1. één dial (Handmatig / Geassisteerd / Autonoom): het effectieve werkruimteplafond, uit `settings_json.ai_handling.ceiling`
  2. standaard per kanaal
  3. Waarborgen: drempel, noodrem, nieuwe contacten, pingpong
  4. Overdracht
  5. Taal
  6. ingeklapt en los daarvan: "Standaardrechten voor tools". Die sturen géén gespreksplafond.
- **Lagen in `resolve_ai_handling()`:** werkruimte, kanaal en gesprek, begrensd door het werkruimteplafond, privacy, noodrem, het plafond van de agent en `always_review` van de flow. **Geen contact- of labellagen**; die parameters verdwijnen, geen shims.
- **Flow:** schakelaar "Altijd controle" (`always_review`).
- **Elk scherm** toont het effectieve niveau uit de resolver. Nergens nog een preset-naam als plafond.
- **Standaard voor nieuwe werkruimtes:** Geassisteerd.

## 6. Fasen, Waarom en restjes
- **Fasen** staan alleen in `Workstream.stages_json`; de tabellen `workstream_stages*` verdwijnen. Namen per soort:
  - `open`: Niet gestart / Not started
  - `waiting`: Wachtend / Waiting
  - `done`: Klaar / Done

  Geen "Active 2".
- **"Waarom?"** (`services/thread_why.py`, één paneel in de threadheader). Elke regel heeft een link naar de plek waar je het verandert. Het paneel toont:
  - welke agent antwoordde
  - de autonomielagen en plafonds
  - welke kennis de laatste run las (`knowledge_refs` in de `metadata_json` van het bericht)
  - waarom het gesprek in deze werkmap of flow staat
  - de laatste opleveringen (§7)
- **Restjes:**
  - de subtitel van Agents is "AI-medewerkers, hun kennis en wat ze mogen"
  - geen dubbele nav-keys
  - geen Engelse resten in de NL-copy
  - `/ops` achter staff-toegang
  - `/learn` blijft (product-help)

## 7. Werkmappen, "Werkt in" en Opgeleverd
**"Werkt in"** — één sectie op de werkmap, met alles waar in die werkmap gewerkt wordt:

| Soort | Voorbeelden | Bron |
|---|---|---|
| In Bokito | Bord, Bestanden, Canvas | bestaande hub-tabs, `ProjectCanvas` |
| Via een koppeling | GitHub-repo, Drive/OneDrive-map, Exact-administratie, Notion | `ProjectResource` (`models/project_work.py`) |

- Eén kaart per item. Een icoon laat zien of het in Bokito zit of een koppeling is. Knop: "Toevoegen aan Werkt in". `ProjectResourcesSection.tsx` gaat hierin op.
- **Een koppeling die werk ontvangt, hangt altijd aan een werkmap** (desnoods "Algemeen").
- **Modules** (zoals Boekhouding) maken bij installatie een werkmap met het juiste "Werkt in"-item aan.
- **Canvas blijft Canvas**: een werkoppervlak, bijvoorbeeld voor cijfers in accountancy, dat in een werkmap staat. Er is geen "Rapport" en geen Canvas-tab op Vandaag. Werkruimtecanvassen zonder werkmap verhuizen naar de werkmap "Algemeen" (niet "Werkruimte").

**Opgeleverd** — een `SignalEvent` met kind `delivered` in het gesprek. Er komt geen nieuwe tabel.
- **Payload:** `target_kind` (`reply` | `folder` | `works_in` | `knowledge`), `folder_id`, `resource_id` of `canvas_id`, `ref`, `agent_id` of `user_id`, `flow_id`.
- **Waar het ontstaat:**
  - uitgaand antwoord → `reply`
  - elke tool die via een koppeling schrijft → één hook in `tools/registry.py`, die de `ProjectResource` opzoekt via `connection_id` plus `external_ref` (geen match: waarschuwing loggen, geen event)
  - een `WorkJob` klaar → `works_in`
  - een canvas of bestand door een agent bijgewerkt → `works_in`
  - geheugen of kennis na een correctie → `knowledge`
- **In het gesprek:** een chip "Opgeleverd in administratie › Exact".

**Bestemming per flow** — optioneel veld "Levert op in" (werkmap plus optioneel een "Werkt in"-item). Bereikt een ticket een fase van soort `done`, dan wordt er een `delivered` geschreven als dat nog niet gebeurd is.

## 8. Grid (`/workforce/grid`)
**Doel:** de organisatie lezen als één beweging: waar komt werk vandaan, wie pakt het op, hoe loopt het, en waar landt het. Een schakelaar 2D/3D en vijf lenzen.

**Lagen, van links naar rechts, in 2D én 3D:**
1. **Binnenkomst** — kanalen.
2. **Uitvoerders** — agents en mensen.
   - Afdelingen zijn **stroken of zones** om de uitvoerders, geen kolom.
   - Wie in meer afdelingen zit, staat vol in de eerste en als spook (stippelrand) in de andere.
   - "Zonder afdeling" heeft een oranje stippelrand. "Niet toegewezen" staat eronder.
3. **Flow** — hoe werk loopt.
4. **Resultaat** — waar het landt:
   - "Antwoord aan de klant" (per kanaal)
   - werkmappen, met submappen opgeteld bij de bovenliggende werkmap, en "Werkt in" als chips (2D) of kubussen (3D): gevuld = in Bokito, omlijnd = koppeling
   - Kennis
   - de putten "Nog open" en "Gesloten zonder resultaat"

**Lijnen:**
- Dikte = aantal in de periode.
- Stijl in de lens Stroom:

| Pad | Lijnstijl |
|---|---|
| Autonoom | groen, doorgetrokken |
| Geassisteerd | paars, gestreept |
| Mens | grijs |
| Niemand | oranje, gestippeld |

- Gesprekken zonder flow lopen direct van uitvoerder naar Resultaat.

**3D (`components/org/OrgMakeScene.tsx`, Three.js blijft):**
- Vier platen naast elkaar, met Resultaat **rechts van Flow** in een eigen subtiele tint. **Geen boog of hoefijzer vooraan.**
- De kringloop is **één dunne gestippelde boog** hoog over de scène, van "Antwoord aan de klant" terug naar het kanaal (per kanaal één boog, dikte = aantal antwoorden). Kennis heeft één lage boog terug naar de uitvoerdersplaat.
- **Zuilen per uitvoerder:** hoogte = open (log-schaal, met een plafond). In de lens Labels zijn de zuilen gestapeld per labelkleur, grijs = geen label.
- **Labels:** klein, één regel, alleen de naam. Aantallen staan bij hover, klik of in de detailkaart. Geen grote witte kaarten. Zone-namen staan klein in de hoek van de strook, nooit over een node.
- **Camera:** opent met alles in beeld, inclusief de terugkerende boog.
- **Hover** dimt de rest. **Klik** opent de gedeelde detailkaart. De client berekent geen regels.

**Lenzen:**

| Lens | Wat je ziet |
|---|---|
| Stroom | volume, kleur = autonomie |
| Labels | lijnen en stapels in labelkleur, zodat je een label door de hele keten volgt; labelchips isoleren één label; geen autonomiekleuren |
| Structuur | opgeslagen relaties (lidmaatschap, eigenaar, labels) via `org/graph` |
| Autonomie | kleur per node naar effectief niveau |
| Knelpunten | alleen nodes en paden met een issue, de rest gedimd |

**Detailkaart:**
- **Bij een uitvoerder:** wat hij mag en waarom (uit de resolver), wat hij ontvangt en waaraan hij werkt (verdeling per label), en de acties "Open gesprekken" en "Werk verdelen". Bij veel werk zonder label: "Labels voorstellen".
- **Bij een werkmap:** "Werkt in", "Komt binnen via" en "Open werkmap".

**Data (`GET /api/org/flow?days=7`, services `org_flow.py`; geen nieuwe tabellen):**
- **Nodes** met `layer` (`input` | `executor` | `work` | `result`), `zones[]` voor uitvoerders, `open`, `open_by_label`, `waiting_on_you`, `autonomy`, `issues[]` (overbelast: meer dan 15 open of meer dan 2× de mediaan, geen afdeling, offline, niet toegewezen). Werkmappen hebben ook `works_in[]` en `children_count`.
- **Paden** met `count`, `mode` en `by_label`, ook van flow en uitvoerder naar resultaat. Per kanaal `replies` voor de terugkerende bogen.
- **Bron voor het resultaat:** `delivered`-events. Ontbreken die, dan `Signal.project_id` plus uitgaande berichten, met `estimated: true`. Toon in dat geval in de UI "Geschat: nog niet alles is als oplevering vastgelegd".
- **Aantallen:** de Grid telt flows en agents precies zoals de pagina's Flows en Agents. Gebruik gedeelde helpers.

**Referenties (statische concepten; ze laden een `support.js` die alleen in het ontwerpcanvas bestaat, dus lees ze als HTML-referentie, niet als pixel-spec):**
- `docs/plans/grid-concept/grid-2d-resultaat.html` — **leidend voor 2D**
- `docs/plans/grid-concept/grid-3d-resultaat.html` — **leidend voor 3D**
- `docs/plans/grid-concept/grid-3d-labels.html` — de lens Labels met gestapelde zuilen
- `grid-2d-stroom.html` en `grid-3d-lagen.html` zijn verouderd: ze zijn alleen ter vergelijking

## 9. Tests (minimaal)
- **pytest:**
  - resolver per laag
  - migraties (inclusief het herstellen van verwijderde waarden)
  - `org_flow` op een seed met een bekende verdeling (paden, modes, by_label, Niet toegewezen, waiting_on_you, overbelast, `acts_for_user` uitgesloten)
  - `delivered`-hook
  - bestemming per flow
  - gelijke aantallen Grid tegenover Flows en Agents
- **vitest:**
  - layout: Resultaat-x > Flow-x > Uitvoerders-x > Binnenkomst-x, en submappen zijn geen eigen node
  - lijnstijl per mode
  - Govern-dial
  - copy-check, inclusief mobiele key-pariteit
- **Playwright:**
  - rail
  - redirects
  - Waarom-paneel
  - Grid: openen, alle platen zichtbaar, geen node buiten beeld, 2D/3D wisselen, node klikken en de detailkaart zien

## 10. Open beslissingen (stel ze, met jouw advies)
- Wat gebeurt er met tool-writes waarvan de koppeling aan geen werkmap hangt?
- Telt "Gesloten zonder resultaat" ook terecht gesloten gesprekken (spam, geen antwoord nodig)?
- Mag een flow meer dan één bestemming hebben?
- Welk label telt als een gesprek meerdere vrije labels heeft?
- Moet Structuur ook in 2D (advies: later)?

## 11. Eerdere documenten (achtergrond)
`docs/plans/een-product.md` (review), `een-product-prompt.md` (ronde 1), `een-product-ronde-2-prompt.md`, `een-product-ronde-2-correctie.md`, `grid-3d-correctie.md`, en je eigen `een-product-ronde-2-plan.md` en `een-product-ronde-2-copy-audit.md`. Bij tegenstrijdigheid wint dit document.
