# Implementierungsplan: Avatar + Accessoire im Multiplayer

Ziel: Emoji-Avatare durch Bild-Avatare (`/avatar/`) plus ein Accessoire (`/avatar/accessoires/`) ersetzen, mit Offsets aus `meta.json`, synchronisiert über Trystero/Nostr, persistent in `localStorage`.

## 0. Voraussetzungen / Assets

- Assets liegen in `public/avatar/` (7 Avatare) und `public/avatar/accessoires/` (26 gültige Accessoires, 12 verworfen laut `meta.json` → `discarded`).
- `public/avatar/meta.json` enthält `avatarAdjustments` (nur `y`) und `adjustments` (x, y, scale, rotation) im 1024×1024-Raum.
- Gültige Dateilisten müssen im Code hartcodiert werden (kein Directory-Listing im Browser). Quelle: `avatar_tester.html` (`avatarFiles`, `accFiles`).

## 1. Datenstruktur & Persistenz

### localStorage

| Key | Wert | Semantik |
|---|---|---|
| `mp_avatar` | Dateiname, z. B. `animal_mascot_1.png` | Avatar (ersetzt Emoji) |
| `mp_accessory` | Dateiname oder `""` | Accessoire oder „Keines" |
| `mp_color` | (unverändert) | Hintergrundfarbe |
| `mp_name` | (unverändert) | Name |

### In-Memory / Room-State

In `R` (Room) und in jedem Spieler-Objekt wird `accessory` ergänzt:

```
R = { ..., avatar, accessory, color, players: [{ id, name, avatar, accessory, color }] }
```

### Validierung

```js
const AVATAR_FILES = [ /* 7 */ ];
const ACCESSORY_FILES = [ /* 26 */ ];
const AVATAR_KEY = "mp_avatar";
const ACCESSORY_KEY = "mp_accessory";

const cleanAvatar = (a) => (AVATAR_FILES.includes(a) ? a : "");
const cleanAccessory = (a) => (a === "" || ACCESSORY_FILES.includes(a) ? (a || "") : "");
```

### Erstbesuch-Logik (Zufall, dann localStorage)

```js
const myAvatar = () => {
  const s = store.get(AVATAR_KEY);
  if (AVATAR_FILES.includes(s)) return s;
  const r = AVATAR_FILES[Math.floor(Math.random() * AVATAR_FILES.length)];
  store.set(AVATAR_KEY, r);
  return r;
};
const myAccessory = () => {
  const s = store.get(ACCESSORY_KEY);
  if (s === "") return "";                 // explizit "Keines" gewählt
  if (ACCESSORY_FILES.includes(s)) return s;
  const r = ACCESSORY_FILES[Math.floor(Math.random() * ACCESSORY_FILES.length)];
  store.set(ACCESSORY_KEY, r);
  return r;
};
```

Hinweis: `""` in localStorage muss als „Keines" interpretiert werden. Um „noch nie gewählt" von „Keines" zu unterscheiden, wird beim ersten Aufruf immer ein zufälliges Accessoire gesetzt (siehe oben: nur wenn weder `""` noch gültige Datei → Zufall). Wer „Keines" wählt, speichert `""` explizit.

### meta.json laden

```js
let META = null;
const loadMeta = () => fetch("avatar/meta.json")
  .then(r => r.ok ? r.json() : null)
  .then(d => { META = d; ui.render(); })   // Re-Render, sobald Offsets da sind
  .catch(() => {});
loadMeta();
```

Helper:

```js
const avatarAdj = (f) => (META && META.avatarAdjustments && META.avatarAdjustments[f]) || { y: 0 };
const accAdj    = (f) => (META && META.adjustments && META.adjustments[f]) || { x: 0, y: 0, scale: 100, rotation: 0 };
```

## 2. Rendering (Composite)

CSS-basiert, transform-skaliert auf Containergröße `S` (Faktor `S/1024`).

```js
const compHtml = (av, acc, size) => {
  const f = size / 1024;
  const aa = avatarAdj(av);
  const aay = (aa.y || 0) * f;
  let accImg = "";
  if (acc) {
    const ad = accAdj(acc);
    const ax = (ad.x || 0) * f;
    const ay = (ad.y || 0) * f;
    const sc = (ad.scale || 100) / 100;
    const rot = ad.rotation || 0;
    accImg = `<img class="mp-av-layer mp-av-acc" src="avatar/accessoires/${esc(acc)}"
      style="transform:translate(${ax}px,${ay}px) scale(${sc}) rotate(${rot}deg);" alt="" />`;
  }
  return `<span class="mp-av-comp" style="width:${size}px;height:${size}px;">
    <img class="mp-av-layer mp-av-base" src="avatar/${esc(av)}" style="transform:translate(0px,${aay}px);" alt="" />
    ${accImg}
  </span>`;
};
```

- Caching: `const COMP_CACHE = new Map();` Key `${av}|${acc}|${size}` → HTML-String. Vor dem Rendern prüfen.
- Fallback ohne META: Offsets = 0 (erst nach loadMeta neu rendern).

CSS (multiplayer.css):

```css
.mp-av-comp { position: relative; display: inline-block; vertical-align: middle; overflow: visible; }
.mp-av-layer { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; transform-origin: center center; pointer-events: none; }
```

## 3. Multiplayer-Sync (Trystero/Nostr)

Erweiterung des bestehenden Protokolls (rückwärtskompatibel: fehlende Felder → `clean*` → default):

- `R` und Player-Objekte: `accessory`.
- `host()` / `join()` / `resume()` / `becomeHost()`: `accessory: myAccessory()`.
- `onPeerJoin` (guest → host): `hello` enthält `accessory`.
- `hello`-Handler: `avatar: cleanAvatar(m.avatar), accessory: cleanAccessory(m.accessory), color: cleanColor(m.color)`.
- `wireLobby()` / `cleanPlayers()`: `accessory` durchreichen.
- `snapshot()` / `playerOf()`: `accessory` im Output.
- `profile`-Message: `accessory` mitsenden.
- `updateProfile({ name, avatar, accessory, color })`: localStorage + R + Player + Broadcast.
- `start()`: Player-Payload um `avatar/accessory/color` erweitern; `onStart` merged diese in R.players.
- `cleanPlayers`: accessory-Feld validieren.

## 4. Profil-Panel UI (multiplayer.js + css)

Im bestehenden `#mp-prof` (ersetzt Emoji-Picker):

- Avatar-Grid: Bilder aus `AVATAR_FILES` (Pfad `avatar/...`), Auswahl markiert.
- Accessoire-Grid: Bilder aus `ACCESSORY_FILES` (Pfad `avatar/accessoires/...`) plus erster Button „Keines" (data-v="").
- Farb-Grid: unverändert.
- Vorschau oben: `compHtml(R.avatar, R.accessory, 96)` (großer Kreis).
- Name-Feld: unverändert.

Click-Handler:

```js
case "avatar": updateProfile({ avatar: b.dataset.v, ... }); break;
case "accessory": updateProfile({ accessory: b.dataset.v, ... }); break; // "" = Keines
```

Create-Room-Form: Avatar/Accessoire/Farbe nicht mehr dort (wie im Branch `feat/profile-menu-rework`); nur Profil-Panel.

## 5. Spielerliste & Dock

- Lobby-Liste (`<ul class="mp-pl">`): statt Emoji-`<i class="mp-av">` jetzt `compHtml(p.avatar, p.accessory, 30)`.
- Dock (`#mp-dock`): `compHtml(p.avatar, p.accessory, 32)` plus Krone.
- Eigener großer Button (`mp-me-big`): `compHtml(...)`.

CSS: `.mp-av` (Text) wird durch `.mp-av-comp` ersetzt; Größen via inline width/height.

## 6. Erstbesuch-Logik (Zufall)

- `myAvatar()` / `myAccessory()` wie in Abschnitt 1: bei fehlendem/ungültigem Wert Zufallswahl + `store.set`.
- Wird beim `host()`/`join()`/`resume()` für `R.avatar`/`R.accessory` verwendet.
- Dadurch ist beim ersten Besuch ein zufälliger Avatar + Accessoire gesetzt und persistiert.

## 7. Dateien die geändert werden müssen

1. `multiplayer.js`
   - Konstanten: `AVATARS` → `AVATAR_FILES`, neu `ACCESSORY_FILES`, `ACCESSORY_KEY`.
   - `cleanAvatar`, neu `cleanAccessory`.
   - `myAvatar`, neu `myAccessory`.
   - `store` unverändert.
   - `loadMeta()` + `avatarAdj()`/`accAdj()`.
   - `compHtml()` + Cache.
   - `R`/Player-Objekte um `accessory`.
   - Wire-Protocol: `hello`, `lobby`, `profile`, `wireLobby`, `cleanPlayers`, `snapshot`, `playerOf`, `start`.
   - `updateProfile`-Signatur.
   - UI: `render()`, `renderProf()`, `pickers()`, `click()` (neuer `accessory`-Case), Listen/Dock.
2. `multiplayer.css`
   - `.mp-av-comp`, `.mp-av-layer`.
   - Avatar/Accessoire-Grid-Styles (`.mp-av-pick` mit img).
   - Profil-Panel-Layout anpassen.
3. (Optional) `meta.json` nicht ändern (Rohdaten).
4. Assets bereits vorhanden.

## 8. Nicht-funktionale Anforderungen

- Performance: Composite-HTML cachen (Map). Bilder vom Browser gecacht.
- Offline/fehlendes META: Fallback Offsets 0; nach Load neu rendern.
- Rückwärtskompatibilität: alte `mp_avatar` mit Emoji → `cleanAvatar` gibt `""` → `myAvatar()` setzt Zufall. Alte Clients ohne `accessory` → `cleanAccessory(undefined)` → `""`.
- Nur Multiplayer betroffen (keine Singleplayer-Änderungen).

## 9. Test-Checkliste

- Erster Besuch: zufälliger Avatar+Accessoire in Profil, persistiert.
- Profil wechseln: Grid-Auswahl, Vorschau aktualisiert, Sync an andere Spieler live.
- „Keines": Accessoire verschwindet.
- Spielerliste/Dock zeigen Composite.
- Reload: Auswahl erhalten.
- meta.json-Offsets sichtbar (Hüte sitzen).
- Multiplayer-Raum mit 2 Clients: Avatar/Accessoire des anderen live aktualisiert.
- Alte `mp_avatar`-Emoji-Werte werden migriert.
