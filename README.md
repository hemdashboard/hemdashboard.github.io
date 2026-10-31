# Hemdashboard

Egen PWA som visar husets status och låter hushållet slå av och på enheter via Homey. Statisk sida på GitHub Pages, vanilla JS utan byggsteg.

**Repot innehåller ingen husdata.** Enheter, zoner och användare hämtas från Homey vid körning. Nycklar, Homey-ID, IP-adresser och positioner anges i webbläsaren och sparas krypterade lokalt – aldrig här.

## Status
Version 0.1: testsidan `lab.html`, som prövar anslutningarna och lägger grunden för appen.

## Struktur
| Fil | Roll |
|---|---|
| `lab.html`, `js/lab/` | Testsida och diagnossida |
| `js/core/keystore.js` | Nyckel + anslutningsuppgifter, PIN-krypterade (PBKDF2 → AES-GCM) |
| `js/core/http.js` | fetch med tidsgräns och generiska felkategorier |
| `js/core/kguard.js` | Säkerhetskritiska enheter får aldrig reglage (UI-regel) |
| `js/adapters/homey.js` | Homey Web API, moln och lokalt, realtid |
| `js/adapters/smhi.js` | SMHI-prognos |
| `js/adapters/spotpris.js` | Spotpris per elområde (elprisetjustnu.se) |
| `css/tokens.css` | Designtokens |
| `sw.js`, `manifest.webmanifest` | PWA-skal |

## Säkerhet
- Content-Security-Policy i varje sida: bara egna skript, nätanrop endast till Homey (moln/lokalt), SMHI och elprisetjustnu.se.
- Inga tredjepartsskript eller CDN.
- API-nyckeln är personlig per användare och återkallas genom att den raderas i Homey.
- PIN-krypteringen skyddar mot en lånad eller upplåst telefon, inte mot någon med full åtkomst till enheten.

## Källor för data
- Väder: SMHI, öppna data.
- Elpris: elprisetjustnu.se.
