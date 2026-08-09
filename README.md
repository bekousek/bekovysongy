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
| `js/` | `chords.js` (diagramy), `sections.js` (refrén/sloka/bridge), `song-cleanup.js` (editor helpery), `table.js` (seznam písní), `player.js` (transpozice/metronom/ladička), `editor.js` (admin), `song-preview.js` (náhledy při triage, jen admin) |
| `css/` | `style.css` (celý web), `editor.css` (jen admin) |
| `song-previews.json` | 30s ukázky k návrhům pro triage v `/admin` (viz níže) |
| `admin/` | in-browser editor, viz níže |
| `test/` | `node --test` sada pro `sections.js`/`song-cleanup.js`/`chords.js` |
| `scripts/` | `validate-data.js` (kontrola `songs.json` vs. `songs/`), `generate-sitemap.js`, `build-previews.js` |
| `transfer_songs.py`, `verify_songs.py`, `staging_server.py` | pipeline pro import písní (níže) |
| `.github/workflows/deploy-pages.yml` | CI: testy → validace dat → deploy na GitHub Pages |

## Testy a validace dat

```bash
npm test        # node --test nad test/ (sections.js, song-cleanup.js, chords.js, transpozice)
npm run validate # cross-check songs.json vs. songs/*.html, hledá poškozená data
```

Obojí běží v CI před každým deployem (viz `deploy-pages.yml`) — pushnutá
změna, která testy nebo validaci nesplní, se nenasadí.

## Ukázky písní

30s úryvek z katalogu iTunes. Slouží dvěma věcem: projít stovky návrhů znamená
každý si nejdřív poslechnout, a ve zpěvníku si člověk potřebuje ověřit, jak
píseň jde, než ji začne hrát.

**V `/admin`** má ▶ každý řádek. U návrhů se navíc hodnotí z klávesnice
(<kbd>␣</kbd> přehrát, <kbd>↑</kbd><kbd>↓</kbd> pohyb, <kbd>→</kbd> do
„K vytvoření", <kbd>←</kbd> smazat).

**Ve zpěvníku** přibyla ▶ „Ukázka" do spodní lišty (vkládá `js/player.js` za
běhu, soubory písní se nemění). Hraje jen tam, kde sedí název i interpret —
`scripts/build-public-previews.js` při deployi vyrobí `song-previews-public.json`,
mapu slug → url jen pro vydané písně s přesnou shodou. Cover od jiného
interpreta na poznání melodie při trůvení stačí, ale návštěvníkovi se
nenabízí.

### Oprava špatné shody

Matcher bere první věrohodnou odpověď katalogu, což občas trefí jinou píseň
téhož názvu („A star is born (Shallow)" → muzikálové „A Star Is Born").
V `/admin` je proto v <kbd>⋯</kbd> menu řádku **Vybrat ukázku…**: prohledá
katalog živě, každého kandidáta si jde poslechnout a vybraný se uloží
s `"locked": true`. Takový záznam `build-previews.js` nikdy nepřepíše (ani
s `--recheck`) a zpěvník ho bere jako přesnou shodu — potvrdil ho člověk.
Tlačítko **Bez ukázky** naopak zapíše `{"match": "none", "locked": true}`,
když je automatická shoda špatná a nic lepšího v katalogu není.

Do vyhledávacího pole jde místo dotazu vložit **odkaz z Apple Music** (i ve
tvaru alba s `?i=`, nebo holé číselné ID) — pak se nehledá, ale sáhne se
rovnou pro tu jednu nahrávku přes `lookup`. Není to jen zkratka: hledací index
katalogu má díry. „Pasák děvek" (Řáhol One) nevrací pro žádný zápis vůbec nic,
ale `lookup` podle ID ji najde i s ukázkou — u takových písní je vložený odkaz
jediná cesta.

Volba se uloží až s nejbližším **Uložit** — celá kontrolní jízda je jeden
commit. Zapisuje se read-modify-write proti verzi na GitHubu, ne proti kopii
v prohlížeči, aby přepis nesmazal to, co mezitím doplnil skript.

Poznámka: **kterou část písně ukázka hraje, ovlivnit nejde.** `previewUrl` je
předstřižený ~30s soubor od vydavatele, bez parametru offsetu.

```bash
npm run build-previews            # dohledá jen dosud nevyřešené návrhy
npm run build-previews -- --recheck # zkusí znovu i dřívější propadáky
```

Skript se ptá iTunes Search API (zdarma, bez klíče) a výsledek zapisuje do
`song-previews.json`. Hledá dvakrát: „název + interpret" (`match: "exact"`),
a když nic, tak jen podle názvu (`match: "title"` — obvykle cover od jiného
interpreta, na poznání melodie ale stačí; v UI je označený čárkovaně).
Písně bez ukázky mají v řádku odkaz na vyhledávání na YouTube.

Na rozdíl od `search-index.json` se `song-previews.json` **commituje**:
dohledání je stovky volání proti dost přísnému rate limitu, takže se dělá
jednou, ne při každém deployi. Skript je proto resumovatelný — průběžně
zapisuje, hotové návrhy přeskakuje a zpomaluje se, když API začne škrtit —
a klidně se pustí víckrát za sebou.

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
