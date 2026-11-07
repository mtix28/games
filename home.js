// Home grid — builds the game cards from the GAMES registry in manifest.js.
// buildHome(grid) fills the given element (hub.js passes #grid). Starred games persist in localStorage and sort to the front.

const AI_APPS = ["Claude", "Codex", "ChatGPT", "Cursor", "Gemini"];

function buildHome(grid) {
  let rotTimer = 0;
  // the app name on the "add" card cycles through AI_APPS; all names share one grid cell, so the slot is as wide as the widest
  function startRotator(rot) {
    clearInterval(rotTimer);
    if (!rot || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const words = [...rot.children];
    let i = 0;
    rotTimer = setInterval(() => {
      if (!rot.isConnected) { clearInterval(rotTimer); return; }
      const prev = words[i];
      i = (i + 1) % words.length;
      prev.classList.remove("on"); prev.classList.add("out");
      words[i].classList.remove("out"); words[i].classList.add("on");
      setTimeout(() => prev.classList.remove("out"), 450);
    }, 2200);
  }
  let stars = loadStarSet();

  function loadStarSet() {
    try { return new Set(JSON.parse(localStorage.getItem("game_stars") || "[]")); } catch { return new Set(); }
  }
  function saveStarSet(set) {
    try { localStorage.setItem("game_stars", JSON.stringify([...set])); } catch {}
  }

  let sketches = [];
  const revealed = new Set(); // cards already shown don't animate again on a rebuild

  // scroll reveal: cards get .in as they enter the viewport (each design tunes the
  // motion in themes.css); the class is dropped afterwards so hover transitions are normal
  const revealer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => {
        if (e.isIntersecting) { 
          const el = e.target;
          el.classList.add("in");
          revealed.add(el.dataset.id);
          revealer.unobserve(el);
          setTimeout(() => el.classList.remove("reveal", "in"), 1800);
        }
      }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" })
    : null;

  function buildCards() {
    sketches.forEach((sk) => sk.remove());
    sketches = [];
    grid.innerHTML = "";
    const sorted = [...GAMES].sort((a, b) => {
      const as = stars.has(a.id) ? 0 : 1;
      const bs = stars.has(b.id) ? 0 : 1;
      return as - bs;
    });

    sorted.forEach((game, idx) => {
      const a = document.createElement("a");
      a.className = "card" + (revealer && !revealed.has(game.id) ? " reveal" : "");
      a.style.setProperty("--i", idx % 3);
      a.href = game.id + "/";
      a.dataset.id = game.id;
      a.innerHTML = `
        <div class="preview"></div>
        <div class="card-text">
          <div class="card-title">${game.title}</div>
          <div class="card-desc">${game.desc}</div>
        </div>
        <button class="star-btn${stars.has(game.id) ? " starred" : ""}" title="${stars.has(game.id) ? "Unstar game" : "Star game"}" aria-label="${stars.has(game.id) ? "Unstar" : "Star"} ${game.title}" aria-pressed="${stars.has(game.id) ? "true" : "false"}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="star-icon">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
      `;

      const starBtn = a.querySelector(".star-btn");
      starBtn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        const wasStarFocused = document.activeElement === starBtn;
        if (stars.has(game.id)) {
          stars.delete(game.id);
        } else {
          stars.add(game.id);
        }
        saveStarSet(stars);
        buildCards();
        if (wasStarFocused) {
          const newStarBtn = grid.querySelector(`.card[data-id="${game.id}"] .star-btn`);
          if (newStarBtn) newStarBtn.focus();
        }
      });

      grid.appendChild(a);
      if (revealer && !revealed.has(game.id)) revealer.observe(a);

      // inject p5 canvas as preview
      const holder = a.querySelector(".preview");
      sketches.push(new p5(function(p) {
        p.setup = function() {
          const cnv = p.createCanvas(600, 360);
          cnv.parent(holder);
          p.noLoop();
          themeSketch(p);
          game.preview(p, 600, 360);
        };
      }));
      designCard(a, game, idx);   // design-specific decoration (designs/<id>.js)
    });

    // last card: "Eigenes Spiel hinzufügen" → modal with a ready-made prompt (hub-custom.js)
    const add = document.createElement("button");
    add.type = "button";
    add.className = "card card-add";
    add.innerHTML = `
      <div class="preview">
        <svg viewBox="0 0 24 24" class="add-plus" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>
      </div>
      <div class="card-text">
        <div class="card-title">Eigenes Spiel hinzufügen</div>
        <div class="card-desc">Baue mit <span class="rot" aria-hidden="true">${AI_APPS.map((n, i) => `<span${i ? "" : ' class="on"'}>${n}</span>`).join("")}</span><span class="sr-only">Claude</span> ein neues Spiel für die Sammlung</div>
      </div>`;
    add.addEventListener("click", openCustomGame);
    startRotator(add.querySelector(".rot"));
    grid.appendChild(add);
  }

  // previews are drawn once, so wait for the canvas font before drawing them,
  // and redraw them whenever the design changes
  // (a design's stylesheet/script must be in before its cards are built)
  const rebuild = () => Promise.all([themeFontReady(), themeAssetsReady()]).then(() => {
    buildCards();
    designMount();
  });
  rebuild();
  window.addEventListener("themechange", rebuild);
}

// ---- "Eigenes Spiel hinzufügen": a universal prompt the user pastes into Claude Code (or any coding agent) ----

const CUSTOM_GAME_PROMPT = `Du bist ein Coding-Agent und hilfst mir, ein neues Spiel für die Open-Source-Spielesammlung malte9799/games zu bauen. Gehe genau in diesen Schritten vor:

## 1. Repository vorbereiten
Forke das Repository https://github.com/malte9799/games auf meinen GitHub-Account (falls ich Schreibrechte habe, reicht ein Klon), klone den Fork, lege einen neuen Branch an und installiere die Abhängigkeiten (pnpm install). Lies danach README.md und docs/games.md – dort steht, wie ein Spiel aufgebaut ist und welche Dateien man anfasst.

## 2. Fragerunde (sehr wichtig – baue noch nichts!)
Stelle mir Fragen mit dem Fragen-Tool (z. B. AskUserQuestion) oder, falls du keins hast, als nummerierte Liste mit Antwortmöglichkeiten. Immer 2–4 konkrete Optionen anbieten, ich kann auch frei antworten.
  1. Was für ein Spiel? Schlage mir 3 passende Ideen vor, die zur Sammlung passen (schau dir dafür die vorhandenen Spiele an) (Puzzle, Arcade, Karten, Denkspiel …) und lass Platz für einen Freitext. Warte auf meine Antwort.
  2. Danach stelle weitere Fragen – allgemeine und spielspezifische, so viele wie nötig, aber nur sinnvolle:
     - Einzelspieler oder Mehrspieler (lokal / online im Raum)? Gegen KI?
     - Stil: retro, modern, minimalistisch, neon, handgezeichnet …?
     - 2D oder 3D?
     - Steuerung: Maus/Touch, Tastatur, beides? Muss es auf dem Handy gut spielbar sein?
     - Schwierigkeitsstufen, Level, Highscore, Zeitdruck?
     - Weitere Design-Entscheidungen: Farben, Sound, Animationen, Name des Spiels.
     - Spielspezifische Regeln und Sonderfälle, die ich festlegen sollte.
  3. Fasse am Ende alle Entscheidungen kurz zusammen und lass sie mich bestätigen, bevor du anfängst.

## 3. Spiel erstellen
Baue das Spiel nach den Konventionen aus docs/games.md (eigene Spieldatei, Eintrag in manifest.js bzw. für Mehrspieler in hub.js, Vorschau-Funktion). Halte dich an das bestehende Theme-System und den Code-Stil, ändere nichts an anderen Spielen. Starte den Dev-Server (pnpm dev) und prüfe selbst, dass es läuft und keine Konsolenfehler gibt.

## 4. Testen lassen
Sag mir, wie ich das Spiel lokal starte (Befehl und URL), und was ich ausprobieren soll. Warte auf mein Feedback und arbeite es ein, bevor du weitermachst.

## 5. Pull Request
Wenn ich zufrieden bin: committe, pushe den Branch (in meinen Fork) und erstelle einen Pull Request gegen malte9799/games mit kurzer Beschreibung (Spielidee, Steuerung, Besonderheiten).`;

function openCustomGame() {
  if (document.getElementById("custom-game-modal")) return;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const b = document.createElement("div");
  b.className = "info-backdrop";
  b.id = "custom-game-modal";
  b.innerHTML = `<div class="info-modal custom-game" role="dialog" aria-modal="true" aria-labelledby="custom-game-t">
    <button class="info-btn custom-game-x" type="button" aria-label="Schließen">✕</button>
    <h2 class="info-title" id="custom-game-t">Eigenes Spiel hinzufügen</h2>
    <p class="info-text">Jeder kann ein Spiel beisteuern: Kopiere diesen Prompt in Claude Code (oder einen anderen Coding-Agent). Er forkt das Repository, fragt dich nach deinen Wünschen, baut das Spiel, lässt dich testen und schlägt es am Ende per Pull Request für die Sammlung vor.</p>
    <textarea class="custom-game-prompt" readonly spellcheck="false">${esc(CUSTOM_GAME_PROMPT)}</textarea>
    <div class="custom-game-actions"><button type="button" class="primary custom-game-copy">Prompt kopieren</button></div>
  </div>`;
  const close = () => { b.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const ta = b.querySelector("textarea");
  const copy = b.querySelector(".custom-game-copy");
  copy.addEventListener("click", async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(CUSTOM_GAME_PROMPT); ok = true; } catch {}
    if (!ok) { ta.focus(); ta.select(); try { ok = document.execCommand("copy"); } catch {} }
    copy.textContent = ok ? "Kopiert ✓" : "Markiert – Cmd/Strg+C drücken";
    setTimeout(() => { copy.textContent = "Prompt kopieren"; }, 2000);
  });
  b.addEventListener("click", (e) => { if (e.target === b || e.target.closest(".custom-game-x")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(b);
  copy.focus();
}
