# Correctie op de 3D-Grid: Resultaat als plaat rechts, niet als boog vooraan

Plan mode: werk je plan voor Fase C bij en lever eerst de lijst van wat er verandert. Bouw daarna pas.

Referentie (leidend): `docs/plans/grid-concept/grid-3d-resultaat.html`. Leg het naast de huidige 3D-weergave op `/workforce/grid`.

## Wat er nu misgaat
Resultaat ligt als een gebogen band vóór de andere platen, en buigt terug naar links onder Binnenkomst. Daardoor:
- draait de leesrichting aan het eind om. Lijnen van flow naar resultaat lopen achteruit, en lijnen van uitvoerders kruisen dwars over de uitvoerdersplaat;
- blijft het vlak rechts van Flow leeg, terwijl de band vooraan labels afdekt ("RESULTAAT · WAAR HET LANDT" valt weg achter een kaart);
- lopen lijnen vanuit Binnenkomst links uit beeld.

Het hoefijzer uit de correctie-prompt vervalt. Het werkt alleen als Resultaat compact naast Binnenkomst ligt, en dat levert in de praktijk een rommelig lint op.

## Wat het moet worden
1. **Vier platen naast elkaar, van links naar rechts**: Binnenkomst, Uitvoerders, Flow, Resultaat. Resultaat ligt rechts van Flow, net als in 2D. Geef de plaat Resultaat een eigen, subtiele tint, zodat hij leest als eindpunt.
2. **De kringloop met één boog, niet met een hele laag.** Vanaf "Antwoord aan de klant" loopt één dunne, gestippelde boog hoog over de scène terug naar het kanaal waar de vraag binnenkwam, met een pijlpunt bij het kanaal. Eén boog per kanaal met antwoorden in de periode. Dikte = aantal antwoorden. Op de top van de boog staat een klein label "antwoord gaat terug via het kanaal".
3. **Kennis** krijgt één lage, gestippelde boog terug naar de uitvoerdersplaat ("agents lezen mee"). Geen lijnen naar afzonderlijke agents.
4. **Afdelingen als stroken op de uitvoerdersplaat**, niet als gestapelde rechthoeken over elkaar. Elke afdeling is een eigen strook, met de uitvoerders erin en de naam klein in de achterste hoek van de strook, nooit over een node heen. "Zonder afdeling" is een strook met een oranje stippelrand. "Niet toegewezen" staat onder de stroken. Wie in meer afdelingen zit, staat vol in de eerste strook en als spook-puck (stippelrand, gedimd) in de andere.
5. **Labels klein.** Eén regel naast de puck, met alleen de naam, op een donkere achtergrond, en nooit groter dan nodig. Aantallen (open, wacht op jou) staan bij hover, bij klik of in de detailkaart. Een node met een issue krijgt een rand of stip, geen extra regel. De grote witte kaarten verdwijnen.
6. **Submappen tellen op bij hun bovenliggende werkmap.** Resultaat toont "administratie · 2 submappen", niet losse nodes "facturen" en "betaalbevestigingen". Inzoomen of klikken toont de submappen.
7. **"Werkt in" zichtbaar als kleine kubussen** naast de werkmap-puck: één per item, gevuld = in Bokito (Bord, Bestanden, Canvas), alleen omlijnd = via een koppeling (GitHub, Exact, Drive). De namen staan in de detailkaart. Nu zie je alleen grijze blokjes zonder betekenis.
8. **Camera bij openen**: de bounding box van alle platen plus de terugkerende boog past in beeld, met marge. Geen lijnen die buiten beeld beginnen.
9. **Blijft zoals het is:** de melding "Geschat: nog niet alles is als oplevering vastgelegd", de zuilen (hoogte = open), hover dimt de rest, klik opent de detailkaart, en de lenzen. In de lens Labels krijgen de terugkerende bogen de labelkleur.

## Data
Geen nieuwe tabellen. `org_flow` levert per kanaal `replies` (aantal `delivered`-events met `target_kind=reply` per kanaal, anders uitgaande berichten met `estimated: true`) voor de terugkerende bogen, en per werkmap `works_in[]` (kind, label, `in_bokito: bool`) en `children_count`.

## 2D
In 2D verandert er niets aan de kolommen. Daar kan het antwoord als lijn terug naar het kanaal achterwege blijven: de node "Antwoord aan de klant" toont per kanaal een chip.

## Tests
- Playwright: na het openen zijn alle vier de plaatlabels zichtbaar en valt geen node buiten het canvas.
- vitest op de layout: Resultaat-x > Flow-x > Uitvoerders-x > Binnenkomst-x; submappen zijn geen eigen resultaatnode.
- Snapshot of screenshot van de 3D-weergave in de PR.
