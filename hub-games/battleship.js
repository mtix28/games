// Battleship (Schiffe versenken) für den Mehrspieler-Hub — zu zweit, jede Seite hält ihre Flotte geheim.
// Die Spiellogik und die ganze Oberfläche liegen in games/battleship.js (Factory `createBattleship`);
// hier wird sie nur in den Rahmen des Hubs gehängt. Nachrichten: "bs" (ready / start / shot / res / rematch).

import { shell } from "../hub-kit.js";

const SRC = new URL("../games/battleship.js", import.meta.url).href;

function load(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed " + src));
    document.head.appendChild(s);
  });
}

export default {
  min: 2, max: 2,

  async mount(ctx) {
    const kit = shell(ctx, { title: "Schiffe versenken" });
    window.__BATTLESHIP_HUB__ = true;                        // kein Solo-Start beim Laden des Skripts
    if (!window.createBattleship) await load(SRC);
    const game = window.createBattleship({ root: kit.body, net: ctx });
    return { go: () => game.go(), destroy: () => game.destroy() };
  },
};
