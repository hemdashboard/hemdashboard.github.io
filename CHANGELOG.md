# Changelog

## 0.6.2 – 2026-11-01
- Ingen PIN (beslut 35). Anslutningsuppgifterna krypteras med AES-GCM och en icke-exporterbar nyckel i webbläsaren (WebCrypto i IndexedDB) och öppnas automatiskt. Nyckeln ligger aldrig i klartext i lagringen. Telefonens skärmlås är spärren mot den som håller i telefonen.
- Uppdatering från PIN-versionen: PIN anges en sista gång, sedan flyttas nyckeln till den nya lagringen.
- Lås-knappen borttagen. Glöm nyckeln raderar både uppgifterna och den lokala krypteringsnyckeln.
- Testsidan: versionsrubriken hämtas ur koden, reglagetexten följer regeln, dubblerad ramspärr borttagen, formuläret dolt tills sidan startat.
- Städning: oanvända exporter borttagna.
- Cache `hd-shell-v0.6.2`.

## 0.6.1 – 2026-11-01
- Planritning: trappan går att koppla på båda planen (t.ex. till trapphuset) och altanen till uteplatsens zon.
- Ny ritning Utomhus med Framsidan och Förråd (fristående, schematiskt). Förrådet under trappan ritas men kopplas inte, så att Förråd kopplas automatiskt till rätt zon.
- Cache `hd-shell-v0.6.1`.

## 0.6.0 – 2026-11-01
- Planritningen är inbyggd: schematisk ritning av entréplan och övre plan med rumstyper (beslut 33). Ingen uppladdning längre.
- Koppla rum: tryck på en yta och välj appens rum. Entydiga namn kopplas automatiskt. Kopplingen sparas lokalt.
- Ytorna fylls när en lampa är tänd, får blå kant vid rörelse senaste minuten och gul kant när dörr eller fönster står öppet.
- Den uppladdade bilden från 0.5.0 raderas ur webbläsaren (IndexedDB `hd-plans`).
- Cache `hd-shell-v0.6.0`.

## 0.5.1 – 2026-11-01
- Stjärna på varje reglage (lampor och kaffebryggare): stjärnmärkta visas även under Snabbreglage på Hem. Sparas lokalt i webbläsaren som enhets-ID. Utan sparade stjärnor visas kaffebryggarna. Stjärnan ändrar inte reglageregeln.
- Cache `hd-shell-v0.5.1`.

## 0.5.0 – 2026-11-01
- Kaffebryggare som strömbrytare: ett uttag markerat som kaffebryggare i Homey (`class` socket, `virtualClass` coffeemachine) får reglage för `onoff`, även i skrivvägen (beslut 32). Snabbreglage på Hem.
- Regelkontrollen visar varför lampor och kaffebryggare saknar reglage (klass, otillgänglig, ej skrivbar), utan namn eller ID.
- Rörelsesensorer: ikon som lyser vid rörelse senaste minuten och tid för senaste rörelse i stället för "Ingen rörelse". Realtid sätter `lastUpdated`.
- Närvaro på Hem: initial, hemma/borta och sedan när, från enheter med `presence`. Närvaroenheter visar Hemma/Borta i rumsvyn.
- Planritning överst i Rum: egen bild som laddas upp och sparas lokalt (IndexedDB), rum placeras genom att trycka på bilden, punkterna visar tänt, rörelse och öppet. Tryck på ett rum öppnar det.
- Energiflöde nät → hus → laddbox på Hem när en laddbox laddar, animerat efter effekt. Endast visning.
- Cache `hd-shell-v0.5.0`.

## 0.4.0 – 2026-11-01
- Ny stil efter vald mockup: neutral grafit utan blå ton, tunna ramar, små radier (6–12 px), rubriker och etiketter i vanlig sans i stället för versal mono, tabellsiffror.
- Nyckeltalsrad överst på Hem och El: effekt nu, i dag, månaden och pris nu, med trendbricka (effekt och pris mot snittet i dag, förbrukning mot samma klockslag de senaste dygnen). 2×2 på mobil, en rad på dator.
- Meny med ikoner: nederkant på mobil, sidomeny till vänster på dator (från 1080 px).
- (i) ligger som ikonknapp i kortets övre högra hörn och öppnar förklaringen som en panel.
- Diagram: tunt rutnät i båda led, effekt i lila, pris i orange, staplar neutrala, mint för billigaste fönster.
- Periodknappar och rumschips med neutral markering; accenten används för status.
- Diagrammens bredd räknas från den faktiska ytan.
- Insikter: förbrukning hittills flyttad till nyckeltalen.
- Cache `hd-shell-v0.4.0`.

## 0.3.3 – 2026-11-01
- Rättat: alla Insights-hämtningar gav 404 i 0.3.2. Adaptern kortade loggens id (`homey:device:<x>:energy_power` → `energy_power`), men Homey kräver hela id:t i sökvägen (O 1/11). Id:t skickas nu oförändrat, som i 0.3.1 och testsidan.
- Cache `hd-shell-v0.3.3`.

## 0.3.2 – 2026-11-01
- Rättat: oändlig loop i timfördelningen när 30-dagarsdata korsar omställningen till vintertid (02:00 finns två gånger). `startOfHour` räknar nu i UTC, och loopen har en spärr mot att stå still.
- Effektlinjen i förbrukningsdiagrammet syntes inte: Pulse loggar effekt som `energy_power`, inte `measure_power` (O 1/11). Båda prövas nu, och förklaringen visas bara när linjen finns.
- Tibbers pris i Insights är en applogg per hem (`homey:app:com.tibber:…_price`, O 1/11). Den hittas nu (hemmet väljs på namnet), så prisbakgrunden och månadens kostnad fungerar.
- Hem: rumskortet borttaget och ersatt av Insikter – varmvatten, förbrukning hittills mot vanligt vid samma tid, effekttopp i dag, snittpris i dag mot pris nu.
- NIBE och andra enheter med egna capabilities (`capability_N`) visar nu värden med titel. Varmvatten (BT7, annars BT6) visas först.
- Förklaringar (hur något räknas ut, källor) ligger bakom en (i)-knapp i stället för som text under korten.
- Rum: knapparna överst väljer vilka rum som visas, flera går att välja, Alla visar alla. Valet sparas lokalt.
- Tillverkaren (appen) visas inom parentes efter enhetsnamnet, t.ex. (Plejd), (Hue), (NIBE).
- Cache `hd-shell-v0.3.2`.

## 0.3.1 – 2026-11-01
- Rumsvyn omgjord: alla rum som kort under varandra, grupperade per våning (överordnad zon), med hopplänkar som radbryts. Ingen sidledsscroll.
- Rumsvyn byggs bara om när rum eller enheter ändras. Annars uppdateras värdena på plats, så att realtid och pollning inte flyttar sidan eller avbryter ett reglage. Dimmern visas bara när lampan är på.
- Översiktens rumskort öppnar rumsvyn vid rätt rum.
- Förbrukningsdiagrammet visar priset som bakgrund: Tibbers totalpris ur Insights (per timme i dag, dygnsmedel för 7/30 dygn) med egen skala till höger. Spotpris som reserv för i dag.
- Väder: "Närmaste dygnet" i översikten och vädervyn – när regn eller snö börjar och slutar och ungefär hur mycket, minusgrader eller frostrisk, hårda vindbyar, temperaturspann. Soluppgång och solnedgång beräknas lokalt (`js/core/sun.js`), och natt-ikoner följer verklig sol.
- Telegram-texten i vädervyn borttagen.
- PWA: PNG-ikoner 192/512 och maskable, `id` i manifestet, knappen Installera appen och Sök efter uppdatering i Inställningar. En ny version tar över automatiskt och sidan laddas om en gång – ingen ominstallation.
- Tips: fönster börjar på periodgräns (jämna tider).
- Pris visas som läsvärde på prisenheten i Rum.
- Cache `hd-shell-v0.3.1`.

## 0.3.0 – 2026-10-31
- Hela dashboarden i en första version: Hem (översikt), El, Väder, Rum och Inställningar med nedre fält.
- Reglage för klass `light` och `coffeemachine` (beslut 31), i rendering och skrivväg. `coffeemachine` får bara `onoff`.
- Automatiska rum: varje zon med enheter blir ett rum, rotzonen blir Övrigt, tomma zoner döljs. Egna rum från 0.2 ligger kvar som override.
- El: effekt nu (realtid), förbrukning i dag per timme och 7/30 dygn per dygn ur Insights, kostnad i dag och månaden hittills, prisenhetens pris nu.
- Spotpris i dag och i morgon (elprisetjustnu.se) som diagram med billigaste fönster och pristoppar; prisenhetens pris i dag som linje i samma skala.
- Smarta tips: billigaste 3 och 5 timmar inom 24 timmar, pristoppar. Endast pris.
- Väder från SMHI: nu, 24 timmar och 6 dygn. Position från Homey, avrundad.
- Egna SVG-diagram och väderikoner (`js/core/svg.js`), inga bibliotek.
- CSP i `index.html`: `connect-src` utökad med SMHI och elprisetjustnu.se, som `lab.html` redan hade.
- Realtid för alla enheter i stället för bara det valda rummet.
- Kontroll i Inställningar: regelkontroll över alla enheter och anonym diagnos per datakälla.
- Testsidan: 4r prövar light och coffeemachine.
- Cache `hd-shell-v0.3.0`.

## 0.2.1 – 2026-10-31
- Ingen anslutning visas som eget läge med felkategori per väg (moln/lokalt, t.ex. `network`, `timeout`, `http-401`) och knappen Försök igen, i stället för en tom rumsvy. Nytt försök var 30:e sekund medan appen är öppen och vid återkomst från bakgrunden.
- Rumsvyns rubriker döljs tills data finns.
- Cache `hd-shell-v0.2.1`.

## 0.2.0 – 2026-10-31
- Reglage endast för enheter med `class === 'light'` (inte `virtualClass`), tillgängliga, och bara `onoff`/`dim` (beslut 30). Ersätter K-regeln och den egna K-listan; `kguard.js` borttagen, ny `controls.js`.
- Skrivvägen: `homey.control(device, cap, value)` är enda skrivanropet och prövar regeln före varje anrop. Råa `setCapability` borttagen.
- Gammal lokal K-lista (`hd.k.local.v1`) rensas ur lagringen vid start.
- Rumsvy i `index.html`: rum → zon kopplas i appen och sparas lokalt. Lampor med på/av och dimmer, övriga enheter läsande, otillgängliga utan reglage.
- Realtid per enhet med återanslutning; polling var 15 s när realtid saknas. Allt läses om när appen kommer tillbaka från bakgrunden.
- Regelkontroll i Inställningar: räknar ritade reglage mot regeln.
- Testsidan: test 4k ersatt av 4r (reglage endast för klass light), K-markeringar borttagna.
- Cache `hd-shell-v0.2.0`.

## 0.1.5 – 2026-10-31
- Flytt till egen origin `hemdashboard.github.io` (beslut 25).
- CSP: Trusted Types krävs i båda sidorna; policyn `hd-sw` tillåter bara `./sw.js`.
- Ramspärr: `lab.html` visas inte i en ram (meta-CSP saknar `frame-ancestors`).
- K-spärr även i skrivvägen (`runToggle`), inte bara i renderingen.
- Keystore: iterationstalet i lagringen kan inte sänka skyddet; korrupt lagring räknas som fel PIN i stället för ohanterat fel.
- Cache `hd-shell-v0.1.5`.

## 0.1.4 – 2026-10-31
- Test 5: prenumererar även per enhet (homey:device:<id>) för enheter med reglage och redovisar kvittenser, händelser per kanal och händelsetyper – utan ID eller värden.
- Cache `hd-shell-v0.1.4`.

## 0.1.3 – 2026-10-31
- Service worker: egna filer hämtas med omvalidering (`cache: 'no-cache'`) så att en release syns vid nästa omladdning trots Pages cachetid.
- Test 2: lokal timeout visas som varning (väntat utanför hemmanätet), som nätverksfel redan gjorde.
- Cache `hd-shell-v0.1.3`.

## 0.1.2 – 2026-10-31
- Test 5: realtidsprovet följer handskakningen på rotnamnrymden (handshakeClient → namnrymd → subscribe) och rapporterar varje steg. Varning i stället för fel när prenumerationen lyckas men inget händer under minuten.
- Cache `hd-shell-v0.1.2`.

## 0.1.1 – 2026-10-31
- Test 12: Homeys position hämtas från optionen location med /geolocation/ som reserv, och felkategorin redovisas.
- Test 7: sammanfattningen visar inte längre hur många som är hemma (förmåga, inte närvaroläge).
- Cache `hd-shell-v0.1.1`.

## 0.1.0 – 2026-10-31
- Testsida `lab.html` som prövar: moln- och lokal anslutning med API-nyckel, läsa och styra enheter, K-spärr i UI, realtid via WebSocket, närvaro, Insights, spotpris och SMHI. Anonym resultatsammanfattning.
- Grund för appen: keystore, http-lager, K-regel, adaptrar för Homey, SMHI och spotpris, designtokens, CSP, manifest och service worker (cache `hd-shell-v0.1.0`).
