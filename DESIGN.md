---
name: Bekovy songy
description: Zpěvník s akordy pro telefon položený na koleni, oranžová na teplé černé.
colors:
  campfire-orange: "#e67e22"
  charred-ink: "#160b02"
  night-black: "#0e0d0c"
  soot: "#181716"
  ash: "#262422"
  pressed-ash: "#312e2b"
  hairline: "#211f1d"
  slate: "#4a4744"
  bone-white: "#f2f2f0"
  smoke: "#b6b1aa"
  dim-smoke: "#98928b"
  ok-green: "#3fbf6f"
  warn-amber: "#e5a93b"
  danger-rose: "#e5566f"
  tuned-ground: "#111a13"
  tuned-surface: "#142017"
typography:
  display:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  song-title:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  lyrics:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.75
  chord:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.75
  body:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  button:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1
  label:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.3
  tab-label:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.2
rounded:
  tag: "6px"
  chord-chip: "10px"
  field: "12px"
  tile: "14px"
  panel: "16px"
  card: "20px"
  sheet: "24px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  gap: "14px"
  pad: "16px"
  pad-wide: "24px"
  section: "28px"
components:
  button-primary:
    backgroundColor: "{colors.campfire-orange}"
    textColor: "{colors.charred-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-quiet:
    backgroundColor: "{colors.ash}"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.smoke}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "48px"
  chip:
    backgroundColor: "{colors.soot}"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "44px"
  chip-on:
    backgroundColor: "{colors.bone-white}"
    textColor: "{colors.night-black}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "44px"
  search-field:
    backgroundColor: "{colors.soot}"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.pill}"
    padding: "0 52px 0 50px"
    height: "52px"
  song-row:
    backgroundColor: "{colors.night-black}"
    textColor: "{colors.bone-white}"
    typography: "{typography.title}"
    padding: "12px 4px 12px 16px"
  tag:
    backgroundColor: "{colors.ash}"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.tag}"
    padding: "0 7px"
    height: "20px"
  card:
    backgroundColor: "{colors.soot}"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.card}"
    padding: "20px"
  sheet:
    backgroundColor: "{colors.soot}"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.sheet}"
    padding: "4px 20px 12px"
  chord-chip:
    backgroundColor: "transparent"
    textColor: "{colors.campfire-orange}"
    rounded: "{rounded.chord-chip}"
    padding: "0 8px"
    height: "44px"
  chord-toggle-on:
    backgroundColor: "{colors.campfire-orange}"
    textColor: "{colors.charred-ink}"
    rounded: "{rounded.field}"
    height: "44px"
  song-pill:
    backgroundColor: "{colors.soot}"
    textColor: "{colors.smoke}"
    rounded: "{rounded.pill}"
    padding: "0 14px 0 11px"
    height: "44px"
  song-pill-on:
    backgroundColor: "{colors.campfire-orange}"
    textColor: "{colors.charred-ink}"
    rounded: "{rounded.pill}"
    padding: "0 14px 0 11px"
    height: "44px"
  tab-bar:
    backgroundColor: "{colors.night-black}"
    textColor: "{colors.dim-smoke}"
    typography: "{typography.tab-label}"
    height: "64px"
  song-toolbar:
    backgroundColor: "{colors.night-black}"
    textColor: "{colors.bone-white}"
    height: "70px"
---

# Design System: Bekovy songy

Platí pro veřejný web: seznam písní v kořeni (`index.html`, `css/app.css`, `js/app.js`), stránky písní (`css/style.css` + `js/player.js`, které staví lišty kolem statických `songs/*.html`) a `404.html` / `offline.html`. Admin (`admin/`, `css/admin-base.css`, `css/editor.css`) má vlastní starý vzhled a tenhle systém se ho netýká.

Tokeny jsou ve frontmatteru výš; v kódu žijí jako CSS proměnné na `:root` ve dvou souborech, `css/app.css` a `css/style.css`, se stejnými hodnotami. Kdo změní jeden, mění i druhý. Mapa jmen: `--accent` = campfire-orange, `--on-accent` = charred-ink, `--ground` = night-black, `--surface` = soot, `--raised` = ash, `--press` = pressed-ash, `--rule` = hairline, `--control` = slate, `--text` = bone-white, `--muted` = smoke, `--faint` = dim-smoke, `--ok` / `--warn` / `--danger` = stavové barvy.

## Overview

**Creative North Star: "Telefon na koleni"**

Všechno se poměřuje jednou situací: kytara v rukou, telefon leží na koleni nebo na stole, svítí jen oheň a na displej se kouká z půl metru. Text písně dostane celou obrazovku a velké písmo, akordy jsou tučně oranžové přímo v řádku, a ovládání, které se sahá uprostřed písně, se schová do dvou úzkých lišt na okrajích, kam dosáhne palec. Seznam písní je appka do kapsy: tmavá, spodní lišta s pěti záložkami, hledání nahoře, žádná ozdoba, která by nesloužila hledání.

Hustota je střední a klidná. Hloubka se dělá světlostí tří odstínů teplé černé, ne stíny. Oranžová je jediná barva s významem: akord, nebo věc, která něco udělá. Všechno ostatní je kost, kouř a popel. Pohyb je krátký a věcný (150 ms barva, 240 ms vysunutí sheetu) a při `prefers-reduced-motion` mizí.

Vědomě odmítnuto majitelem: akordy nad textem (jen v řádku), harmonika a kalimba, starý navy vzhled se třemi nástroji. Oranžová #e67e22 na černé #0e0d0c je potvrzená signature projektu.

**Key Characteristics:**
- Tmavá teplá černá, tři tonální stupně, žádná šedá se studeným nádechem.
- Jeden akcent, oranžový, vyhrazený akordům a akcím.
- Figtree ve čtyřech řezech (400–700), žádné druhé písmo.
- Velké dotykové cíle (min. 44 px), ovládání u spodního okraje.
- Pilulky pro ovládací prvky, zaoblené karty pro obsahové bloky.
- Stránka seznamu se nikdy neroluje celá: roluje `#scroller`, aby lišty mobilního prohlížeče neposkakovaly.

## Colors

Teplá noční paleta: tři stupně sazí a popela, kostěně bílý text a jedna oranžová jako žhavý uhlík.

### Primary
- **Campfire Orange** (`--accent`): akordy všude (v řádku seznamu, v liště akordů, v textu písně), primární tlačítko, plus u písně, zapnuté přepínače, štítek kapodastru, značky sekcí („R:“) a čísla tónin. Kontrast na night-black 6.8:1, na ash 5.4:1.
- **Charred Ink** (`--on-accent`): text a ikony na oranžové ploše (6.8:1). Nikdy bílá na oranžové, ta má jen 2.85:1.

### Neutral
- **Night Black** (`--ground`): pozadí stránky, spodní lišty, lepicí pás hledání, lišta akordů.
- **Soot** (`--surface`): první vrstva nad pozadím. Pole hledání, čipy, karty, sheety, prázdné stavy, hover řádku na desktopu.
- **Ash** (`--raised`): druhá vrstva. Tlačítko „quiet“, štítky (EN, Capo 2, Nová), dlaždice tónů, toast, zvýrazněný akord.
- **Pressed Ash** (`--press`): stav `:active` u prvků na soot.
- **Hairline** (`--rule`): 1px čáry mezi řádky a pod lištami.
- **Slate** (`--control`): vypnutá dráha přepínače, oddělovač skupin akordů, úchyt sheetu, okraj textových polí. Nikdy na text.
- **Bone White** (`--text`): hlavní text a fokusový prstenec (17.3:1).
- **Smoke** (`--muted`): interpret, podtitulky, sekundární tlačítka (9.1:1).
- **Dim Smoke** (`--faint`): počty, nápovědy, neaktivní záložky, placeholder (6.3:1). Nejsvětlejší povolená šedá pro text.

### Status
- **Ok Green** (`--ok`), **Warn Amber** (`--warn`), **Danger Rose** (`--danger`): jen tečka stavu společného večera a stav ladičky (naladěno / chyba). Vždy s textem vedle, nikdy jako jediný nositel významu.

### Named Rules
**Pravidlo žhavého uhlíku.** Oranžová znamená buď akord, nebo „tohle něco udělá“. Nadpis, ozdoba ani rámeček kvůli efektu ji nedostanou.

**Pravidlo jednoho plamene.** Na jedné obrazovce je nejvýš jedno vyplněné oranžové tlačítko. Když se objeví hlavní akce (Začít hrát), ostatní tlačítka ustoupí do `btn-quiet`.

## Typography

**Písmo:** Figtree (Google Fonts, 400/500/600/700), záloha `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Jedno písmo pro všechno včetně textu písní; akord se od textu liší řezem a barvou, ne fontem.

**Character:** Přátelský geometrický grotesk s otevřenými tvary, čitelný z dálky i v malém. Tykající, neformální, bez kapitálek a bez proložení.

### Hierarchy
- **Display** (600, 28 px, na ≥900 px 32 px, lh 1.15, -0.02em): nadpis záložky (Písně, Interpreti, Dnešní večer) a vylosovaná píseň v Objevit (26/32 px).
- **Song title** (700, 26 px, na ≥900 px 32 px, lh 1.15, -0.02em): `h1` na stránce písně.
- **Headline** (600, 20 px, -0.01em): bloky (Nově přidané, Oblíbené), nadpisy sheetů a karty pozvánky.
- **Title** (600, 17 px, lh 1.3): název písně v řádku seznamu, jméno interpreta v seznamu interpretů (500).
- **Lyrics** (400, 19 px × `--scale`, lh 1.75): text písně. Uživatel si mění velikost 70–150 % přes `--scale`.
- **Chord** (700, barva campfire-orange): akord v textu, v liště akordů 17 px, v řádku seznamu 15/500.
- **Body** (400, 15 px, lh 1.45): běžný text seznamu, popisky, prázdné stavy.
- **Button** (600, 16 px): popisky tlačítek, i na 404 a offline stránce. Menší tlačítka v kartách mají 15 px, „Začít hrát“ 18 px.
- **Label** (500, 13 px): počty, nápovědy, popisky skupin. Záložky 12 px/500, popisky spodní lišty písně 11 px/500.

### Named Rules
**Pravidlo akordu v řádku.** Akord stojí v textu tam, kde se mění, tučně a oranžově. Nikdy nad řádkem, nikdy v jiném fontu.

**Pravidlo visícího řádku.** Každý řádek písně je vlastní blok (`.ln`, staví ho `player.js`). Když se na telefonu nevejde, pokračování se odsadí o 1em, aby se zalomení nedalo splést s dalším veršem.

**Pravidlo čísel v řadě.** Počty, tóniny, BPM a pořadí mají `font-variant-numeric: tabular-nums`, aby při změně neposkakovaly.

## Layout

Mobil je výchozí (asi 90 % použití), jeden sloupec s okrajem 16 px (`--pad`). Seznam má max. šířku 1100 px, stránka písně 820 px (ve dvou nebo třech sloupcích textu 1240 px).

Seznam: nahoře app bar 52 px se značkou, pod ním nadpis záložky, pak lepicí pás s hledáním (52 px) a vodorovně rolovatelnými čipy filtrů. Řádky písní jdou od okraje k okraji s vlasovou čarou odsazenou o `--pad`. Spodní lišta záložek je 64 px plus `safe-area-inset-bottom`, při psaní do hledání se schová. Celý obsah roluje uvnitř `#scroller`, stránka sama ne.

Stránka písně: nahoře lepicí lišta akordů 52 px (zpět, akordy písně po sekcích, prstoklady), dole pevná lišta nástrojů 70 px (tónina, rolování, Další). Text mezi nimi s dolním odsazením, aby ho lišta nikdy nepřekryla.

Od 900 px: záložky se přesunou do hlavičky jako pilulky, řádek seznamu se rozloží do tří sloupců (název + interpret | akordy | akce), sheety se z dolního okraje změní na dialog uprostřed (520 px seznam, 480 px píseň), lišta nástrojů písně se vznáší jako zaoblený panel 560 px dole uprostřed, interpreti jdou do dvou sloupců a `--pad` je 24 px.

Rytmus mezer: 6 / 10 / 14 / 16 / 28 px. Těsně uvnitř skupiny (6–10), mezi skupinami velkoryse (26–30 nad nadpisem bloku, 4 pod ním).

## Elevation & Depth

Systém je plochý a vrstvený světlostí: night-black → soot → ash → pressed-ash. Karta, čip, pole i sheet sedí o stupeň výš než podklad, bez rámečku a bez stínu. Vlasová čára (`--rule`, 1px) odděluje řádky a lišty.

Stín mají jen věci, které se vznášejí nad obsahem a dají se odklepnout: toast, pilulka metronomu, bublina prstokladu a plovoucí lišta nástrojů na desktopu. Pozadí pod modálním sheetem je černé na 60 %.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45)`): toast, pilulka metronomu.
- **Popover** (`box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55)`): bublina s prstokladem akordu.
- **Dock** (`box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5)`): lišta nástrojů písně na ≥900 px.

### Named Rules
**Pravidlo sazí.** Hloubka se dělá o stupeň světlejší plochou. Rámeček pod stínem ani stín na kartě v toku stránky se nepoužívají.

**Pravidlo oranžového obrysu.** Karta, která chce pozornost (sdílený večer, nabídka sloučení, potvrzení smazání), dostane celý obrys 1.5 px v campfire-orange. Barevný pruh jen po levé straně ne.

## Shapes

Dva tvary: pilulka pro všechno, na co se klepe (tlačítka, čipy, hledání, záložky na desktopu, stepper, segmentový přepínač, štítek kapodastru), a měkce zaoblený obdélník pro obsah (karty 20 px, sheet 24 px nahoře, dlaždice tónů 14 px, panely 16 px, tlačítka akordů a pole 12 px, akord v liště 10 px, štítky 6 px). Fokusový prstenec a drobné prvky mají 6 px. Ikony jsou tahové SVG v mřížce 24 px s tahem 1.75 a kulatými konci (`SL.icon` v `js/song-list-core.js`); značka je vlastní nota ve stejné oranžové.

## Components

### Buttons
- **Shape:** pilulka (999 px), výška 48 px, 600/16 px, ikona 18–24 px s mezerou 8 px.
- **Primary:** campfire-orange s charred-ink, padding 0 22px. Jedno na obrazovku. V Dnešním večeru s písněmi je to „Začít hrát“ (56 px, 18 px písmo); pozvánka pak ustoupí do quiet.
- **Quiet:** ash s bone-white. Výchozí sekundární akce (Jinou, Zamíchat, Stáhnout offline, Kopírovat).
- **Ghost:** průhledné se smoke textem (Vyčistit, Opustit večer).
- **Text button:** oranžový text 600 bez plochy, min. výška 44 px (Změnit, Vybrat všechny, Vrátit).
- **States:** `:active` zmenší na 0.97 (120 ms) a ztmaví na pressed-ash; `disabled` má 55 % krytí; zapnutý přepínač (`aria-pressed="true"`) se vyplní oranžovou.

### Chips
- **Style:** soot pilulka 44 px, 500, ikona 16 px ve smoke, chevron u filtrů s výběrem.
- **State:** aktivní filtr se obrátí na bone-white plochu s night-black textem; „Zrušit filtry“ je průhledný čip ve smoke.

### Song row (podpisová komponenta seznamu)
- Název 17/600, za ním štítky (EN, Capo 2, Nová) v ash 12/500; pod ním interpreti ve smoke jako samostatná tlačítka; pod nimi akordy v oranžové po skupinách oddělených tenkou svislou čarou ve slate.
- Celý řádek otevírá píseň (`::after` přes řádek), srdce a plus vpravo jsou samostatné cíle 44×48 px. Srdce je dim-smoke, zapnuté bone-white vyplněné; plus je oranžové, zapnuté oranžové kolečko s fajfkou.
- Na stránce interpreta se jméno interpreta u řádku ukáže jen u písní se spoluautorem.
- Shoda hledání je podtržená oranžovou 2 px; úryvek textu je kurzívou ve smoke se shodou bone-white.

### Cards / Containers
- **Corner Style:** 20 px (prázdný stav 16 px).
- **Background:** soot na night-black; uvnitř karty se vnořené plochy dávají do ash.
- **Shadow Strategy:** žádný (viz Elevation).
- **Border:** jen karty pozornosti, 1.5 px campfire-orange.
- **Internal Padding:** 16–22 px.

### Inputs / Fields
- **Hledání:** soot pilulka 52 px, lupa vlevo ve smoke, křížek vpravo 44 px, písmo 17 px (na iOS nezoomuje). Fokus: 2 px bone-white obrys celé pilulky.
- **Textové pole** (jméno ve večeru, hlášení chyby): night-black s 1px slate okrajem, zaoblení 12–14 px, výška 46 px. Fokus: 2 px oranžový obrys dovnitř.

### Navigation
- **Mobil:** spodní lišta 64 px, pět záložek se stejnou šířkou, ikona 24 px nad popiskem 12 px. Neaktivní dim-smoke, aktivní bone-white 600. Odznak počtu písní večera je oranžové kolečko 18 px. Druhé klepnutí na aktivní záložku vyjede nahoru.
- **≥900 px:** záložky v hlavičce jako pilulky 44 px s ikonou 18 px, aktivní na soot.

### Sheet
Jeden `<dialog>` pro všechny volby. Na mobilu vyjede zespodu (soot, zaoblení 24 px nahoře, úchyt 40×4 px ve slate, max. 86–88vh), na desktopu dialog uprostřed. Nadpis 20/600, zavírací kroužek 44 px, volby jako řádky 52 px s fajfkou, patička s tlačítky vedle sebe.

### Chord bar a lišta nástrojů (stránka písně)
- **Lišta akordů:** night-black, akordy písně jako 44px cíle v oranžové 17/700, skupiny sekcí oddělené svislou čarou ve slate. Klepnutí ukáže prstoklad; zapnutý akord dostane ash plochu.
- **Lišta nástrojů:** tónina (− hodnota +) a rolování (− přehrát +) jako dvě skupiny s popiskem 11 px pod nimi, vpravo „Další“. Posunutá tónina svítí oranžově, běžící rolování je oranžové tlačítko s pauzou.
- **Pilulky písně:** Ukázka / Oblíbit / Do večera pod názvem, soot 44 px se smoke textem, zapnuté oranžové.
- **Opakovaný refrén:** sbalený do pilulky se značkou „R:“ a ikonou opakování (soot, 1px slate okraj); klepnutí ho rozbalí na místě.

### Ladička (stránka písně)
Celoobrazovkový `<dialog>` (`js/tuner.js`), od 900 px panel 480 px uprostřed jako sheet. Čte se z kolena, proto jediná výjimka z typové škály: **písmeno struny 128 px/700** (96 px na nízkých displejích, 80 px na šířku). Ostatní je na škále: číslo struny 17/600, stav 20/600 s ikonou, centy 15/600 tabulkovými číslicemi, nápověda 13 px.
- **Měřák:** plochý oblouk ±50 centů s ručičkou v bone-white, která vychází zpod okraje. Od středu k ručičce roste pruh ve warn-amber, pásmo ±5 centů je ok-green. Pod obloukem „nízko“ a „vysoko“.
- **Stavy:** jantarová = „ještě ne“ (Nízko, utáhni / Vysoko, povol, s šipkou), zelená = Naladěno. Při naladění dostane celá plocha zelený nádech (`--tuned-ground` #111a13, na desktopu `--tuned-surface` #142017), aby to bylo vidět přes místnost. Bez signálu zůstane poslední čtení ztlumené na 45 %. Barva vždy s textem.
- **Struny:** dlaždice 64 px (soot, na desktopu ash), název 19/700 a číslo struny 12 px. Slyšená struna má vnitřní 2px prstenec v barvě stavu, připnutá (klepnutím) je bone-white plocha, naladěná má zelený odznak s fajfkou. Nad nimi segment Kytara/Ukulele a přepínač Auto.
- **Chyba mikrofonu:** místo měřáku nadpis v danger-rose, jedna věta, co udělat, a quiet tlačítko Zkusit znovu. Tóny strun fungují dál, ladí se podle sluchu.
- Tokeny `--tuned-*` žijí jen v `css/style.css`, ladička na seznamu není.

### Tištěný zpěvník (PDF)
Moje → Na papír: výběr písní v sheetu (hledání, rychlé volby jako čipy, zaškrtávátka 24 px vyplněná oranžovou), PDF skládá `js/songbook-pdf.js` (jsPDF z cdnjs, Figtree TTF z `assets/fonts`). Na papíře platí jiná pravidla než na displeji: bílá stránka, černé písmo a **akordy tučně na světle šedém podkladu** (šeď 212/255, zaoblení 0.2 em). Oranžová by se na černobílé tiskárně slila s textem do stejné šedi, kdežto podklad zůstane čitelný i při úsporném tisku. Jedna píseň na A4, 1–3 sloupce, písmo 14 až 6 pt podle skóre „velikost minus zalomené řádky“; dvě strany jen výjimečně. Capo jako orámovaný štítek, opakovaný refrén jen „R:“, tabulatura v Courier. Na začátku obsah se stránkami.

### Toast
Ash, zaoblení 16 px, 600/15 px, max. šířka obrazovky minus 32 px, zalamuje se. Nad spodní lištou, mizí po 1.6–2.6 s.

## Do's and Don'ts

### Do:
- **Do** dávat akordy tučně oranžově přímo do řádku textu, na všech místech stejně.
- **Do** držet každý dotykový cíl aspoň na 44 px; ovládání pro hraní patří k dolnímu okraji.
- **Do** dělat hloubku o stupeň světlejší plochou (night-black → soot → ash → pressed-ash).
- **Do** psát text na oranžové v charred-ink (#160b02).
- **Do** měnit tokeny v obou souborech zároveň (`css/app.css` i `css/style.css`) a při změně CSS/JS/HTML zvednout `CACHE_NAME` v `sw.js`.
- **Do** dělat změny vzhledu stránek písní v `js/player.js` a `css/style.css`; `songs/*.html` se kvůli vzhledu needitují.
- **Do** dávat fokus jako 2px bone-white prstenec s odstupem 2 px.
- **Do** psát česky, tykat a pojmenovat tlačítka akcí, kterou udělají („Začít hrát“, „Stáhnout offline“).

### Don't:
- **Don't** dávat akordy nad text. Majitel to odmítl.
- **Don't** dávat dvě vyplněná oranžová tlačítka na jednu obrazovku.
- **Don't** psát bílý text na oranžovou (2.85:1) ani šedý text na oranžovou.
- **Don't** vracet starou navy paletu (#16213e, #1a1a2e a spol.). Patří jen do adminu.
- **Don't** přidávat harmoniku, kalimbu ani jiný nástroj; zpěvník je jen na kytaru.
- **Don't** dávat kartám v toku stránky stín ani barevný pruh po straně.
- **Don't** používat emoji ani znaky Unicode místo ikon; ikony jsou z `SL.icon`.
- **Don't** nechat celou stránku seznamu rolovat; roluje jen `#scroller`.
