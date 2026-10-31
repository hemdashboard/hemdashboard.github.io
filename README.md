# Hemdashboard

Egen PWA som visar husets status och låter hushållet slå av och på enheter via Homey. Statisk sida på GitHub Pages, vanilla JS utan byggsteg.

**Repot innehåller ingen husdata.** Enheter, zoner och användare hämtas från Homey vid körning. Nycklar, Homey-ID, IP-adresser och positioner anges i webbläsaren och sparas krypterade lokalt – aldrig här.

## Status
Version 0.2: första rumsvyn (`index.html`) med reglage för lampor. Testsidan `lab.html` finns kvar för diagnos.

## Reglage
Reglage finns **endast för enheter med klassen `light`** (enhetens `class`, inte `virtualClass`) som är tillgängliga, och bara för `onoff` och `dim`. Allt annat – uttag, sensorer, termostater, lås och kameror – visas utan reglage. Saknad eller okänd klass ger inget reglage. Regeln ligger i `js/core/controls.js` och prövas både när reglaget ritas och i skrivvägen (`homey.control`), som är appens enda väg att skriva till Homey. Ingen lista eller markering per enhet finns i appen. Fler klasser kräver ett nytt beslut.

## Rum
Rum läggs till i appen under Inställningar: namn och vilken Homey-zon rummet motsvarar, valfritt med underzoner. Kopplingen sparas lokalt i webbläsaren. Repot innehåller inga rum, zoner eller namn.

## Struktur
| Fil | Roll |
|---|---|
| `index.html`, `js/app/` | Appen: rumsvy och inställningar |
| `lab.html`, `js/lab/` | Testsida och diagnossida |
| `js/core/keystore.js` | Nyckel + anslutningsuppgifter, PIN-krypterade (PBKDF2 → AES-GCM) |
| `js/core/http.js` | fetch med tidsgräns och generiska felkategorier |
| `js/core/controls.js` | Reglageregeln: endast klass `light`, i rendering och skrivväg |
| `js/core/rooms.js` | Rum → zon, sparat lokalt |
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
- Inga tredjepartsskript eller CDN.
- API-nyckeln är personlig per användare och återkallas genom att den raderas i Homey.
- PIN-krypteringen skyddar mot en lånad eller upplåst telefon, inte mot någon med full åtkomst till enheten.

## Källor för data
- Väder: SMHI, öppna data.
- Elpris: elprisetjustnu.se.
