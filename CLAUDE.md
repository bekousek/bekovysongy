# CLAUDE.md

Pokyny pro Clauda v tomhle repozitáři. Struktura projektu je v [README.md](README.md).

## Pravidlo č. 1: text písně nesmí projít modelem

Anthropic API má výstupní filtr na doslovnou reprodukci textů písní. Jakmile
model vygeneruje sloku, celý tah spadne na

```
API Error: 400 Output blocked by content filtering policy
```

a rozdělaná práce je pryč. Není to chyba repozitáře ani promptu — je to filtr
nad tím, co model napíše.

Rozdíl, na kterém všechno stojí:

- **Číst písně je v pořádku.** `cat`, `grep`, `fmt.cjs dump` — výsledek nástroje
  není výstup modelu, filtrem neprochází.
- **Psát text písně není.** Write tool s celým souborem, heredoc v bashi,
  Python string, `sed` s kusem textu, ukázka „před/po" v chatu, citace v commit
  message — tam všude text vzniká z modelu a filtr sepne.

Proto se píseň **nikdy nepřepisuje ručně**. Přeformátovat ji jde tak, že model
řekne jen *čísla řádků* a přeskládá je skript.

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

### 2. Vypsat očíslované řádky

```bash
node tools/fmt.cjs dump <slug>
```

Bez přepínače se akordové spany zkrátí na `[C]`; `--raw` je nechá tak, jak jsou,
`--num` odřízne vedoucí číslo sloky.

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

### 4. Použít

```bash
node tools/fmt.cjs apply <slug> .fmt-specs/<slug>.json
```

Specifikace se předává **cestou k souboru**, ne inline. `apply` odmítne zapsat,
pokud kterýkoli řádek zůstane nepoužitý nebo se použije dvakrát — vypadlá či
zdvojená sloka je jediná chyba, která nesmí projít tiše. Řádky se jen přeskládají,
nikdy nepřepisují, takže akordové spany přežijí byte po bytu.

### 5. Ověřit

```bash
node tools/verify.cjs <slug>...
```

Porovná pracovní kopii s `git HEAD`: pořadí akordů a samotný text (bez značek,
číslování a mezer) musí sedět. Řádky, které spec vědomě maže, se odečtou i na
straně HEAD — smazání, které ve specifikaci není, je `FAIL`. To je smysl věci.

Specifikaci vždy ulož do `.fmt-specs/`. Je to jediný záznam o tom, co se s písní
stalo, a `verify.cjs` z ní čte deklarované `drop`/`strip`.

### Zkratka

```bash
sh tools/run.sh <slug>...
```

Pro každý slug vrátí soubor z HEAD, aplikuje `.fmt-specs/<slug>.json` a rovnou
ověří. Protože se vždycky vychází z originálu, jde spustit opakovaně — spec se
dá v klidu opravit a pustit znovu.

## Když filtr přesto sepne

Tah je pryč, soubory na disku ale ne — `git status` ukáže, co už je hotové,
a dá se pokračovat další písní. Nezkoušej tu samou cestu znovu: co jednou
vzniklo z modelu, vznikne z něj i podruhé.
