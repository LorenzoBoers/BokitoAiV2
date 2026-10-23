# Testsuite: bron op het cijferblok

Status: voorbereid op 2026-10-22. Niet uitgevoerd.

Deze suite hoort bij stap 1 van het totaalplan: de bron zit op het blok (stat, grafiek, taart, tabel) in `tree_json`, de server koppelt die aan een tool-aanroep uit dezelfde beurt, en de tegel toont de regel na één tik. Nakijken, een vaste kengetaldefinitie, een vraag over meerdere bronnen, een rapport via de agenda, en canvas delen vallen buiten deze suite. Een falende test wordt niet opgelost door een van die latere stappen te bouwen.

Omgeving: `https://dev.app.bokito.ai`, ingelogd in de werkruimte van de operator. Maak één nieuw testgesprek met de titel `Bron-suite`. Gebruik geen klantgesprek. Vernieuw het canvasvenster na elke geslaagde schrijfactie voordat je het scherm beoordeelt.

## Hoe de uitvoerende agent de lijst afwerkt

Start pas als de operator vraagt de suite te draaien. Werk de scenario's af in de volgorde van de index. Per scenario, en niet eerder het volgende:

1. Voer de stappen uit op dev, in de UI.
2. Beoordeel elke genummerde eis. Een eis is waar of onwaar. Er is geen gedeeltelijk succes.
3. Log de poging in `docs/plans/canvas-block-source-suite-log.md` met scenario-id, pogingnummer, `geslaagd` of `niet geslaagd`, de nummers van de onware eisen, en wat er op het scherm of in het canvas-JSON stond.
4. Zijn alle eisen waar, ga dan naar het volgende scenario.
5. Is minstens één eis onwaar, wijzig dan alleen de productcode die deze eis waar maakt. Draai hetzelfde scenario opnieuw vanaf de stappen. Herhaal tot alle eisen waar zijn. Sla het scenario niet over en versoepel de eisen niet.
6. Zet een geslaagde verbetering op dev voordat je het scenario opnieuw beoordeelt, zodat het scherm de verbetering toont.
7. Stop niet halverwege de index. Het logboek eindigt met een telling: aantal scenario's, aantal geslaagd na hoeveel pogingen, en de scenario's die nog open zouden staan. Die laatste lijst hoort leeg te zijn.

Bewijs komt uit drie plekken, alleen de plek die het scenario noemt:

- Scherm: wat een bezoeker in het canvasvenster ziet, inclusief rol en tekst van een knop.
- Activiteit: het tool-resultaat van `edit_canvas` of `update_folder_canvas` in het activiteitenpad van het gesprek.
- Payload: het JSON van `GET /api/workforce/canvases/{id}`. De bron staat op het blok in `tree_json`, als object `source` met `tool`, `tool_use_id` en `as_of`.

Gedeelde begrippen, zodat de eisen hieronder eenduidig zijn:

- Bronobject: precies de drie velden `tool`, `tool_use_id` en `as_of`. `tool` is de toolnaam. `tool_use_id` is de id van die aanroep. `as_of` voldoet aan `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$`.
- Bronregel: een zichtbare paragraaf `p[data-testid=canvas-source]` waarvan de tekst exact `{tool} · {as_of}` is, met een spatie, een middenpunt en een spatie tussen de twee delen.
- Dicht: die paragraaf komt niet voor in het canvasvenster.
- Open: die paragraaf is zichtbaar.
- Cijferblok: `stat`, `bar_chart`, `line_chart`, `area_chart`, `pie_chart` of `table`.
- Geen bronplicht: `heading`, `text`, `callout`, `list` en `divider`, en canvassen van het soort document, diagram, tekening, beeld, code, e-mail of sheet.

## Index

98 scenario's.

- Functioneel, F01–F40: wat de server bewaart en afdwingt.
- Visueel, V01–V28: wat de tegel doet en hoe de tik aanvoelt.
- Bronregel op het dashboard, D01–D30: waar de regel op een canvas staat en waar niet.

## Functioneel

### F01 Stat bewaart één bronobject

Stappen: vraag in `Bron-suite` een dashboard met één stat `Open`, gevuld vanuit een lees-tool in die beurt. Open het canvas.

Eisen:

1. Het stat toont een waarde.
2. De payload heeft op dat stat precies één bronobject.
3. `tool` is de naam van de lees-tool uit deze beurt.
4. `tool_use_id` is de id van die aanroep.
5. `as_of` voldoet aan het tijdsformaat hierboven.
6. Er is geen aparte brontabel bij gekomen; de bron staat alleen in `tree_json`.

Bewijs: scherm en payload.

### F02 Staafgrafiek bewaart één bronobject

Stappen: vraag een dashboard met één staafgrafiek waarvan de waarden uit een lees-tool in deze beurt komen.

Eisen:

1. De grafiek is zichtbaar en heeft minstens één staaf of punt.
2. De payload heeft op dat `bar_chart`-blok precies één bronobject.
3. `tool` en `tool_use_id` horen bij de lees-tool van deze beurt.
4. `as_of` voldoet aan het tijdsformaat.

Bewijs: scherm en payload.

### F03 Lijngrafiek bewaart één bronobject

Stappen: vraag een dashboard met één lijngrafiek uit een lees-tool van deze beurt.

Eisen:

1. De lijn is zichtbaar.
2. De payload heeft op dat `line_chart`-blok precies één bronobject van de lees-tool van deze beurt.
3. `as_of` voldoet aan het tijdsformaat.

Bewijs: scherm en payload.

### F04 Vlakgrafiek bewaart één bronobject

Stappen: vraag een dashboard met één vlakgrafiek uit een lees-tool van deze beurt.

Eisen:

1. Het vlak is zichtbaar.
2. De payload heeft op dat `area_chart`-blok precies één bronobject van de lees-tool van deze beurt.
3. `as_of` voldoet aan het tijdsformaat.

Bewijs: scherm en payload.

### F05 Taart bewaart één bronobject

Stappen: vraag een taart met twee tot zes parten, gevuld uit een lees-tool van deze beurt.

Eisen:

1. De taart toont die parten.
2. De payload heeft op dat `pie_chart`-blok precies één bronobject van de lees-tool van deze beurt.
3. `as_of` voldoet aan het tijdsformaat.

Bewijs: scherm en payload.

### F06 Tabel bewaart één bronobject

Stappen: vraag een tabel met een titel, minstens één kolom en één rij, gevuld uit een lees-tool van deze beurt.

Eisen:

1. De tabel toont die rij.
2. De payload heeft op dat `table`-blok precies één bronobject van de lees-tool van deze beurt.
3. `as_of` voldoet aan het tijdsformaat.

Bewijs: scherm en payload.

### F07 De server zet de toolnaam

Stappen: laat de agent een stat schrijven waarvan `source.tool` in het verzoek een andere naam is dan de tool die bij `tool_use_id` hoort, terwijl die id wél uit deze beurt komt.

Eisen:

1. Het activiteitenpad toont geen geslaagde `edit_canvas` voor die schrijfactie.
2. Het resultaat bevat de tekst `tool does not match that call`.
3. De payload houdt de vorige tekening; het stat met de verkeerde toolnaam staat er niet in.

Bewijs: activiteit en payload.

### F08 De server zet het tijdstip

Stappen: laat de agent een stat schrijven met een geldige `tool_use_id` uit deze beurt en een `as_of` van `1999-01-01T00:00:00`.

Eisen:

1. Het canvas toont het stat.
2. `source.as_of` in de payload is niet `1999-01-01T00:00:00`.
3. `source.as_of` is het tijdstip van de lees-aanroep en voldoet aan het tijdsformaat.
4. `source.tool` is de naam van de lees-tool uit deze beurt.

Bewijs: payload.

### F09 Een cijfer zonder bron wordt in een beurt geweigerd

Stappen: laat de agent een stat schrijven zonder `source`.

Eisen:

1. Het resultaat van die schrijfactie heeft `status` `invalid`.
2. De fouttekst bevat `cite tool_use_id from a tool call in this turn`.
3. Dat stat staat niet in de payload.

Bewijs: activiteit en payload.

### F10 Een onbekende aanroep wordt geweigerd

Stappen: laat de agent een stat schrijven met `source.tool_use_id` gelijk aan `toolu_suite_missing`.

Eisen:

1. Het resultaat heeft `status` `invalid`.
2. De fouttekst bevat `cite tool_use_id from a tool call in this turn`.
3. De payload bevat geen bronobject met `toolu_suite_missing`.

Bewijs: activiteit en payload.

### F11 Een lege id wordt geweigerd

Stappen: laat de agent een stat schrijven met `source.tool_use_id` gelijk aan een lege string.

Eisen:

1. Het resultaat heeft `status` `invalid`.
2. De fouttekst bevat `cite tool_use_id from a tool call in this turn`.
3. Het stat staat niet in de payload.

Bewijs: activiteit en payload.

### F12 Een id van alleen spaties wordt geweigerd

Stappen: laat de agent een stat schrijven met `source.tool_use_id` gelijk aan drie spaties.

Eisen:

1. Het resultaat heeft `status` `invalid`.
2. De fouttekst bevat `cite tool_use_id from a tool call in this turn`.
3. De payload bevat geen bronobject waarvan de id alleen spaties is.

Bewijs: activiteit en payload.

### F13 Een bron als tekst wordt geweigerd

Stappen: laat de agent een stat schrijven waarvan `source` de string `list_threads` is, geen object.

Eisen:

1. Het resultaat heeft `status` `invalid`.
2. De fouttekst noemt `source` en `tool_use_id`.
3. De payload bevat geen stat waarvan de bron de string `list_threads` is.

Bewijs: activiteit en payload.

### F14 Een geweigerde schrijfactie laat het canvas staan

Stappen: sla eerst een geldig stat op. Vraag daarna een wijziging die F09, F10 of F11 laat falen.

Eisen:

1. De tweede schrijfactie is `invalid`.
2. Titel, waarde en bronobject van het eerste stat zijn in de payload gelijk aan de geslaagde versie.
3. Het scherm toont nog het eerste cijfer.

Bewijs: scherm, activiteit en payload.

### F15 De fout noemt het pad van het blok

Stappen: laat een schrijfactie van twee blokken falen omdat alleen het tweede stat geen bron heeft.

Eisen:

1. De fouttekst begint het pad met `blocks[1].source` of bevat dat pad.
2. Het eerste blok wordt niet als oorzaak genoemd wanneer dat blok wél een geldige bron heeft.
3. Er worden hoogstens zes foutregels getoond, de bestaande grens van de validator.

Bewijs: activiteit.

### F16 Een bestaand dashboard zonder bron blijft leesbaar

Stappen: open een dashboard dat al op dev stond vóór deze stap en dat geen `tool_use_id` in `tree_json` heeft.

Eisen:

1. De cijfers, grafieken en tabellen die er al stonden zijn zichtbaar.
2. Het venster toont geen bronregel.
3. Er verschijnt geen foutbanner omdat de bron ontbreekt.

Bewijs: scherm en payload.

### F17 Een opgeslagen bron blijft staan zonder nieuwe beurt

Stappen: sla een geldig stat op. Herlaad de pagina zonder een nieuw bericht te sturen.

Eisen:

1. Het stat toont dezelfde waarde.
2. Het bronobject in de payload is veld voor veld gelijk aan de versie van vóór de herlaad.
3. Er is geen nieuwe tool-aanroep gedaan om de bron te behouden.

Bewijs: payload en activiteit.

### F18 Een latere ronde in dezelfde beurt mag de eerdere leesactie noemen

Stappen: laat de agent eerst een lees-tool aanroepen en pas in een volgende modelronde van diezelfde beurt het canvas schrijven met die `tool_use_id`.

Eisen:

1. De schrijfactie slaagt.
2. `source.tool_use_id` is de id uit de eerdere ronde, niet uit de schrijfronde.
3. De bronregel noemt de lees-tool.

Bewijs: activiteit, payload en scherm.

### F19 Een vorig bericht is geen bron voor een nieuw bericht

Stappen: rond een geslaagde canvas-schrijfactie af. Stuur een nieuw gebruikersbericht dat hetzelfde cijfer wil wijzigen en daarbij alleen de oude `tool_use_id` meestuurt, zonder de lees-tool opnieuw aan te roepen.

Eisen:

1. Die schrijfactie heeft `status` `invalid`, of de agent roept de lees-tool opnieuw aan en gebruikt de nieuwe id.
2. Blijft de oude id in het verzoek staan, dan bevat de fout `cite tool_use_id from a tool call in this turn`.
3. Een geslaagde nieuwe schrijfactie heeft een `tool_use_id` uit het nieuwe bericht.

Bewijs: activiteit en payload.

### F20 edit_canvas is geen bron

Stappen: laat de agent een stat schrijven waarvan `tool_use_id` de id van de `edit_canvas`-aanroep zelf is.

Eisen:

1. De schrijfactie faalt met `cite tool_use_id from a tool call in this turn`, of slaagt alleen doordat een andere, eerdere lees-tool wordt geciteerd.
2. Geen opgeslagen bronobject heeft als `tool` de waarde `edit_canvas`.

Bewijs: payload.

### F21 create_canvas is geen bron

Stappen: laat de agent bij het vullen van een net gemaakt canvas de id van `create_canvas` als `tool_use_id` op een stat zetten.

Eisen:

1. Geen opgeslagen bronobject heeft als `tool` de waarde `create_canvas`.
2. Een stat dat alleen die id citeert, wordt geweigerd.

Bewijs: payload en activiteit.

### F22 finish_canvas is geen bron

Stappen: laat de agent een cijferblok schrijven met de id van `finish_canvas` als enige bron.

Eisen:

1. Geen opgeslagen bronobject heeft als `tool` de waarde `finish_canvas`.
2. Die schrijfactie wordt geweigerd zolang er geen andere geldige lees-id is.

Bewijs: payload en activiteit.

### F23 update_folder_canvas is geen bron

Stappen: laat een map-canvas bijwerken met de id van `update_folder_canvas` als enige bron van een stat.

Eisen:

1. Geen opgeslagen bronobject heeft als `tool` de waarde `update_folder_canvas`.
2. Die schrijfactie wordt geweigerd zolang er geen andere geldige lees-id is.

Bewijs: payload en activiteit.

### F24 Een mislukte leesactie is geen bron

Stappen: laat een lees-tool falen en gebruik de id van die mislukte aanroep als enige bron van een stat.

Eisen:

1. De schrijfactie heeft `status` `invalid`.
2. De fouttekst bevat `cite tool_use_id from a tool call in this turn`.
3. De payload bevat die id niet als `tool_use_id`.

Bewijs: activiteit en payload.

### F25 Twee cijfers mogen dezelfde aanroep noemen

Stappen: lees één keer een lijst en zet twee stats die allebei die `tool_use_id` citeren.

Eisen:

1. Beide stats zijn zichtbaar.
2. Beide bronobjecten hebben dezelfde `tool`, dezelfde `tool_use_id` en dezelfde `as_of`.
3. Er staan twee bronobjecten in de payload, één per stat.

Bewijs: scherm en payload.

### F26 Twee cijfers mogen twee aanroepen noemen

Stappen: doe twee verschillende geslaagde lees-acties en laat elk stat een andere id citeren.

Eisen:

1. Beide stats zijn zichtbaar.
2. De twee `tool_use_id`-waarden verschillen.
3. Elke `tool` hoort bij de aanroep van die id.
4. Elke bronregel, na een tik, noemt de tool van dat stat.

Bewijs: scherm en payload.

### F27 Een stat in een kaart krijgt een bron

Stappen: vraag een kaart met daarin één stat, gevuld uit een lees-tool van deze beurt.

Eisen:

1. Het stat staat in de kaart.
2. Het bronobject staat op het stat, niet op de kaart.
3. De kaart zelf heeft geen `source`.
4. `tool_use_id` hoort bij de lees-tool van deze beurt.

Bewijs: scherm en payload.

### F28 Een kop heeft geen bronplicht

Stappen: vraag een dashboard dat met een kop opent en daarna één geldig stat.

Eisen:

1. De kop is zichtbaar.
2. Het kop-blok in de payload heeft geen `source`.
3. Het stat heeft wel een bronobject.
4. De schrijfactie slaagt.

Bewijs: scherm en payload.

### F29 Tekst, callout, lijst en scheidingslijn hebben geen bronplicht

Stappen: vraag een dashboard met die vier blokken plus één geldig stat.

Eisen:

1. Alle vijf de onderdelen zijn zichtbaar.
2. Alleen het stat heeft een bronobject.
3. De schrijfactie slaagt.

Bewijs: scherm en payload.

### F30 Een document-canvas eist geen blokbron

Stappen: vraag een canvas van het soort document met een korte Markdown-tekst.

Eisen:

1. Het document is leesbaar.
2. De payload bewaart de tekst in het bronveld van het canvas, niet als cijferblok met `source`.
3. Er is geen fout over `tool_use_id`.

Bewijs: scherm en payload.

### F31 Een sheet eist geen blokbron

Stappen: vraag een canvas van het soort sheet met één kolom en één rij.

Eisen:

1. De sheet toont die rij.
2. Er is geen fout over `tool_use_id`.
3. Er staat geen bronregel op de sheet.

Bewijs: scherm en activiteit.

### F32 Een diagram eist geen blokbron

Stappen: vraag een diagram-canvas met een korte Mermaid-stroom.

Eisen:

1. Het diagram of de bronteks is zichtbaar.
2. Er is geen fout over `tool_use_id`.
3. Er staat geen bronregel van een cijferblok op het diagram.

Bewijs: scherm en activiteit.

### F33 Het tijdstip heeft geen fractie en geen tijdzone

Stappen: sla een geldig stat op en lees `source.as_of`.

Eisen:

1. De waarde heeft lengte 19.
2. De waarde voldoet aan `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$`.
3. De waarde bevat geen `.` en geen `Z` en geen `+`.

Bewijs: payload.

### F34 De id is de tool-aanroep, niet de activiteiten-id

Stappen: sla een geldig stat op. Vergelijk `source.tool_use_id` met de id in het activiteitenpad.

Eisen:

1. `tool_use_id` is gelijk aan de id van de lees-aanroep in het modelbericht.
2. `tool_use_id` begint niet met `tool-`.
3. `tool_use_id` is niet leeg en is hoogstens 128 tekens.

Bewijs: activiteit en payload.

### F35 Een taart met zeven parten wordt een staaf en houdt de bron

Stappen: vraag een taart met zeven parten en een geldige bron uit deze beurt.

Eisen:

1. Het scherm toont een staafgrafiek, geen taart.
2. De payload heeft een `bar_chart` met de zeven labels.
3. Dat blok heeft één bronobject van de lees-tool van deze beurt.
4. Het activiteitenpad noemt dat de taart een staafgrafiek is geworden.

Bewijs: scherm, activiteit en payload.

### F36 Eén bron per blok, niet per punt of cel

Stappen: sla een staafgrafiek op met twee series en een tabel met twee rijen, elk met een geldige bron.

Eisen:

1. De grafiek heeft één bronobject, niet één per serie of punt.
2. De tabel heeft één bronobject, niet één per cel of rij.
3. Een tik op de titel opent één bronregel.

Bewijs: scherm en payload.

### F37 Een reeks heeft zelf geen bron

Stappen: lees de payload van de grafiek uit F36.

Eisen:

1. Geen object in `series` heeft een sleutel `source`.
2. Geen punt heeft een sleutel `source`.
3. De enige `source` van dat blok staat op het blok zelf.

Bewijs: payload.

### F38 Opnieuw opslaan in een nieuwe beurt eist een nieuwe leesactie

Stappen: sla een geldig dashboard op. Stuur daarna een nieuw bericht: "sla dezelfde blokken opnieuw op" en laat de oude `tool_use_id` hergebruiken zonder nieuwe lees-tool.

Eisen:

1. De oude id alleen is onvoldoende: de schrijfactie faalt, of de agent leest opnieuw en schrijft de nieuwe id.
2. Na een geslaagde nieuwe schrijfactie hoort elke `tool_use_id` bij een aanroep uit dat nieuwe bericht.
3. Het scherm toont daarna nog steeds de cijfers.

Bewijs: activiteit en payload.

### F39 De toolnaam hoeft niet meegegeven te worden

Stappen: laat de agent een stat schrijven met alleen `source.tool_use_id` van een geslaagde lees-tool uit deze beurt, zonder `tool` en zonder `as_of`.

Eisen:

1. De schrijfactie slaagt.
2. De payload vult `tool` met de naam van die aanroep.
3. De payload vult `as_of` met het tijdstip van die aanroep.
4. De bronregel toont die toolnaam en dat tijdstip.

Bewijs: payload en scherm.

### F40 Na een weigering herstelt een geldige bron het cijfer

Stappen: laat eerst een stat zonder bron weigeren. Laat in de volgende schrijfactie van dezelfde beurt hetzelfde stat met de echte `tool_use_id` opslaan.

Eisen:

1. De eerste schrijfactie is `invalid`.
2. De tweede schrijfactie slaagt.
3. Het scherm toont het stat.
4. De payload heeft één bronobject met de id van de lees-tool.

Bewijs: activiteit, scherm en payload.

## Visueel

Gebruik voor V01–V16 en V19–V28 een stat met label, waarde, eenheid, hint, delta, doel, status en spark, plus een geldige bron. Taal van de UI is Nederlands, behalve waar een scenario Engels noemt.

### V01 De regel is dicht tot de eerste tik

Stappen: open het canvas met het stat. Tik nog nergens.

Eisen:

1. De waarde is zichtbaar.
2. Er is geen element `canvas-source` in het venster.
3. De tekst van de bronregel komt nergens in de tegel voor.

Bewijs: scherm.

### V02 Eén tik op het cijfer opent de regel

Stappen: tik één keer op de waarde van het stat.

Eisen:

1. De bronregel is open.
2. De tekst is exact `{tool} · {as_of}`.
3. Er was één tik nodig, geen tweede en geen menu.

Bewijs: scherm.

### V03 Een tweede tik sluit de regel

Stappen: tik nog eens op dezelfde waarde.

Eisen:

1. De bronregel is dicht.
2. De waarde is nog zichtbaar.
3. Er is geen tweede regel blijven staan.

Bewijs: scherm.

### V04 Het scheidingsteken is vast

Stappen: open de bronregel.

Eisen:

1. Tussen toolnaam en tijdstip staan precies de tekens spatie, `·`, spatie.
2. Er staat geen komma, koppelteken of schuine streep op die plek.
3. De toolnaam en het tijdstip zijn de twee enige tekstdelen van de regel.

Bewijs: scherm.

### V05 De regel is kleiner en rustiger dan het cijfer

Stappen: open de bronregel en lees de berekende stijl.

Eisen:

1. De fontgrootte van de bronregel is kleiner dan die van de waarde.
2. De kleur van de bronregel is de gedempte tekstkleur, niet de kleur van de kop.
3. De waarde blijft vetter of zwaarder dan de bronregel.

Bewijs: scherm, berekende stijl.

### V06 Het cijfer blijft de grootste tekst in de tegel

Stappen: open de bronregel.

Eisen:

1. De waarde heeft de grootste fontgrootte van alle tekst in die tegel.
2. Label, hint, delta, doel en bronregel zijn allemaal kleiner.
3. De waarde blijft op één regel staan zolang zij korter is dan de tegel.

Bewijs: scherm, berekende stijl.

### V07 De knop meldt of de regel open is

Stappen: lees `aria-expanded` op de knop van de waarde, tik, en lees opnieuw.

Eisen:

1. Vóór de tik is `aria-expanded` `false`.
2. Na de tik is `aria-expanded` `true`.
3. Na de tweede tik is `aria-expanded` weer `false`.

Bewijs: scherm.

### V08 Het testkenmerk bestaat alleen als de regel open is

Stappen: zoek `canvas-source` dicht, open, en weer dicht.

Eisen:

1. Dicht: nul elementen met `data-testid=canvas-source` in dit canvas.
2. Open: precies één zo'n element voor dit stat.
3. Weer dicht: weer nul.

Bewijs: scherm.

### V09 Een tik op het label opent de regel niet

Stappen: tik op het label boven de waarde.

Eisen:

1. De bronregel blijft dicht.
2. De waarde blijft zichtbaar.
3. Het gesprek krijgt geen nieuw bericht.

Bewijs: scherm.

### V10 De hint blijft de hint

Stappen: bekijk de tegel dicht en open.

Eisen:

1. De hinttekst is zichtbaar.
2. De hinttekst is niet gelijk aan de bronregel.
3. Openen van de bronregel verwijdert de hint niet.

Bewijs: scherm.

### V11 De verandering blijft staan

Stappen: bekijk de delta, dicht en open.

Eisen:

1. De deltatekst is zichtbaar.
2. Het pijltje van de trend blijft zichtbaar.
3. De delta staat niet in de bronregel.

Bewijs: scherm.

### V12 Het doel blijft staan

Stappen: bekijk de doelregel, dicht en open.

Eisen:

1. De doeltekst blijft zichtbaar, inclusief het woord Doel.
2. Het doel staat niet in de bronregel.
3. Openen van de bronregel verwijdert het doel niet.

Bewijs: scherm.

### V13 De statusstip blijft staan

Stappen: bekijk het label van een stat met status `good`.

Eisen:

1. De stip bij het label blijft zichtbaar.
2. De stip zit bij het label, niet bij de bronregel.
3. Openen van de bronregel verwijdert de stip niet.

Bewijs: scherm.

### V14 De spark blijft staan

Stappen: bekijk een stat met minstens twee spark-punten, dicht en open.

Eisen:

1. Het kleine vlak onder de tegel blijft zichtbaar.
2. De bronregel neemt de plek van de spark niet over.
3. De spark heeft geen eigen bronregel.

Bewijs: scherm.

### V15 De eenheid blijft naast het cijfer

Stappen: bekijk een stat met een eenheid.

Eisen:

1. De eenheid staat direct naast de waarde, in dezelfde knop.
2. De eenheid is kleiner dan de waarde.
3. De eenheid komt niet terug in de bronregel.

Bewijs: scherm.

### V16 De regel en de knop hebben geen emoji

Stappen: lees de tekst van de tegel, dicht en open.

Eisen:

1. Label, waarde, eenheid, hint, delta, doel en bronregel bevatten geen emoji.
2. De knop heeft geen emoji als icoon.
3. De toegankelijke naam van de knop bevat geen emoji.

Bewijs: scherm.

### V17 Zonder titel heet de tik Bron

Stappen: zet de UI op Nederlands. Sla een staafgrafiek op met een geldige bron en een lege titel.

Eisen:

1. Er is een knop met de zichtbare tekst `Bron`.
2. Eén tik op `Bron` opent de bronregel.
3. De tekst `Bron` is geen vervanging van de bronregel; na de tik zijn beide zichtbaar.

Bewijs: scherm.

### V18 Zonder titel heet de tik Source

Stappen: zet de UI op Engels. Open dezelfde grafiek.

Eisen:

1. Er is een knop met de zichtbare tekst `Source`.
2. Eén tik op `Source` opent dezelfde bronregel als in het Nederlands.
3. De bronregel zelf blijft `{tool} · {as_of}` en wordt niet vertaald.

Bewijs: scherm.

### V19 Hover opent de regel niet

Stappen: beweeg de aanwijzer over de waarde en blijf daar, zonder te tikken.

Eisen:

1. De bronregel blijft dicht.
2. De waarde blijft leesbaar.
3. Er verschijnt geen tooltip met de bron.

Bewijs: scherm.

### V20 Enter wisselt de regel

Stappen: focus de waardeknop met het toetsenbord en druk Enter. Druk nog eens Enter.

Eisen:

1. Na de eerste Enter is de bronregel open.
2. Na de tweede Enter is de bronregel dicht.
3. De focus blijft op de knop.

Bewijs: scherm.

### V21 Spatie wisselt de regel

Stappen: focus de waardeknop en druk Spatie. Druk nog eens Spatie.

Eisen:

1. Na de eerste Spatie is de bronregel open.
2. Na de tweede Spatie is de bronregel dicht.
3. De pagina scrollt niet weg van de tegel door de Spatie.

Bewijs: scherm.

### V22 De buur blijft dicht

Stappen: zet twee stats naast elkaar. Open alleen de linker.

Eisen:

1. De linker bronregel is open.
2. De rechter bronregel is dicht.
3. Er is precies één `canvas-source` in het venster.

Bewijs: scherm.

### V23 Het cijfer blijft helemaal zichtbaar

Stappen: open de bronregel in het zijpaneel.

Eisen:

1. De waarde wordt niet afgesneden.
2. De waarde schuift niet buiten de tegel.
3. De bronregel staat onder de waarde, in dezelfde tegel.

Bewijs: scherm.

### V24 De regel hoort bij de tegel

Stappen: open de bronregel en meet de positie.

Eisen:

1. De bronregel ligt binnen de tegel, niet in de titelbalk en niet in het gesprek.
2. De bovenkant van de bronregel ligt onder de onderkant van de waarde.
3. De regel overlapt de waarde niet.

Bewijs: scherm.

### V25 Het smalle paneel blijft binnen de pagina

Stappen: open de bronregel in het zijpaneel naast het gesprek, met een toolnaam van minstens 24 tekens.

Eisen:

1. De pagina krijgt geen horizontale scrollbalk door de bronregel.
2. De bronregel breekt of blijft binnen de tegel.
3. De waarde blijft leesbaar.

Bewijs: scherm.

### V26 De cijferknop heeft geen gevulde accentkleur

Stappen: lees de berekende achtergrond van de waardeknop, dicht en open.

Eisen:

1. De achtergrond is transparant.
2. De tekstkleur van de waarde is de kopkleur, niet de accentkleur op een gevulde knop.
3. Openen verandert de achtergrond van de waarde niet naar een gevulde knop.

Bewijs: scherm, berekende stijl.

### V27 Een lange toolnaam blijft in de tegel

Stappen: gebruik een lees-tool met een lange naam, open de bronregel in het zijpaneel.

Eisen:

1. De hele toolnaam is leesbaar, eventueel op een tweede regel binnen de tegel.
2. De naam loopt niet over de volgende tegel heen.
3. Het tijdstip blijft zichtbaar.

Bewijs: scherm.

### V28 Herladen begint dicht

Stappen: open de bronregel, herlaad de pagina, open hetzelfde canvas.

Eisen:

1. De bronregel is dicht.
2. Eén tik opent dezelfde tekst als vóór de herlaad.
3. De waarde is meteen zichtbaar, zonder eerst de regel te moeten openen.

Bewijs: scherm.

## Bronregel op het dashboard

### D01 Drie kerncijfers hebben elk een eigen regel

Stappen: vraag een dashboard met een kop en drie stats, elk met een geldige bron. Open ze één voor één.

Eisen:

1. Dicht zijn er nul bronregels.
2. Na één tik op het eerste cijfer is alleen die regel open.
3. Na een tik op het tweede cijfer zijn twee regels open, elk met de bron van dat stat.
4. De drie teksten kloppen met de drie bronobjecten in de payload.

Bewijs: scherm en payload.

### D02 De titel van een staafgrafiek is de tik

Stappen: sla een staafgrafiek op met titel `Instroom` en een geldige bron.

Eisen:

1. De titel `Instroom` is een knop.
2. Eén tik op `Instroom` opent de bronregel onder de titel of direct bij de grafiek, binnen hetzelfde blok.
3. De grafiek zelf blijft zichtbaar.

Bewijs: scherm.

### D03 De titel van een lijngrafiek is de tik

Stappen: sla een lijngrafiek op met een titel en een geldige bron.

Eisen:

1. De titel is een knop.
2. Eén tik opent één bronregel.
3. De lijn blijft zichtbaar.

Bewijs: scherm.

### D04 De titel van een vlakgrafiek is de tik

Stappen: sla een vlakgrafiek op met een titel en een geldige bron.

Eisen:

1. De titel is een knop.
2. Eén tik opent één bronregel.
3. Het vlak blijft zichtbaar.

Bewijs: scherm.

### D05 De titel van een taart is de tik

Stappen: sla een taart op met een titel en een geldige bron.

Eisen:

1. De titel is een knop.
2. Eén tik opent één bronregel.
3. De parten blijven zichtbaar.

Bewijs: scherm.

### D06 De titel van een tabel is de tik

Stappen: sla een tabel op met titel `Wachtrij` en een geldige bron.

Eisen:

1. `Wachtrij` is een knop.
2. Eén tik opent één bronregel.
3. De kolommen en rijen blijven zichtbaar.
4. Een tik op een cel opent de regel niet.

Bewijs: scherm.

### D07 Een grafiek zonder titel gebruikt Bron

Stappen: Nederlandse UI. Sla een staafgrafiek op zonder titel, met een geldige bron.

Eisen:

1. De knoptekst is `Bron`.
2. Eén tik opent de bronregel.
3. Er staat geen lege kop boven de grafiek.

Bewijs: scherm.

### D08 Een tabel zonder titel gebruikt Bron

Stappen: Nederlandse UI. Sla een tabel op zonder titel, met een geldige bron.

Eisen:

1. De knoptekst is `Bron`.
2. Eén tik opent de bronregel.
3. De tabelkoppen blijven de kolomnamen.

Bewijs: scherm.

### D09 Een taart zonder titel gebruikt Bron

Stappen: Nederlandse UI. Sla een taart op zonder titel, met een geldige bron.

Eisen:

1. De knoptekst is `Bron`.
2. Eén tik opent de bronregel.
3. De parten blijven zichtbaar.

Bewijs: scherm.

### D10 Een brede grafiek heeft één regel

Stappen: sla een grafiek op met `wide` waar en een geldige bron.

Eisen:

1. De grafiek gebruikt de volle breedte van het canvasvlak.
2. Er is één titelknop en, na een tik, één bronregel.
3. De payload heeft één bronobject op dat blok.

Bewijs: scherm en payload.

### D11 Twee grafieken naast elkaar hebben twee regels

Stappen: sla twee grafieken naast elkaar op, met verschillende bronnen.

Eisen:

1. Elke titel is een eigen knop.
2. Een tik op de linker opent alleen de linker regel.
3. Een tik op de rechter opent de rechter regel zonder de linker te sluiten.
4. De twee regels noemen de twee verschillende tools of tijdstippen uit de payload.

Bewijs: scherm en payload.

### D12 Vier stats in één rij

Stappen: sla vier stats op in één keer, elk met een geldige bron.

Eisen:

1. De vier waarden staan in één rij zolang het venster breed genoeg is.
2. Elke waarde is een eigen knop.
3. Dicht zijn er nul bronregels.
4. Elke tik opent alleen de regel van die waarde.
5. De payload heeft vier bronobjecten.

Bewijs: scherm en payload.

### D13 Een stat in een kaart opent binnen de kaart

Stappen: sla een kaart op met een titel en één stat met een geldige bron.

Eisen:

1. Een tik op de kaarttitel opent geen bronregel.
2. Een tik op de waarde opent de bronregel binnen de kaart.
3. De bron in de payload staat op het stat.

Bewijs: scherm en payload.

### D14 Een grafiek in een kaart opent via de grafiektitel

Stappen: sla een kaart op met daarin een grafiek die een eigen titel en een geldige bron heeft.

Eisen:

1. Een tik op de kaarttitel opent geen bronregel.
2. Een tik op de grafiektitel opent één bronregel.
3. De bron in de payload staat op de grafiek.

Bewijs: scherm en payload.

### D15 Kop en callout hebben geen tik voor een bron

Stappen: open een dashboard met een kop, een callout en één stat met bron.

Eisen:

1. De kop is geen knop die een bronregel opent.
2. De callout is geen knop die een bronregel opent.
3. Alleen het stat opent een bronregel.

Bewijs: scherm.

### D16 Een nieuw cijfer krijgt de nieuwe bron

Stappen: sla een stat op vanuit lees-tool A. Laat in een nieuw bericht lees-tool B de waarde wijzigen en hetzelfde stat opnieuw schrijven.

Eisen:

1. De zichtbare waarde is de nieuwe waarde.
2. De bronregel noemt tool B en het tijdstip van B.
3. De payload heeft de `tool_use_id` van B.
4. De id van A staat niet meer op dat stat.

Bewijs: scherm en payload.

### D17 Een oud dashboard toont geen lege bronknop

Stappen: open het dashboard uit F16, zonder `tool_use_id`.

Eisen:

1. Cijfers zijn gewone tekst of hebben geen bronregel na een tik op de waarde.
2. Er is geen knop `Bron` zonder bronobject.
3. Er is geen element `canvas-source`.

Bewijs: scherm.

### D18 Terugkeren naar het gesprek bewaart de bron

Stappen: open de bronregel, ga naar een ander gesprek, kom terug naar `Bron-suite` en open het canvas opnieuw.

Eisen:

1. De regel begint dicht.
2. Eén tik toont dezelfde tekst als vóór het wegnavigeren.
3. De payload is ongewijzigd.

Bewijs: scherm en payload.

### D19 Zijpaneel en volledig scherm tonen dezelfde regel

Stappen: open de bronregel in het zijpaneel. Vergroot het canvas. Open de regel daar ook.

Eisen:

1. Beide plekken tonen dezelfde waarde.
2. Beide bronregels hebben exact dezelfde tekst.
3. In beide plekken begint de regel dicht na het openen van het venster.

Bewijs: scherm.

### D20 De legenda blijft naast de bronregel

Stappen: sla een grafiek op met twee series en een geldige bron. Open de bronregel.

Eisen:

1. De namen van de twee series blijven zichtbaar.
2. De bronregel is een aparte regel, niet samengevoegd met de series.
3. De seriesregel bevat niet de toolnaam, tenzij een serienaam toevallig gelijk is aan de tool.

Bewijs: scherm.

### D21 Een lege grafiek heeft geen bronknop

Stappen: toon een grafiekblok zonder punten, als het venster die staat kan laten zien, of een canvas waarop de lege-grafiektekst staat.

Eisen:

1. De tekst `Deze grafiek heeft geen data.` is zichtbaar bij een Nederlandse UI.
2. Die melding is geen bronknop.
3. Er is geen `canvas-source` bij die melding.

Bewijs: scherm.

### D22 De regel verbergt de aanroep-id

Stappen: open een bronregel waarvan de payload een `tool_use_id` heeft.

Eisen:

1. De zichtbare regel bevat de toolnaam en het tijdstip.
2. De zichtbare regel bevat de `tool_use_id` niet.
3. De id staat wel in de payload.

Bewijs: scherm en payload.

### D23 De regel is geen query en geen adres

Stappen: open een bronregel van een cijfer dat uit een lees-tool kwam.

Eisen:

1. De regel bevat geen `SELECT` en geen `http`.
2. De regel bevat geen bestandspad.
3. De regel bestaat uit toolnaam, scheidingsteken en tijdstip.

Bewijs: scherm.

### D24 De regel is gelijk aan de payload

Stappen: open de bronregel en lees naast elkaar de tekst en `source` in de payload.

Eisen:

1. Het deel vóór ` · ` is gelijk aan `source.tool`.
2. Het deel ná ` · ` is gelijk aan `source.as_of`.
3. Er staat geen derde deel in de regel.

Bewijs: scherm en payload.

### D25 Een tik stuurt geen bericht

Stappen: noteer het laatste bericht in het gesprek. Tik twee keer op een cijfer.

Eisen:

1. Er komt geen nieuw bericht in het gesprek.
2. Er start geen nieuwe agentbeurt.
3. Het activiteitenpad krijgt geen nieuwe tool-aanroep.

Bewijs: scherm en activiteit.

### D26 Een tik wisselt de pagina niet

Stappen: noteer het pad in de adresbalk. Tik op het cijfer en op de grafiektitel.

Eisen:

1. Het pad in de adresbalk blijft gelijk.
2. Het canvasvenster blijft open.
3. Het gesprek blijft het gesprek `Bron-suite`.

Bewijs: scherm.

### D27 Het canvasvenster sluiten begint de volgende keer dicht

Stappen: open de bronregel, sluit het canvasvenster, open het opnieuw vanuit het gesprek.

Eisen:

1. De regel is dicht.
2. Eén tik opent dezelfde tekst.
3. De payload is ongewijzigd.

Bewijs: scherm en payload.

### D28 Een collega in dezelfde werkruimte ziet dezelfde regel

Stappen: open hetzelfde canvas met een tweede gebruiker van dezelfde werkruimte.

Eisen:

1. De tweede gebruiker ziet dezelfde waarde.
2. De regel begint dicht.
3. Eén tik toont dezelfde `{tool} · {as_of}` als bij de eerste gebruiker.
4. De tweede gebruiker hoeft niet opnieuw een lees-tool te draaien.

Bewijs: scherm.

### D29 De regel staat op het canvas, niet in de chat

Stappen: laat de agent een dashboard schrijven en lees de chatbubbel en het canvas.

Eisen:

1. De chatbubbel bevat de bronregel niet als losse regel onder een geplakt cijfer.
2. Het cijfer staat in het canvasvenster.
3. De bronregel opent in dat venster.

Bewijs: scherm.

### D30 Alleen cijferblokken hebben een regel

Stappen: vraag één dashboard met een kop, een tekst, een callout, drie stats, één grafiek, één taart en één tabel. Geef elk cijferblok een geldige bron.

Eisen:

1. Kop, tekst en callout openen geen bronregel.
2. Elk stat, de grafiek, de taart en de tabel openen na één tik precies één bronregel.
3. Dat zijn zeven bronregels als ze allemaal open staan.
4. De payload heeft zeven bronobjecten, één per cijferblok.
5. Dicht zijn er nul elementen `canvas-source`.

Bewijs: scherm en payload.

## Logboek

Maak `docs/plans/canvas-block-source-suite-log.md` pas bij de eerste poging. Zet er deze kop boven en vul één regel per poging:

```text
| Scenario | Poging | Resultaat | Onware eisen | Wat het scherm of de payload toonde | Wijziging |
| F01 | 1 | geslaagd | — | stat Open, source list_threads, as_of 2026-10-22T17:40:00 | — |
```

Sluit het logboek af met: `98 scenario's, 98 geslaagd` en de hoogste poging per scenario. Een lager aantal geslaagd betekent dat de suite niet af is.

## Startblok

Plak dit pas als de suite gedraaid moet worden:

```text
Voer docs/plans/canvas-block-source-suite.md uit op https://dev.app.bokito.ai.
Werk F01 tot en met D30 af in volgorde.
Per scenario: voer uit, beoordeel elke eis, log in docs/plans/canvas-block-source-suite-log.md.
Bij een onware eis: fix alleen die eis, zet de fix op dev, en doe hetzelfde scenario opnieuw tot het slaagt.
Ga daarna pas verder. Lever aan het eind het logboek en de telling.
```
