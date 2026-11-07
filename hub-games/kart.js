// Kart-Rennen im Mehrspieler-Hub: 2–6 Fahrer, Mario-Kart-Stil (Drift, Turbo, Items), Three.js low poly.
// Die Engine liegt in hub-games/kart/ und wird auch von der Solo-Seite (games/kart.js) benutzt.
// Der Host wählt im Spiel Strecke und Runden und startet; jeder Client fährt sein eigenes Kart und schickt seine Lage.

import { shell } from "../hub-kit.js";

export default {
  min: 2, max: 6,
  async mount(ctx) {
    const kit = shell(ctx, { title: "Kart-Rennen" });
    kit.body.innerHTML = `<p class="hub-loading">Lade Rennstrecke …</p>`;
    let game;
    try {
      const { createKart } = await import("./kart/game.js");
      kit.body.innerHTML = "";
      game = await createKart({
        root: kit.body, solo: false, players: ctx.players, me: ctx.me,
        net: {
          send: (t, d, to) => ctx.send(t, d, to),
          onMessage: (t, fn) => ctx.onMessage(t, fn),
          onEvent: (ev, fn) => ctx.onEvent(ev, fn),
          get isHost() { return !!ctx.isHost; },
          get hostId() { return ctx.hostId; },
        },
      });
    } catch (e) {
      console.error(e);
      kit.body.innerHTML = `<p class="hub-loading">Kart-Rennen konnte nicht geladen werden.</p>`;
      return {};
    }
    return {
      go() { game.go(); },
      destroy() { game.destroy(); },
    };
  },
};
