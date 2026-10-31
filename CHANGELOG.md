# Changelog

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
