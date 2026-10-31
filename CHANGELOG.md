# Changelog

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
