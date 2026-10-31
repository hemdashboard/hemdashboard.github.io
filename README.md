# Hemdashboard

Egen PWA som visar husets status och låter hushållet slå av och på enheter via Homey. Statisk sida på GitHub Pages, vanilla JS utan byggsteg.

**Repot innehåller ingen husdata.** Enheter, zoner och användare hämtas från Homey vid körning. Nycklar, Homey-ID, IP-adresser och positioner anges i webbläsaren och sparas krypterade lokalt – aldrig här.

## Status
Version 0.3: hela dashboarden i en första version – översikt, el, smarta tips, väder och rum. Testsidan `lab.html` finns kvar för diagnos.

## Vyer
| Vy | Innehåll |
|---|---|
| Hem | Kort för el (effekt nu, i dag, månaden, pris nu), smarta tips, väder och rum |
| El | Effekt och kostnad, förbrukning i dag per timme och 7/30 dygn per dygn (Insights), spotpris i dag och i morgon, tips |
| Väder | SMHI: nu, 24 timmar och 6 dygn. Endast visning |
| Rum | Ett rum per Homey-zon med enheter, reglage enligt regeln nedan |
| Inst. | Elområde, val av elmätare och prisenhet, egna rum, kontroll och diagnos |

## Reglage
Reglage finns **endast för enheter med klassen `light` eller `coffeemachine`** (enhetens `class`, inte `virtualClass`) som är tillgängliga: `onoff` och `dim` för `light`, bara `onoff` för `coffeemachine`. Allt annat – uttag, sensorer, termostater, lås och kameror – visas utan reglage. Saknad eller okänd klass ger inget reglage. Regeln ligger i `js/core/controls.js` och prövas både när reglaget ritas och i skrivvägen (`homey.control`), som är appens enda väg att skriva till Homey. Ingen lista eller markering per enhet finns i appen. Fler klasser kräver ett nytt beslut.

## Rum
Varje Homey-zon med egna enheter blir ett rum automatiskt, i zonträdets ordning. Enheter i rotzonen visas under Övrigt, och tomma zoner döljs. Egna rum kan läggas till under Inställningar (namn, zon, valfritt med underzoner) och ersätter då de zoner de täcker. Egna rum sparas lokalt i webbläsaren. Repot innehåller inga rum, zoner eller namn.

## El och tips
- **Elmätare:** enheten med `measure_power` och en energimätare väljs automatiskt (en mätare med `accumulatedCost` och `meter_power.imported` först) eller i Inställningar. Valet sparas lokalt.
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
| `js/core/energy.js`, `js/core/prices.js`, `js/core/weather.js` | Rena beräkningar: förbrukning och kostnad, spotpris och tips, SMHI-tolkning |
| `js/core/svg.js` | Egna diagram och väderikoner i SVG |
| `js/app/` | Vyerna: `main.js` (start, anslutning, navigering, inställningar), `energy.js`, `weather.js`, `roomsview.js`, `state.js`, `ui.js` |
| `js/adapters/homey.js` | Homey Web API, moln och lokalt, realtid |
| `js/adapters/smhi.js` | SMHI-prognos |
| `js/adapters/spotpris.js` | Spotpris per elområde (elprisetjustnu.se) |
| `css/tokens.css`, `css/lab.css`, `css/app.css` | Designtokens, baslager, rumsvy |
| `sw.js`, `manifest.webmanifest` | PWA-skal |

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
