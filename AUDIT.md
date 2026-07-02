# Audit webu Bekovy songy

**Datum:** 2. 7. 2026 · **Rozsah:** celý repozitář `bekousek/bekovysongy` (stav commitu `fd0633b`) + živý web `bekousek.github.io/bekovysongy`.
**Metodika:** čtení kódu (všechny JS/CSS/HTML/Python soubory), kontrola git historie na úniky secrets, křížová kontrola dat (`songs.json` vs. `songs/*.html`), ověření živého webu přes HTTP, výpočet WCAG kontrastů. Nic nebylo editováno.

---

## 1. Přehled projektu a tech stack

| Oblast | Zjištění |
|---|---|
| Typ | Statický web — zpěvník (570 písní), bez frameworku |
| Frontend | Vanilla HTML + CSS + JS (6 modulů, ~2 000 řádků), žádný build krok, žádný package.json |
| Data | `songs.json` (180 kB, metadata + akordy), `songs/*.html` (570 souborů, ~4,6 MB) |
| Admin | `/admin` — in-browser editor; Google Sign-In gate (jen `ondrejbek8@gmail.com`) + GitHub PAT v localStorage; ukládá commitem přes GitHub Git Data API |
| Tooling | Python skripty (scrape.py, transfer_songs.py, verify_songs.py, staging_server.py) — lokální pipeline pro převod písní ze starého Webnode webu a externích zdrojů |
| Hosting | GitHub Pages, deploy přes GitHub Actions ([deploy-pages.yml](.github/workflows/deploy-pages.yml)) při každém pushi do `main` |
| Repo | **Veřejné**, 83 commitů, ~2,4 MB |
| Písma | Metropolis (5× woff2, self-hosted, `font-display: swap`) |
| README | Chybí (existuje jen CUSTOM-DOMAIN-SETUP.md a reporty z pipeline) |

Zvláštnost: starý web na Webnode stále běží na `www.bekovysongy.cz` (ověřeno HTTP — odpovídá `server: webnode`), migrace domény na GitHub Pages je rozpracovaná (checklist v [CUSTOM-DOMAIN-SETUP.md](CUSTOM-DOMAIN-SETUP.md)).

---

## 2. Nasazení (CI/CD)

- Workflow je jednoduché a správně nastavené: `concurrency: pages` bez cancel-in-progress, oprávnění minimální (`contents: read`, `pages: write`, `id-token: write`), aktuální verze actions (checkout@v4, deploy-pages@v4).
- **Nasazuje se ale celý repozitář** (`path: .`) — na veřejném webu jsou tak dostupné i interní soubory: ověřeno, `https://…/scrape.py`, `https://…/.claude/settings.local.json` i `https://…/transfer_report.md` vracejí HTTP 200. Není to únik secrets (viz 3.1), ale zbytečná expozice interního tooling a osobních údajů.
- HTTPS: vynuceno (HSTS hlavička přítomna). Vlastní hlavičky (CSP, X-Frame-Options…) GitHub Pages nastavit neumožňuje.

---

## 3. Nálezy podle oblastí

### 3.1 Bezpečnost

**a) GitHub PAT s plným `repo` scope v localStorage — VYSOKÁ**
[admin/index.html:35](admin/index.html) navádí na vytvoření *classic* tokenu se scope `repo` a [editor.js:208](js/editor.js) ho ukládá do `localStorage`. Dva problémy:
1. Classic `repo` scope dává zápis do **všech** repozitářů účtu (i privátních), ne jen do zpěvníku.
2. `localStorage` je sdílený per-origin — na `bekousek.github.io` sdílejí storage **všechny project pages tohoto účtu**. Jakékoli XSS kdekoli na této doméně (i v jiném repu) token přečte.

*Konkrétní riziko:* útočník, který dosáhne XSS na origin (viz bod c), získá plnou kontrolu nad celým GitHub účtem — může přepsat kterýkoli repozitář, číst privátní kód.
*Doporučení:* vyměnit za **fine-grained PAT** omezený na repo `bekousek/bekovysongy` s jediným oprávněním `Contents: Read and write`. Změna nevyžaduje úpravu kódu, jen text nápovědy v admin/index.html. Po migraci na `bekovysongy.cz` (vlastní origin) zmizí i sdílení localStorage s ostatními project pages.

**b) Google gate je pouze klientský — STŘEDNÍ (informativní)**
Kontrola e-mailu probíhá jen v JS ([editor.js:161–178](js/editor.js)); kdokoli ji obejde v DevTools. Skutečnou ochranou zápisu je až PAT (který má jen vlastník) — takže nejde o díru, ale gate je třeba chápat jako **UX prvek, ne zabezpečení**. ID token z Googlu se navíc nikdy neposílá k ověření žádnému serveru (žádný není).
*Doporučení:* žádná akce nutná; jen nespoléhat na gate při budoucích změnách (např. kdyby se do admin přidávaly další schopnosti).

**c) Vzory zranitelné vůči stored XSS z dat písní — STŘEDNÍ**
Data písní (názvy, akordy) jsou důvěryhodná jen do té míry, do jaké je čistá scrape/transfer pipeline (zdrojem byly cizí weby). Tři místa vkládají tato data přes `innerHTML`:
- [player.js:363](js/player.js) — bug modal: `songTitle` vzatý přes `textContent` z `<h1>` a vložený do `innerHTML`. Tím se **ruší escapování** provedené při generování souboru: název uložený jako `&lt;img onerror=…&gt;` se přes `textContent` vrátí jako surový payload a `innerHTML` ho spustí.
- [chords.js:202](js/chords.js) — tooltip: `chordName` z `data-chord` atributu do `innerHTML` (stejný efekt).
- [editor.js:237](js/editor.js) — seznam písní v adminu: `song.title`/`song.author` ze songs.json do `innerHTML`. Tady je dopad největší — XSS v admin kontextu = krádež PAT (viz a). Kontrast: [table.js](js/table.js) totéž správně dělá přes `textContent`.

*Konkrétní riziko:* jediný zákeřný název písně propašovaný pipeline (nebo budoucím přispěvatelem) → spuštění JS na stránce písně u všech návštěvníků a v adminu krádež tokenu.
*Doporučení:* v těchto třech místech skládat DOM přes `textContent`/`createElement` (jako v table.js). Levné, systematické.

**d) scrape.py negeneruje escapovaný HTML — STŘEDNÍ (tooling)**
[scrape.py:238–262](scrape.py) vkládá `song["title"]`, `author` a obsah do HTML f-stringem bez `html.escape()`. Novější [transfer_songs.py](transfer_songs.py) escapuje správně (`html.escape` na title/author, řádky 305–327). Pokud se scrape.py ještě někdy spustí, může vyrobit rozbité/injektovatelné soubory.
*Doporučení:* **rozhodnuto — skript smazat** (jednorázová migrace je hotová, transfer_songs.py ho plně nahradil; viz sekce 6).

**e) staging_server.py: path traversal + CORS pro celý web — STŘEDNÍ (jen lokální dev)**
[staging_server.py:31–37](staging_server.py): `slug` z query jde bez validace do `os.path.join(STAGING, slug + ".src.txt")` — hodnota `../../foo` zapíše mimo staging/. Server zároveň odpovídá `Access-Control-Allow-Origin: *` + `Access-Control-Allow-Private-Network: true`, takže **kterákoli webová stránka otevřená v prohlížeči** může na běžící server POSTovat.
*Konkrétní riziko:* při spuštěném serveru může zákeřná stránka zapisovat soubory `*.src.txt` kamkoli, kam dosáhne relativní cesta.
*Doporučení:* validovat slug (`re.fullmatch(r'[a-z0-9-]+', slug)`), případně omezit CORS na origin, ze kterého se extrakce spouští. Server běží jen ručně na 127.0.0.1, proto jen STŘEDNÍ.

**f) Secrets v kódu a git historii — V POŘÁDKU**
Prohledána celá historie (83 commitů) na vzory `ghp_…`, `github_pat_…`, `AIza…`, privátní klíče, `api_key=` — **nic nenalezeno**. Google Client ID v [editor.js:13](js/editor.js) je z podstaty veřejný identifikátor (chráněný allowlistem originů v Google Console), to je v pořádku. `.env` je v .gitignore.

**g) Veřejně nasazené interní soubory — NÍZKÁ**
Viz sekce 2: `scrape.py`, `transfer_songs.py`, `verify_songs.py`, `*.md` reporty, `scraping_report.txt`, `capo_data.json`, `.claude/settings.local.json` jsou na živém webu. Neobsahují secrets (ověřeno), ale odhalují e-mail, strukturu tooling a interní poznámky.
*Doporučení:* deploy krok, který do artefaktu kopíruje jen web (index.html, css/, js/, songs/, songs.json, assets/, na-*/, admin/, .nojekyll).

### 3.2 Výkon

Celkově velmi dobrý — žádné obrázky, žádné třetí strany na veřejných stránkách, self-hosted fonty se `swap`, malé JS soubory (6–24 kB, bez minifikace).

- **songs.json (180 kB) se stahuje celý** na stránce seznamu i v adminu. GitHub Pages ho komprimuje a cachuje (`max-age=600`), při 570 písních je to v pohodě; hranici bych viděl někdy kolem 2–3 tisíc písní. — NÍZKÁ, zatím neřešit.
- **Tabulka renderuje všech 570 řádků najednou** ([table.js:137–193](js/table.js)) s debounce 200 ms na hledání — na této velikosti bez problému. — OK.
- **Autoscroll přes `setInterval(…, 100)` + `scrollBy`** ([player.js:124–135](js/player.js)) — trhanější než `requestAnimationFrame`, na starších mobilech může drhnout. — NÍZKÁ.
- **Metronom přes `setInterval`** ([player.js:182–191](js/player.js)) — driftuje (JS timer není přesný); pro precizní metronom se plánuje dopředu přes `AudioContext.currentTime`. Pro táborákové použití ok. — NÍZKÁ.
- **Duplikovaný markup player-baru v 570 souborech** — není výkonový problém (soubory ~4,5 kB), ale viz 3.3 údržba.
- Chybí `rel="preload"` fontů a `preconnect` na accounts.google.com v adminu — mikrooptimalizace. — NÍZKÁ.

### 3.3 Kvalita kódu a architektura

Kód je čitelný, konzistentně stylizovaný, s dobrými komentáři (zejména [sections.js](js/sections.js) a [song-cleanup.js](js/song-cleanup.js), které jsou navržené jako čisté funkce testovatelné v Node). Hlavní nálezy:

- **Ztrojená transpoziční logika, která se rozešla — VYSOKÁ (projevuje se jako bug, viz 3.4b):** `NOTES`/`NOTE_MAP`/`parseChord`/`transposeChord` existují v [player.js:53–90](js/player.js), [song-cleanup.js:26–61](js/song-cleanup.js) a po třetí v Pythonu ([transfer_songs.py](transfer_songs.py)). Verze v song-cleanup.js umí lomené akordy (`transposeChordFull`, `D/F#` → transponuje i bas), verze v player.js **ne** — a právě ta běží na živých stránkách písní.
- **Duplikace `normalizeBreaks`** — totéž normalizování `<br>/<div>/&nbsp;` je v [sections.js:74–82](js/sections.js) i [song-cleanup.js:100–112](js/song-cleanup.js).
- **Mrtvý kód / mrtvá data:**
  - `el.dataset.display` se zapisuje ([player.js:108](js/player.js)), ale nikde nečte — pozůstatek nedokončené opravy tooltipů (viz 3.4b).
  - [chords.js:213](js/chords.js): `tooltip.querySelector('::after')` — osamocený výraz bez efektu (pseudo-elementy nelze selektovat), zjevně pahýl.
  - `capo_data.json` — nepoužívá ho žádný kód (pozůstatek po fix_capo.py).
  - `external_links.json` — web ho nekonzumuje, je to výstup pipeline (a zbylo v něm 6 položek včetně reklamního odkazu na Webnode).
  - Pole `group` v songs.json je u všech 570 písní prázdné; CSS `.song-group-link` na nic neukazuje.
- **Křehká úprava HTML regexy v editoru** ([editor.js:490–546](js/editor.js)) — save přepisuje `<h1>`, `.song-author`, `.song-capo`, `<pre>` a `<title>` sekvencí `String.replace` s předpoklady o odsazení (`'</div>\n    <pre'`). Když se šablona písně kdykoli změní, tichá degradace (např. autor se nevloží). Funguje, ale je to nejrizikovější místo na údržbu.
- **570× duplikovaný boilerplate** (nav + player-bar v každém souboru písně) — změna player-baru znamená hromadnou regeneraci všech souborů. Dlouhodobě: generovat stránky ze šablony build krokem, nebo player-bar injektovat JS (stačí jednou v player.js, HTML písní by se smrsklo na hlavičku + `<pre>`).
- **Nekonzistence dat:** 443 písní má mailto `bek@bekovysongy.cz`, 127 má `ondrejbek8@gmail.com`; 16 písní stále používá značku `®:` (např. [amazonka.html:41](songs/amazonka.html)), kterou [sections.js](js/sections.js) nerozpoznává — u nich nefunguje sbalování refrénů a `®:` se zobrazuje jako text.
- **Slug hack** `a1970`, `a7-years` (prefix „a" kvůli řazení názvů začínajících číslicí) — funguje, ale vyrábí ošklivá URL; jen kosmetika.
- Chybí README (jak spustit lokálně, jak funguje pipeline, jak admin) a jakýkoli lint/format config. — NÍZKÁ.

### 3.4 Error handling a korektnost

**a) Ztráta rozpracovaných úprav v adminu — VYSOKÁ**
Dvě cesty, obě tiché:
1. **Přepnutí písně bez uložení:** `loadSong` ([editor.js:259](js/editor.js)) přepíše editor bez dotazu; není ani `beforeunload` ochrana při zavření záložky. Rozpracovaná úprava zmizí bez varování.
2. **Stale načtení z CDN:** editor načítá obsah písně z Pages (`fetch('../songs/slug.html')`, [editor.js:275](js/editor.js)), které má `cache-control: max-age=600` + latenci deploye. Když píseň uložíš a do ~10 minut ji otevřeš znovu, editor zobrazí **starou verzi**; po druhém uložení se `<pre>` přepíše tímto starým obsahem → první úprava se tiše ztratí (save čte přes GitHub API jen okolní HTML, ale text bere z editoru).

*Konkrétní riziko:* vlastník přijde o vlastní úpravy textů a nemusí si toho všimnout (commit projde, deploy proběhne).
*Doporučení:* (1) confirm při přepnutí s neuloženými změnami + `beforeunload`; (2) načítat obsah písně přes GitHub API (`getFileContent` už existuje), s fallbackem na fetch bez tokenu, nebo aspoň cache-buster `?t=${Date.now()}`.

**b) Transpozice na stránce písně je chybná pro lomené akordy a diagramy — VYSOKÁ**
- `transposeChord` v [player.js:84–90](js/player.js) transponuje jen kořen: `Emi7/H` při +2 → `F#mi7/H` (bas zůstane H místo C#). V písních je ~60 výskytů lomených akordů (Emi7/H, C/G, Ami/G, …). song-cleanup.js správnou implementaci má, jen se na stránce písně nepoužívá.
- Po transpozici ukazuje tooltip **diagram i název původního akordu**: `showTooltip` čte `dataset.chord` ([chords.js:194](js/chords.js)), který se při transpozici nemění (zapisuje se nečtený `dataset.display`). Uživatel transponuje +2, v textu vidí „D", ale po najetí dostane diagram „C".

*Konkrétní riziko:* hráč hraje špatné akordy — jde o hlavní funkci webu.
*Doporučení:* v `showTooltip` číst `dataset.display || dataset.chord`; transpozici lomených akordů delegovat na sdílenou funkci (viz 3.3 dedup).

**c) Selhání načtení songs.json = prázdná stránka — STŘEDNÍ**
[table.js:27–35](js/table.js) nemá `.catch` ani loading/empty stav — při výpadku sítě zůstane tabulka prázdná a počítadlo nic neřekne. Admin ([editor.js:221–230](js/editor.js)) hlášku má.
*Doporučení:* `.catch` + zpráva „Nepodařilo se načíst seznam písní — zkuste obnovit stránku".

**d) Offline chování — STŘEDNÍ (příležitost)**
Web nemá service worker; bez signálu (chata, les — typické prostředí pro zpěvník) nefunguje vůbec. Přitom je to ideální kandidát na PWA: statický obsah, 4,6 MB celkem.
*Doporučení:* dlouhodobě service worker s cache-first strategií + web manifest („přidat na plochu").

**e) Drobné:**
- 55 akordů použitých v písních nemá diagram v `CHORD_DB` (A/C#, Ami9, Ddim, F#7, …) — tooltip se tiše nezobrazí. Jeden datový kaz: `data-chord="/"`. — STŘEDNÍ/NÍZKÁ.
- Tuner: ošetřen odepřený mikrofon (hláška), autocorrelation může vrátit nesmysl pro šum — přijatelné. — OK.
- `touchstart` listener s `preventDefault` na dokumentu ([chords.js:246–254](js/chords.js)) je v moderních prohlížečích pasivní → `preventDefault` se ignoruje a jen loguje warning do konzole. — NÍZKÁ.

### 3.5 Přístupnost (a11y)

- **Filtr akordů je klávesnicí neovladatelný — VYSOKÁ (v rámci a11y):** checkboxy mají `display: none` ([style.css:306–308](css/style.css)), takže vypadly z tab-orderu; stylované labely fungují jen myší. Řešení: vizuálně skrýt přes `.sr-only`/`clip` techniku místo `display:none`, doplnit `:focus-visible` styl na label.
- **Ikonová tlačítka bez názvu:** `scroll-toggle` a `metronome-toggle` nemají žádný text, `title` ani `aria-label` (viz [songs/amazonka.html:94–103](songs/amazonka.html)); `tuner-toggle` totéž. Čtečka přečte jen „button". Řešení: `aria-label="Automatické rolování"` atd. — STŘEDNÍ.
- **Řazení tabulky jen myší:** `<th data-sort>` má click handler ([table.js:206–224](js/table.js)), není fokusovatelný, chybí `aria-sort`. — STŘEDNÍ.
- **Tooltip s diagramem jen na hover/touch:** `.chord` span není fokusovatelný — klávesnice se k diagramům nedostane. — STŘEDNÍ.
- **Kontrast (spočítáno):** `--text-dim #556677` na pozadí = **2,89:1** (WCAG AA chce 4,5:1) — používá se na jazykové štítky, placeholdery, klidový stav tuneru. Bílý text na akcentové `#e67e22` (tlačítka Náhodná píseň, hero, Uložit) = **2,85:1** — také pod AA. Ostatní páry prošly (text 12,9:1, muted 5,8:1, accent na pozadí 6,0:1). Řešení: ztmavit akcent pro plochy s bílým textem (např. `#c4670f`), zesvětlit `--text-dim` (~`#7a8ba0`). — STŘEDNÍ.
- **Modal bug reportu:** Escape i klik mimo fungují, fokus se přesune do textarey — dobré; chybí `role="dialog"`, `aria-modal` a vrácení fokusu na spouštěč. — NÍZKÁ.
- Pozitiva: `lang="cs"`, sémantické `nav`/`main`, tabulka je skutečný `<table>`, formulářové prvky v filtrech mají `<label for>`.

### 3.6 SEO

Web nemá žádné SEO vybavení — pro veřejný zpěvník, který chce být k nalezení, jsou to snadné body:

- Chybí `meta description`, Open Graph/Twitter tagy, favicon (404), `robots.txt`, `sitemap.xml`, canonical. — STŘEDNÍ.
- Chybí vlastní `404.html` (GitHub Pages pak servíruje generickou stránku). — NÍZKÁ.
- **Duplicitní obsah:** starý Webnode web se stejnými písněmi stále běží na `www.bekovysongy.cz`, nový na `bekousek.github.io/bekovysongy` — dvě kopie soutěží v indexu. Vyřeší dokončení migrace domény (+ canonical). — STŘEDNÍ.
- Strukturovaná data (schema.org `MusicComposition`) — možné, ale u zpěvníku s texty pozor na autorská práva vs. viditelnost; nechal bych být. — NÍZKÁ/otevřené.
- Titulky stránek jsou v pořádku (`Píseň - Bekovy songy`).

### 3.7 Testy

- **Žádné testy neexistují** (nenalezen žádný test soubor ani package.json). Přitom [sections.js](js/sections.js) a [song-cleanup.js](js/song-cleanup.js) na to jsou výslovně připravené (`module.exports`, komentář „for tests") — někdo testy plánoval nebo smazal.
- Právě tyto dva moduly + transpozice jsou nejcitlivější logika (parsování bloků, dedent, opakování refrénů, lomené akordy) a zároveň čisté funkce → testy jsou levné: `node --test` bez jediné závislosti.
- Chybí i CI kontrola (workflow jen nasazuje; nic nevaliduje songs.json proti souborům, HTML well-formedness apod.).
*Doporučení:* malá sada node:test pro sections/song-cleanup + skript validace dat, obojí zapojit jako job před deploy.

### 3.8 Závislosti

- **npm audit: není co auditovat** — projekt nemá package.json a žádné JS závislosti (runtime ani dev). To je v tomto kontextu přednost, ne dluh.
- Jediná externí runtime závislost: `https://accounts.google.com/gsi/client` na /admin (nutná pro Sign-In, důvěryhodný zdroj, načítá se jen adminovi).
- Fonty vendorované v repu — žádný CDN. Dobře.
- Python tooling: importuje `requests` + `beautifulsoup4`, ale **chybí requirements.txt / pinování verzí** — skripty nejsou reprodukovatelné na jiném stroji. `pip audit` nešlo smysluplně spustit (není definované prostředí). — NÍZKÁ (tooling).
- GitHub Actions: používané akce jsou aktuální major verze. — OK.

### 3.9 Responzivita a kompatibilita

- Breakpointy 768 px a 480 px pokrývají hlavní případy: nav se skládá pod sebe, filtry do sloupce, tabulka má `overflow-x: auto`, player-bar zhušťuje a skrývá popisky. Viewport meta všude. — DOBRÉ.
- Player-bar je `position: fixed` s `flex-wrap` — na velmi úzkých displejích se může zalomit do dvou řad a ukrojit víc obsahu; `.song-page` má rezervu jen `padding-bottom: 100px`. Drobné riziko překrytí posledních řádků textu. — NÍZKÁ.
- JS používá optional chaining (`?.`, [player.js:355](js/player.js)) → vyžaduje prohlížeče ~2020+ (Chrome 80, Safari 13.1). Pro cílovku ok, jen vědět. — NÍZKÁ.
- `unescape`/`escape` v [editor.js:655–661](js/editor.js) jsou deprecated (fungují, ale doporučená náhrada je `TextEncoder`/`TextDecoder`). — NÍZKÁ.
- Editor (contenteditable + klávesové zkratky) je prakticky desktop-only — pro admin use-case přijatelné.
- Hledání v tabulce nenormalizuje diakritiku: „zelva" nenajde „želva". Čeští uživatelé na mobilu často píší bez háčků. Řešení: porovnávat přes `.normalize('NFD').replace(/\p{Diacritic}/gu, '')`. — STŘEDNÍ (UX).

### 3.10 Data a soukromí

Výborný stav — web je prakticky zero-tracking:

- Žádná analytika, žádné cookies, žádné third-party requesty na veřejných stránkách (fonty self-hosted, ikony inline SVG).
- localStorage: preference (`show_repeats`, `chord_shortcuts`) + v adminu `gh_token`/`gh_repo` (viz 3.1a — jediný citlivý údaj).
- Google Sign-In (cookies/requesty na accounts.google.com) se týká jen /admin, tedy jen vlastníka.
- Ladička: mikrofon se zpracovává lokálně (Web Audio), nikam se neposílá, stream se při vypnutí korektně zavírá ([player.js:329–342](js/player.js)).
- Bug report jde přes `mailto:` — e-mail odesílá uživatelův klient, web nic nesbírá.
- Osobní e-mail vlastníka je veřejně v 570 souborech (mailto) — předpokládám záměr; zvyšuje spam expozici. — NÍZKÁ/informativní.
- 443 písní posílá bug reporty na `bek@bekovysongy.cz` — po vypnutí Webnode schránka zanikne a 78 % tlačítek „Nahlásit chybu" by odesílalo do prázdna. **Rozhodnuto:** sjednotit vše na `ondrejbek8@gmail.com` (sekce 6, krok 6).

---

## 4. Prioritizace

### Kritické
*Žádný nález.* (Neuniklo žádné tajemství, web nemá server, obsah je statický.)

### Vysoké
| # | Nález | Konkrétní riziko |
|---|---|---|
| V1 | Classic PAT `repo` scope v localStorage na sdíleném originu (3.1a) | XSS kdekoli na `bekousek.github.io` = převzetí celého GitHub účtu (všechna repa) |
| V2 | Tichá ztráta úprav v adminu — přepnutí písně bez varování + stale CDN load (3.4a) | Vlastník nenávratně přijde o vlastní editace textů a nevšimne si toho |
| V3 | Transpozice: lomené akordy se transponují špatně a tooltip ukazuje netransponovaný diagram (3.4b) | Hlavní funkce webu dává hráči špatné akordy |

### Střední
- S1 — `innerHTML` vzory umožňující stored XSS z dat písní (3.1c) — v kombinaci s V1 eskaluje na krádež účtu.
- S2 — Interní soubory nasazované na veřejný web (3.1g, sekce 2).
- S3 — Mailto nejednotné, 443 písní možná míří na mrtvou schránku (3.10) — ztráta hlášení chyb od uživatelů.
- S4 — 16 písní se značkou `®:`, kterou sections.js neumí (3.3) — nefunkční sbalování refrénů, vizuální šum.
- S5 — Filtr akordů nedostupný z klávesnice; neoznačená ikonová tlačítka; kontrast `--text-dim` 2,9:1 a bílá na oranžové 2,9:1 (3.5).
- S6 — SEO základ chybí: meta description, favicon, sitemap, robots, canonical; duplicitní obsah se starým Webnode webem (3.6).
- S7 — `table.js` bez ošetření chyby fetch → prázdná stránka (3.4c).
- S8 — 55 akordů bez diagramu + `data-chord="/"` kaz (3.4e).
- S9 — Hledání bez normalizace diakritiky (3.9).
- S10 — staging_server.py path traversal + CORS `*` (3.1e) a scrape.py bez escapování (3.1d) — jen lokální tooling.
- S11 — Žádné testy pro sections/song-cleanup/transpozici (3.7).

### Nízké
- N1 — Mrtvý kód/data: `dataset.display`, `querySelector('::after')`, capo_data.json, external_links.json, pole `group` (3.3).
- N2 — Duplikace transpoziční logiky ×3 a normalizeBreaks ×2 (3.3) — příčina V3, po opravě sjednotit.
- N3 — Chybí README, requirements.txt, lint (3.3, 3.8).
- N4 — Chybí 404.html, offline/PWA režim (3.4d, 3.6).
- N5 — Autoscroll/metronom přes setInterval, touchstart passive warning (3.2, 3.4e).
- N6 — 570× duplikovaný player-bar markup — daň při každé změně šablony (3.3).
- N7 — Deprecated `unescape`/`escape`, slug hack `a1970`, spam expozice e-mailu.

---

## 5. Plán vylepšení

### Fáze 1 — rychlé opravy (každá do 1 h)
| Krok | Náročnost | Proč |
|---|---|---|
| 1. Vyměnit PAT za fine-grained (jen toto repo, Contents RW) + upravit nápovědu v admin/index.html | **S** | Zmenší blast-radius V1 z „celý účet" na „jedno repo"; žádná změna logiky |
| 2. Tooltip: číst `dataset.display \|\| dataset.chord`; transpozici lomených akordů převzít ze song-cleanup.js | **S** | Opraví V3 — správné diagramy a basy po transpozici |
| 3. Admin: `confirm()` při přepnutí písně s neuloženými změnami + `beforeunload` | **S** | Zastaví ztrátu dat V2 (cesta 1) |
| 4. Bug modal, tooltip název, admin seznam: `textContent` místo `innerHTML` | **S** | Uzavře S1, sjednotí s table.js |
| 5. `table.js`: `.catch` + chybová hláška; oprava `data-chord="/"` | **S** | S7, S8 — viditelné selhání místo prázdné stránky |
| 6. Sjednotit mailto na `ondrejbek8@gmail.com` (skript přes songs/*.html) | **S** | S3 — bug reporty nekončí v prázdnu; Gmail přežije vypnutí Webnode |
| 7. Favicon + 404.html + meta description na 4 hlavní stránky | **S** | Nejlevnější kus S6 |
| 8. Smazat mrtvý kód a soubory (N1) **včetně scrape.py**, validovat slug ve staging_server.py | **S** | Hygiena, S10; smazáním scrape.py odpadá i nález 3.1d |

### Fáze 2 — střednědobé (hodiny až den)
| Krok | Náročnost | Proč |
|---|---|---|
| 9. Admin načítá obsah písně přes GitHub API místo Pages CDN | **M** | Dorazí V2 (cesta 2 — stale load); API vrací vždy aktuální stav |
| 10. Deploy jen webových souborů (build adresář ve workflow) | **M** | S2 — interní tooling zmizí z veřejného webu |
| 11. Konverze 16 písní `®:` → `R:` (skriptem, s kontrolou diffu) | **M** | S4 — sekce fungují všude, jednotný formát |
| 12. A11y balík: sr-only checkboxy filtru, aria-label ikonových tlačítek, aria-sort + klávesnice na řazení, úprava `--text-dim` a akcentové barvy | **M** | S5 — použitelnost klávesnicí/čtečkou, WCAG AA kontrast |
| 13. Testy: node:test pro sections.js, song-cleanup.js, transpozici + validace songs.json vs. songs/ v CI před deployem | **M** | S11 — pojistka pro nejcitlivější logiku, které se dotknou kroky 2, 9, 11 |
| 14. Hledání bez diakritiky (normalize NFD) v table.js i adminu | **M** | S9 — reálný UX zisk pro české uživatele |
| 15. Doplnit ~55 chybějících diagramů do CHORD_DB (nebo fallback „diagram chybí") | **M** | S8 — tooltip přestane tiše mlčet |
| 16. Dokončit migraci domény dle CUSTOM-DOMAIN-SETUP.md (DNS se mění u registrátora domény) a vypnout Webnode; poté plný SEO balík: canonical, sitemap.xml, robots.txt, OG/Twitter tagy | **M** | S6 — konec duplicitního obsahu, dohledatelnost webu, vlastní origin izoluje localStorage (posílí i V1) |
| 17. README + requirements.txt | **S** | N3 — obnovitelnost projektu na novém stroji |

### Fáze 3 — dlouhodobý refaktoring
| Krok | Náročnost | Proč |
|---|---|---|
| 18. Sjednotit hudební logiku (parsování/transpozice akordů) do jednoho sdíleného modulu používaného player.js, song-cleanup.js i editorem | **L** | N2 — odstraní třídu chyb „opraveno jen na jednom místě" (přesně tak vznikla V3) |
| 19. Šablonování stránek písní: buď build krok generující songs/*.html z dat, nebo zeštíhlit soubory a nav/player-bar injektovat klientsky | **L** | N6 — změna UI písně přestane znamenat regeneraci 570 souborů |
| 20. PWA: service worker (cache-first pro songs/ + songs.json), manifest, offline stránka | **L** | N4 — zpěvník funguje bez signálu, což je jeho přirozené prostředí |
| 21. Nahradit regex-surgery v editor.js strukturovaným renderováním celé stránky písně (navazuje na 19) | **L** | Odstraní nejkřehčí kód v repu (3.3) |

Doporučené pořadí zohledňuje závislosti: 2→18 (oprava, pak dedup), 13 před 9/11 (testy jako síť), 19 před 21.

---

## 6. Rozhodnutí vlastníka (zodpovězeno 2. 7. 2026)

Původně otevřené otázky auditu — všechny zodpovězeny, plán výše je s nimi v souladu:

1. **Bug reporty (mailto):** sjednotit na `ondrejbek8@gmail.com` — Gmail přežije vypnutí Webnode. → krok 6.
2. **DNS `bekovysongy.cz`:** spravuje se **u registrátora domény** (ne Webnode/Netlify DNS). → krok 16; platí i pro krok 1 checklistu v CUSTOM-DOMAIN-SETUP.md.
3. **scrape.py:** už se spouštět nebude — **smazat**. Tím odpadá nález 3.1d (neescapované generování HTML). → krok 8.
4. **GitHub token:** vyměnit za **fine-grained PAT bez expirace**, omezený na repo `bekousek/bekovysongy` s oprávněním Contents: Read and write. → krok 1.
5. **Editoři:** písně edituje **jen vlastník** — klientský gate + PAT stačí, serverová autorizace (GitHub App / PR workflow) se do plánu nepřidává.
6. **SEO:** zvolen **plný SEO balík** (meta description, favicon, canonical, sitemap.xml, robots.txt, OG tagy) — vlastník bere na vědomí poznámku k autorským právům textů (3.6) a chce web dohledatelný. → kroky 7 a 16.
