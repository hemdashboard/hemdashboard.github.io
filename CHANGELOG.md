# Changelog

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
