# Přechod na vlastní doménu `bekovysongy.cz` — checklist

> Stav teď: web běží na **GitHub Pages** přes Actions deploy
> (`.github/workflows/deploy-pages.yml`), veřejná adresa
> `https://bekousek.github.io/bekovysongy/`. Netlify je vypnuté.
> `/admin` je za Google přihlášením (jen `ondrejbek8@gmail.com`), GitHub token
> v prohlížeči. Tenhle soubor je TODO pro připojení vlastní domény — po dokončení
> ho můžeš smazat.

## ⚠️ Nejdůležitější, na co nezapomenout
1. **Google OAuth origins** musí dostat novou doménu, jinak přestane fungovat
   přihlášení do `/admin` (krok 4).
2. **Custom domain u Actions deploye se nastavuje v Pages Settings**, ne přes
   `CNAME` soubor (krok 3).
3. **Žádné změny cest v kódu nejsou potřeba** — web používá jen relativní cesty,
   funguje na podcestě i na rootu domény. (Ověřeno: jediné výskyty `bekovysongy.cz`
   jsou `mailto:` odkazy v písních, ty s hostingem nesouvisí.)

---

## Krok 1 — DNS záznamy u poskytovatele domény
Nejdřív zjisti, **kde se DNS pro `bekovysongy.cz` spravuje** (registrátor domény,
nebo to zůstalo na Netlify DNS / jiných nameserverech). Tam se mění následující.

**Smaž** staré záznamy mířící na Netlify (A/ALIAS/CNAME na `*.netlify.app` apod.).

**Přidej** záznamy pro GitHub Pages:

Apex `bekovysongy.cz` → 4× **A**:
```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```
Apex `bekovysongy.cz` → 4× **AAAA** (IPv6, doporučeno):
```
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
```
`www.bekovysongy.cz` → **CNAME** → `bekousek.github.io`

> Pozn.: jako kanonickou zvol apex `bekovysongy.cz`; `www` se na ni bude
> přesměrovávat automaticky (GitHub Pages to řeší sám, když je nastavená custom
> domain a existuje www CNAME).

Ověř propagaci (počítej s minutami až hodinami):
```bash
dig +short bekovysongy.cz A
dig +short www.bekovysongy.cz CNAME
```

## Krok 2 — (volitelné, doporučené) Ověření domény v GitHubu
Brání převzetí domény někým cizím.
GitHub: **Settings (účet) → Pages → Verify domains** → přidej `bekovysongy.cz`,
vlož vypsaný `TXT` záznam do DNS, klikni Verify.

## Krok 3 — Nastavit custom domain v GitHub Pages
Protože deploy jede přes **GitHub Actions**, doména se nastaví v Pages settings
(ne přes `CNAME` soubor v repu). Buď přes web, nebo CLI:

Web: **repo → Settings → Pages → Custom domain** → `bekovysongy.cz` → **Save**.

Nebo CLI:
```bash
gh api -X PUT repos/bekousek/bekovysongy/pages -f cname=bekovysongy.cz
gh api repos/bekousek/bekovysongy/pages --jq '.cname, .html_url, .https_enforced'
```

> Po nastavení GitHub začne provisionovat TLS certifikát (Let's Encrypt) —
> jakmile DNS odpovídá. Může to chvíli trvat.

## Krok 4 — ⚠️ Google OAuth origins (jinak nepůjde /admin login)
V Google Cloud Console (projekt s OAuth klientem, Client ID
`606957226831-ii7i1f725cscngskp3htedeqvv9cinhk.apps.googleusercontent.com`):
**APIs & Services → Credentials → ten OAuth Web client → Authorized JavaScript
origins** → přidej:
```
https://bekovysongy.cz
https://www.bekovysongy.cz
```
(Starý `https://bekousek.github.io` můžeš nechat jako fallback, nebo později smazat.)
Propsání nové origin trvá někdy pár minut.

> `GOOGLE_CLIENT_ID` v kódu (`js/editor.js`) se **nemění** — je to stejný klient,
> jen přidáváš povolené originy.

## Krok 5 — Zapnout Enforce HTTPS
Až je certifikát hotový: **repo → Settings → Pages → Enforce HTTPS** (zaškrtnout).
Případně přes API ověř `https_enforced: true`.

## Krok 6 — Ověření po přepnutí
1. `https://bekovysongy.cz/` načte web (a `www.` i `http://` přesměruje na https apex).
2. `https://bekovysongy.cz/admin/` → přihlášení Googlem `ondrejbek8@gmail.com`
   projde a editor funguje (pokud hlásí chybu originu, počkej pár minut po kroku 4).
3. Ulož testovací změnu → commit → **Actions** deploy → změna live.

---

## Co NENÍ potřeba měnit
- **Cesty/odkazy v HTML/JS** — vše relativní, funguje na rootu domény i na podcestě.
- **`GOOGLE_CLIENT_ID`** — zůstává stejný.
- **Workflow `deploy-pages.yml`** — beze změny.

## Volitelné úklidy (nesouvisí s hostingem)
- Sjednotit „Nahlásit chybu" `mailto:` v písních — část používá
  `bek@bekovysongy.cz`, editor nově píše `ondrejbek8@gmail.com`. (Kosmetika.)
- Po úspěšném přepnutí smazat tenhle soubor.
- Případně nastavit `homepageUrl` repa na `https://bekovysongy.cz`.

## Rollback
Když něco nevyjde, web pořád běží na `https://bekousek.github.io/bekovysongy/`.
Custom domain lze odebrat: `gh api -X PUT repos/bekousek/bekovysongy/pages -f cname=''`
(nebo smazat v Settings → Pages), DNS vrátit zpět.
