# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primárně autor webu (Ondřej) a jeho parta. Hrají z toho na mobilu, typicky večer u ohně, na chatě nebo venku: kytara v rukou, telefon položený na stole, koleni nebo stojanu, na displej se dívají zpovzdálí a klepou jen palcem. Často bez signálu, při špatném světle nebo naopak na slunci. Úroveň od začátečníků s pěti akordy po zkušené hráče. Menší část návštěv přichází z Googlu na konkrétní píseň.

Druhá situace je výběr, co hrát: v klidu, na mobilu nebo na počítači.

## Product Purpose

Bekovy songy (bekovysongy.cz) je online zpěvník s akordy. Přes 600 zveřejněných písní, hlavně česky, asi šestina anglicky, pár slovensky a polsky. Zdarma, bez registrace a bez reklam. Úspěch znamená, že během hraní jde text s akordy přečíst z dálky a nástroje jsou na jedno klepnutí, a že se píseň najde rychle.

Priority (z redesign-zadani.md): 1. čitelnost textu a akordů při hraní, 2. rychlé nalezení písně, 3. všechno ostatní.

## Positioning

Osobní zpěvník jedné party, ne katalog. Česká notace akordů (H, B, mi), refrény sbalené do značek, transpozice, auto-rolování, metronom a ladička přímo ve webu a celý zpěvník stažitelný na chatu bez signálu.

## Operating Context

- Mobil je hlavní zařízení (asi 90 % použití); tablet i na šířku a počítač musí fungovat taky.
- Seznam písní (od 2026-10-20 přímo na úvodní stránce, /na-kytaru jen přesměrovává): nejčastěji se píše známý název nebo interpret, projíždí se seznam pro inspiraci a klepe se na náhodnou píseň nebo na to, co nově přibylo. Filtr „akordy, které umím“ se používá spíš výjimečně (potvrzeno 2026-10-19).
- PWA s offline režimem: otevřené písně fungují bez internetu, tlačítko „Stáhnout offline“ stáhne celý zpěvník.

## Capabilities and Constraints

- Statický web: HTML, CSS, čistý JavaScript, bez frameworku a bez serveru. Hostuje GitHub Pages, deploy publikuje jen vyjmenované cesty (`.github/workflows/deploy-pages.yml`).
- Data: `songs.json` (název, slug, interpreti, akordy, `progression` po částech, jazyk, capo, `added`), `search-index.json` (texty pro fulltext, generuje se při deployi).
- Seznam umí: hledání bez ohledu na diakritiku, shody v názvu/interpretovi zvlášť od shod v textu (od 3 znaků, s ukázkou řádku), `?q=` v URL (cíl SearchAction z Googlu), filtry akordy/jazyk/capo, řazení podle české abecedy, náhodná píseň z vyfiltrovaného bez opakování posledních 20, štítek NEW u písní přidaných za posledního půl roku, zachování stavu po návratu ze stránky písně.
- Celé rozhraní česky, tykání, neformální tón.
- Česká notace akordů: H = mezinárodní B, B = B♭, moll jako `mi`.
- Ovladatelné klávesnicí i čtečkou obrazovky.
- Nové funkce ukládané jen v prohlížeči (oblíbené, naposledy hrané, playlist na večer) jsou povolené, v návrzích označené jako nové (potvrzeno 2026-10-19).

## Brand Commitments

- Název „Bekovy songy“, logo/název vede na úvod, kterým je přímo zpěvník. Jen kytara: foukací harmoniku a kalimbu majitel zrušil (2026-10-20).
- Signature barva projektu je oranžová #e67e22 na černé (#0e0d0c), potvrzeno 2026-10-20.
- Vzhled je otevřený: zadání pro redesign výslovně netrvá na současných barvách, písmu ani rozvržení.

## Evidence on Hand

- Skutečný obsah: 611 zveřejněných písní v `songs.json`, 172 konceptů „k vytvoření“ (neveřejné), texty v `songs/*.html`.
- Žádné recenze, počty uživatelů ani citace. Nic takového se nesmí vymýšlet.

## Product Principles

1. Hraní má přednost: co je čitelné z dálky a ovladatelné palcem, vyhrává nad hustotou a ozdobou.
2. Najít píseň do pár vteřin podle toho, co si člověk pamatuje: název, interpret nebo řádek textu.
3. Funguje offline, stejně dobře na chatě jako doma.
4. Bez registrace, bez reklam, bez zbytečností.

## Accessibility & Inclusion

Čitelnost za šera i na slunci, dotykové cíle pro palec (min. 44 px), ovládání klávesnicí a čtečkou obrazovky.
