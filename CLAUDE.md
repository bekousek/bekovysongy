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

Vypíše písně s dlouhou sérií jednořádkových bloků — otisk rozbitého importu.
Skutečná píseň má občas osamocený řádek („Mezihra:", tag), nemá jich pět za sebou.

### 2. Vypsat kostru

```bash
node tools/skel.cjs <slug>
```

Jeden řádek na řádek písně: číslo, dochovaná značka (`//R`, `1.`, `Refrén:`),
délka ve znacích, počet akordů a otisk. Prázdné řádky jsou vodorovné čáry,
holé značky mají vlastní řádek. Čísla jsou ta, kterými adresuje specifikace.

Z toho se pozná všechno podstatné: kde jsou hranice bloků, kde je série
jednořádkových bloků (to je ta škoda), a kde jsou sloky pravidelně dlouhé.
**Otisk řeší refrény** — když má řádek 39 stejný otisk jako řádek 21, je to
tentýž řádek, takže 39 je začátek opakovaného refrénu. Číst text k tomu netřeba.

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

`"l"` bere i výčet rozsahů (`"1-4,9"`). Pole jde obalit volbami:
`{"stripNum":true,"drop":"13","sections":[…]}` — `stripNum` sundá číslování slok,
`drop` smaže řádky (holé „Refrén", ze kterého se stal `//R R//`). Úplný popis
formátu je v hlavičce `tools/fmt.cjs`.

### 4. Použít a ověřit

```bash
sh tools/run.sh <slug>...
```

Pro každý slug vrátí soubor z HEAD, aplikuje `.fmt-specs/<slug>.json` a ověří.
`apply` odmítne zapsat, pokud kterýkoli řádek zůstane nepoužitý nebo se použije
dvakrát — vypadlá či zdvojená sloka je jediná chyba, která nesmí projít tiše.
Řádky se jen přeskládají, nikdy nepřepíšou, takže akordové spany přežijí byte
po bytu. `verify.cjs` pak proti HEAD potvrdí, že pořadí akordů i text sedí.

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
vzniklo z modelu, vznikne z něj i podruhé. Zpracovávej písně **po jedné**;
dávka osmi písní znamená osminásobnou šanci, že se něco z kontextu otře ven.
