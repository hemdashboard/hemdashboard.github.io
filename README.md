# Hemdashboard

Egen PWA som visar husets status och låter hushållet slå av och på enheter via Homey. Statisk sida på GitHub Pages, vanilla JS utan byggsteg.

**Repot innehåller ingen husdata.** Enheter, zoner och användare hämtas från Homey vid körning. Nycklar, Homey-ID, IP-adresser och positioner anges i webbläsaren och sparas krypterade lokalt – aldrig här.

## Status
Version 0.5.0: hela dashboarden – översikt med närvaro och energiflöde vid laddning, el, smarta tips, väder, rum med planritning och rörelse, installerbar som app. Testsidan `lab.html` finns kvar för diagnos.

## Vyer
| Vy | Innehåll |
|---|---|
| Hem | Översikt: nyckeltal med trendbricka (effekt nu, i dag, månaden, pris nu), energiflöde nät → hus → laddbox när en laddbox laddar, närvaro per person (hemma/borta), snabbreglage för kaffebryggare, smarta tips, väder med närmaste dygnet och insikter (varmvatten, förbrukning mot vanligt, effekttopp, snittpris) |
| El | Nyckeltal, förbrukning i dag per timme och 7/30 dygn per dygn (Insights) med priset som bakgrund, spotpris i dag och i morgon, tips |
| Väder | SMHI: nu, närmaste dygnet i klartext (nederbörd, kyla, vind), sol upp/ned, 24 timmar och 6 dygn |
| Rum | Planritning överst (lokal bild med rummen utplacerade: tänt, rörelse, öppet). Ett kort per Homey-zon med enheter, grupperade per våning. Knapparna överst väljer vilka rum som visas. Tillverkare inom parentes. Reglage enligt regeln nedan |
| Inst. | Elområde, val av elmätare och prisenhet, egna rum, kontroll och diagnos |

## Reglage
Reglage finns **endast för enheter med klassen `light` eller `coffeemachine`** (enhetens `class`, inte `virtualClass`) som är tillgängliga. Enda undantaget: ett uttag (`class` `socket`) som i Homey markerats som kaffebryggare (`virtualClass` `coffeemachine`) räknas som `coffeemachine` (beslut 32). Regelkontrollen under Inställningar visar, utan namn, varför enheter som ser ut som lampa eller kaffebryggare saknar reglage. `onoff` och `dim` för `light`, bara `onoff` för `coffeemachine`. Allt annat – uttag, sensorer, termostater, lås och kameror – visas utan reglage. Saknad eller okänd klass ger inget reglage. Regeln ligger i `js/core/controls.js` och prövas både när reglaget ritas och i skrivvägen (`homey.control`), som är appens enda väg att skriva till Homey. Ingen lista eller markering per enhet finns i appen. Fler klasser kräver ett nytt beslut.

## Rum
Varje Homey-zon med egna enheter blir ett rum automatiskt, i zonträdets ordning. Enheter i rotzonen visas under Övrigt, och tomma zoner döljs. Egna rum kan läggas till under Inställningar (namn, zon, valfritt med underzoner) och ersätter då de zoner de täcker. Egna rum sparas lokalt i webbläsaren. Repot innehåller inga rum, zoner eller namn.

## Närvaro, rörelse och laddning
- **Närvaro:** enheter med capability `presence` (t.ex. Smart Presence) visas på Hem med initial, hemma/borta och när läget ändrades. Inga profilbilder; namn och läge läses vid körning.
- **Rörelse:** sensorer med `alarm_motion` får en ikon som lyser vid rörelse nu eller senaste minuten och tid för senaste rörelse (`capabilitiesObj.alarm_motion.lastUpdated`, uppdaterad av realtid).
- **Energiflöde:** när en laddbox (`evcharger`) laddar visas nät → hus → laddbox. Nät = vald elmätare, laddbox = laddboxens `measure_power`, huset = skillnaden. Endast visning.

## Planritning
Ritningen är husdata och finns aldrig i repot. Den laddas upp i appen (PNG, JPEG eller WebP), skalas ned till högst 1600 px och sparas i webbläsarens IndexedDB tillsammans med rummens placering i procent. Upp till fyra ritningar (t.ex. per våning). Varje webbläsare har sina egna. Bilden visas inverterad i gråskala för mörkt tema.

## El och tips
- **Elmätare:** enheten med `measure_power` och en energimätare väljs automatiskt (en mätare med `accumulatedCost` och `meter_power.imported` först) eller i Inställningar. Valet sparas lokalt.
- **Effekt i Insights:** `measure_power`, annars `energy_power` (Tibber Pulse loggar bara den).
- **Pris i Insights:** prisenhetens `measure_price_total`, annars Tibber-appens applogg per hem (`…_price`), vald på hemmets namn.
- **Förbrukning:** ur Homey Insights (`homey.insights.readonly`), som skillnader i en räknande mätare. En mätare som nollställs vid midnatt hanteras också.
- **Kostnad i dag:** mätarens `accumulatedCost` (Tibbers egen beräkning). Månaden: summan av varje dygns högsta `accumulatedCost` ur Insights plus i dag. Saknas den: förbrukning × prisenhetens pris per timme ur Insights.
- **Spotpris:** elprisetjustnu.se, kvartspriser visade som timmedel, exkl. moms och avgifter. Prisenhetens totalpris i dag ritas som linje i samma skala.
- **Tips:** billigaste sammanhängande 3 och 5 timmar som börjar inom 24 timmar, samt pristoppar (dygnets tre dyraste timmar och timmar minst 50 % över dygnets median). Bygger enbart på pris.

## Struktur
| Fil | Roll |
|---|---|
| `index.html` | Appen |
| `lab.html`, `js/lab/` | Testsida och diagnossida |
| `js/core/keystore.js` | Nyckel + anslutningsuppgifter, PIN-krypterade (PBKDF2 → AES-GCM) |
| `js/core/http.js` | fetch med tidsgräns och generiska felkategorier |
| `js/core/controls.js` | Reglageregeln: endast klass `light` och `coffeemachine`, i rendering och skrivväg |
| `js/core/rooms.js` | Automatiska rum per zon, egna rum sparade lokalt |
| `js/core/activity.js` | Rörelse, närvaro, laddning och energiflöde ur enheterna |
| `js/core/planstore.js` | Planritningar i IndexedDB, endast lokalt |
| `js/core/energy.js`, `js/core/prices.js`, `js/core/weather.js`, `js/core/sun.js`, `js/core/devinfo.js` | Rena beräkningar: förbrukning och kostnad, spotpris och tips, SMHI-tolkning och utsikt, sol upp/ned, tillverkare och varmvatten per enhet |
| `js/core/svg.js` | Egna diagram och väderikoner i SVG |
| `js/app/` | Vyerna: `main.js` (start, anslutning, navigering, inställningar), `energy.js`, `weather.js`, `roomsview.js`, `plan.js`, `home.js`, `insights.js`, `state.js`, `ui.js` |
| `js/adapters/homey.js` | Homey Web API, moln och lokalt, realtid |
| `js/adapters/smhi.js` | SMHI-prognos |
| `js/adapters/spotpris.js` | Spotpris per elområde (elprisetjustnu.se) |
| `css/tokens.css`, `css/lab.css`, `css/app.css` | Designtokens, baslager, rumsvy |
| `sw.js`, `manifest.webmanifest` | PWA-skal |

## Installera och uppdatera
Öppna sidan i Chrome på Android och välj Installera appen (Inställningar) eller Chromes meny → Lägg till på startskärmen. Uppdateringar kräver ingen ominstallation: service workern hämtar egna filer från nätet först, och när en ny version (ny `CACHE` i `sw.js`) publiceras tar den över och appen laddas om en gång. Höj `CACHE` och `APP_VERSION` vid varje release.

## Säkerhet
- Content-Security-Policy i varje sida: bara egna skript, nätanrop endast till Homey (moln/lokalt), SMHI och elprisetjustnu.se.
- Trusted Types krävs (`require-trusted-types-for 'script'`); enda policyn gäller service workerns URL.
- Ramspärr i skript: meta-CSP kan inte sätta `frame-ancestors`, så sidan visas inte om den ligger i en ram.
- Egen origin (`hemdashboard.github.io`). Inga andra repon i organisationen får ha GitHub Pages, eftersom de skulle dela origin.
- Inga tredjepartsskript, bibliotek eller CDN. Diagrammen är egen SVG.
- API-nyckeln är personlig per användare och återkallas genom att den raderas i Homey.
- PIN-krypteringen skyddar mot en lånad eller upplåst telefon, inte mot någon med full åtkomst till enheten.

## Källor för data
- Väder: SMHI, öppna data.
- Elpris: elprisetjustnu.se.
