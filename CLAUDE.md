# CLAUDE.md

Pokyny pro Clauda v tomhle repozitáři. Struktura projektu je v [README.md](README.md).

## Pravidlo č. 1: text písně se nesmí dostat modelu do kontextu

Anthropic API má výstupní filtr na doslovnou reprodukci textů písní. Když model
vypustí sloku, filtr utne odpověď uprostřed generování a vrátí

```
API Error: 400 Output blocked by content filtering policy
```

Celý tah je pryč. Není to chyba repozitáře ani promptu a není to rozhodnutí
modelu — je to kontrola nad tím, co z modelu leze, a spouští se bez ohledu na
to, proč text vznikl.

**Nestačí text nepsat do souborů.** Filtr hlídá všechno, co model vygeneruje:
větu v chatu, průběžné shrnutí, zdůvodnění „tenhle řádek patří k refrénu,
protože…", i uvažování v thinking bloku. Jakmile je text písně v kontextu,
dřív nebo později se o něj model otře a spadne to — i když soubory zapisuje
korektně přes skript.

Proto se text do kontextu vůbec nepouští. Všechno, co je k přeformátování
potřeba, je struktura, a tu vypíše `tools/skel.cjs` bez jediného písmene textu.

Konkrétně tedy **nikdy**: `cat songs/*.html`, `fmt.cjs dump`, Read nad souborem
písně, grep, který vrátí řádek textu, citace v chatu ani v commit message.

## Přeformátování písně

Import kdysi nechal za každým řádkem prázdný řádek. Cílový tvar:

- sloka i refrén **bez prázdných řádků uvnitř**
- jednotlivé části oddělené **jedním** prázdným řádkem
- **bez číslování slok** — vyjma písní, kde se některá sloka opakuje

Písně, které formát mají v pořádku, se nechávají být.

### 1. Najít kandidáty

```bash
node tools/scan.cjs
```

Tři seznamy, tři podoby té škody:

- **rozsyp** — dlouhá série jednořádkových bloků. Skutečná píseň má občas
  osamocený řádek („Mezihra:", tag), nemá jich pět za sebou. Pozor na písně,
  které končí stohem `//R//` — ty vypadají stejně a přitom jsou v pořádku.
- **osamocený řádek** — týž import ukrájel slokám poslední řádek po jednom.
  Jeden jednořádkový blok není série, takže první seznam ho nevidí; poznají
  se podle toho, že sousedí s blokem o jeden řádek kratším, než je v té písni
  obvyklé.
- **číslování slok** — s doporučením, jestli sundat, nebo nechat. Nechává se,
  když čísla něco říkají: odkaz zpět („4.=1."), týž číslo dvakrát, nebo dvě
  čísla na sousedních řádcích (to je první a druhé zakončení, ne slokování).

### 2. Vypsat kostru

```bash
node tools/skel.cjs <slug>
```

Jeden řádek na řádek písně: číslo, dochovaná značka (`//R`, `1.`, `Refrén:`),
délka ve znacích, otisk a akordy jménem. Prázdné řádky jsou vodorovné čáry,
holé značky mají vlastní řádek. Čísla jsou ta, kterými adresuje specifikace.

Z toho se pozná všechno podstatné, a tři sloupce nesou nejvíc:

- **Otisk řeší refrény.** Když má řádek 39 stejný otisk jako řádek 21, je to
  tentýž řádek, takže 39 je začátek opakovaného refrénu. `*4` u otisku říká,
  že se ten řádek v písni vyskytuje čtyřikrát.
- **Akordy řeší délku sekce.** Sloka a refrén mají jinou harmonii a cyklus se
  opakuje po délce bloku — kde začne znovu, tam začíná další blok.
- **ZNAČKA řeší krátké řádky.** `[Chorus]`, `Mezihra:` a spol. se porovnávají
  se seznamem uvnitř skriptu, takže ven jde jen verdikt. Značka se buď
  `drop`ne a nahradí fencí, nebo zůstane jako `raw` — krátký řádek **bez**
  verdiktu je text a nesmí zmizet.

Číst text k tomu netřeba, a `fmt.cjs dump` je proto pro člověka, ne pro model.

### 3. Napsat specifikaci

Do `.fmt-specs/<slug>.json`, sekce v pořadí výstupu. **Jen čísla, žádný text:**

```json
[{"t":"raw","l":"1"},{"t":"","l":"2-7"},{"t":"R","l":"8-11"},{"t":"","l":"12-17"},{"t":"R","l":""}]
```

| zápis | co vznikne |
|---|---|
| `{"t":"","l":"2-7"}` | obyčejná sloka, řádky 2–7 |
| `{"t":"R","l":"8-11"}` | refrén — `//R … R//` |
| `{"t":"R","l":""}` | opakovaný refrén — `//R R//` |
| `{"t":"R","l":"","n":"2x"}` | `//R 2x R//` |
| `{"t":"B","l":"12-16"}` | bridge |
| `{"t":"raw","l":"1"}` | řádek doslova, bez fence (tabulatura, „Mezihra:") |
| `{"t":"R","l":"20","tail":true}` | refrén s jiným koncem — `//R` / `...` / řádek 20 / `R//` |
| `{"t":"R","l":"","bare":true}` | `//R//` místo `//R R//` — pro holou značku, která tak už v písni je |
| `{"t":"R","l":"9-12","block":true}` | značky na vlastních řádcích místo na prvním a posledním |

`"l"` bere i výčet rozsahů (`"1-4,9"`). Pole jde obalit volbami:
`{"stripNum":true,"drop":"13","sections":[…]}` — `stripNum` sundá číslování slok,
`drop` smaže řádky (holé „Refrén", ze kterého se stal `//R R//`), `strip`
sundá kus řádku podle čísla (`{"15":"3. "}`, nebo `{"15":["3 ",". "]}`, když
`stripNum` na číslo nedosáhne, protože mu dovnitř spadl akordový span). Úplný
popis formátu je v hlavičce `tools/fmt.cjs`.

Jestli `block`, nebo ne, se řídí tím, jak značka v písni už stojí — přeformátování
má srovnat prázdné řádky, ne přesázet značky, kterých se nikdo neptal.

### 4. Použít a ověřit

```bash
sh tools/run.sh <slug>...
```

Pro každý slug vrátí soubor z HEAD, aplikuje `.fmt-specs/<slug>.json` a ověří.
`apply` odmítne zapsat, pokud kterýkoli řádek zůstane nepoužitý nebo se použije
dvakrát — vypadlá či zdvojená sloka je jediná chyba, která nesmí projít tiše.
Řádky se jen přeskládají, nikdy nepřepíšou, takže akordové spany přežijí byte
po bytu. `verify.cjs` pak proti HEAD potvrdí, že pořadí akordů i text sedí.

Při chybě řekne, která píseň a kolikáté slovo — ne které. Ta slova jsou text
písně a platí pro ně pravidlo č. 1. Kdo si je chce přečíst, přidá `--why`
(`verify.cjs <slug> --why`, `fmt.cjs apply … --why` u smazaných řádků); ten
výstup patří člověku do terminálu, ne modelu do kontextu.

Dokud změna není zacommitovaná, vychází se pokaždé z originálu, takže jde
spustit opakovaně — spec se dá v klidu opravit a pustit znovu.

**Pozor:** specifikace platí vůči tomu stavu písně, na který se aplikovala.
Jakmile je přeformátovaná verze zacommitovaná, `git checkout HEAD` vrátí už
tu novou — čísla řádků pak sedí na něco jiného a `apply` vyrobí nesmysl, aniž
by si stěžoval. Hotové písně se znovu nepouštějí; spec je od té chvíle jen
záznam pro `verify.cjs`.

### Když kostra nestačí

Někdy z ní nejde poznat, kde končí sloka a začíná refrén. Řešením **není**
podívat se na text — je to zeptat se Ondřeje. Ten píseň zná, odpoví jednou
větou a filtr zůstane stranou. `fmt.cjs dump` existuje jen pro ruční ladění
člověkem, ne pro model.

## Když filtr přesto sepne

Tah je pryč, soubory na disku ale ne — `git status` ukáže, co už je hotové,
a dá se pokračovat další písní. Nezkoušej tu samou cestu znovu: co jednou
vzniklo z modelu, vznikne z něj i podruhé.

Dokud jde všechno přes `scan.cjs`, `skel.cjs` a `run.sh`, žádný text do kontextu
neteče a dávka písní je v pohodě. Nebezpečí začíná tam, kde se sáhne po čemkoli,
co text vypisuje — `dump`, `--why`, `cat`, `grep` nad písní. Od té
chvíle jedna píseň na tah.
