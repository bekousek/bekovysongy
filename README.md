# Bekovy songy

Zpěvník s akordy pro kytaru, foukací harmoniku a kalimbu — statický web, žádný
build krok. Vanilla HTML/CSS/JS, 570+ písní, transpozice, metronom, ladička,
akordové diagramy a in-browser editor s ukládáním přímo do GitHubu.

Živý web: https://bekousek.github.io/bekovysongy/ (do budoucna `bekovysongy.cz`,
viz [CUSTOM-DOMAIN-SETUP.md](CUSTOM-DOMAIN-SETUP.md)).

## Spuštění lokálně

Žádný build, žádné závislosti pro samotný web — stačí ho servírovat staticky:

```bash
python -m http.server 8137
# nebo: npx serve .
```

a otevřít `http://localhost:8137/`.

## Struktura repozitáře

| Cesta | Co je |
|---|---|
| `index.html`, `na-kytaru/`, `na-foukaci-harmoniku/`, `na-kalimbu/` | veřejné stránky |
| `songs/*.html` | jednotlivé písně (statické HTML, generované/editované) |
| `songs.json` | metadata a akordy všech písní (čte je `js/table.js`, `admin/`) |
| `js/` | `chords.js` (diagramy), `sections.js` (refrén/sloka/bridge), `song-cleanup.js` (editor helpery), `table.js` (seznam písní), `player.js` (transpozice/metronom/ladička), `editor.js` (admin) |
| `css/` | `style.css` (celý web), `editor.css` (jen admin) |
| `admin/` | in-browser editor, viz níže |
| `test/` | `node --test` sada pro `sections.js`/`song-cleanup.js`/`chords.js` |
| `scripts/` | `validate-data.js` (kontrola `songs.json` vs. `songs/`), `generate-sitemap.js` |
| `transfer_songs.py`, `verify_songs.py`, `staging_server.py` | pipeline pro import písní (níže) |
| `.github/workflows/deploy-pages.yml` | CI: testy → validace dat → deploy na GitHub Pages |

## Testy a validace dat

```bash
npm test        # node --test nad test/ (sections.js, song-cleanup.js, chords.js, transpozice)
npm run validate # cross-check songs.json vs. songs/*.html, hledá poškozená data
```

Obojí běží v CI před každým deployem (viz `deploy-pages.yml`) — pushnutá
změna, která testy nebo validaci nesplní, se nenasadí.

## Datová pipeline (import písní)

Písně vznikají dvěma cestami: ručně přes `/admin`, nebo importem z externích
zdrojů skriptem `transfer_songs.py`.

Instalace závislostí (jen pro Python tooling, web je na nich nezávislý):

```bash
pip install -r requirements.txt
```

`transfer_songs.py` čte frontu čekajících písní z `external_links.json`
(stabilní snapshot je v `external_links.original.json`), stáhne text/akordy
z podporovaných zdrojů (supermusic.cz, pisnicky-akordy.cz, velkyzpevnik.cz,
yousongs.cz, kytaristka.cz, případně ručně staženého `staging/<slug>.src.txt`
pro JS-chráněné weby jako Ultimate Guitar), znormalizuje akordy do české
notace (`mi`/`H`/`B`) a vygeneruje `songs/<slug>.html` + zápis do
`songs.json`.

```bash
python transfer_songs.py            # dry-run, výstup do staging/ pro kontrolu
python transfer_songs.py --commit   # zapíše do songs/, songs.json, external_links.json
```

`staging_server.py` je pomocný lokální HTTP sink (`127.0.0.1:8765`) — slouží
k ručnímu vložení textu písně z prohlížeče (pro zdroje blokované přes JS/bot
detekci) do `staging/<slug>.src.txt`, odkud si ho `transfer_songs.py` přečte.

`verify_songs.py` po importu zkontroluje výstup (chybějící akordy, podezřelé
znaky, kolize slugů apod.) nezávisle na `scripts/validate-data.js`, který běží
v CI a hlídá hlavně konzistenci `songs.json` ↔ `songs/`.

## Admin editor (`/admin`)

In-browser editor pro úpravu existujících písní, chráněný dvěma vrstvami:

1. **Google Sign-In gate** (klientský) — pustí dál jen účet nastavený v
   `GOOGLE_CLIENT_ID`/`ALLOWED_EMAIL` v [js/editor.js](js/editor.js). Toto je
   jen UX prvek, ne bezpečnostní hranice.
2. **GitHub Personal Access Token** (fine-grained, jen `Contents: Read and
   write` na tento repozitář) — uložený v `localStorage` prohlížeče, reálně
   autorizuje zápis. Návod na vytvoření je přímo v UI editoru při prvním
   přihlášení.

Uložení z editoru vytvoří jeden atomický commit (přes GitHub Git Data API) do
`songs/<slug>.html` i `songs.json` zároveň, což spustí `deploy-pages.yml`.

## Nasazení

Push do `main` (včetně commitů z admin editoru) spustí GitHub Actions:
testy → validace dat → sestavení veřejného webu (jen skutečné web soubory,
interní tooling se nepublikuje) → deploy na GitHub Pages. Ruční spuštění jde
přes `workflow_dispatch` v záložce Actions.
