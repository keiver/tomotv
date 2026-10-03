/** The playback suite receives the app's probe events over HTTP, and an item ends on the event itself. */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

function run(body) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `import {startProbeListener} from './scripts/playback-regression.mjs'; const out = await (async () => { ${body} })(); console.log(JSON.stringify(out));`],
      {
        cwd: path.resolve(__dirname, "../.."),
        encoding: "utf8",
      },
    ),
  );
}

describe("probe listener", () => {
  it("keeps each item's events in arrival order and refuses a body that is not JSON", () => {
    const out = run(`
      const l = await startProbeListener();
      const url = "http://127.0.0.1:" + l.port + "/probe";
      const send = (body) => fetch(url, { method: "POST", body }).then((r) => r.status);
      const statuses = [await send(JSON.stringify({ event: "start", itemId: "a" })), await send(JSON.stringify({ event: "mode", itemId: "a" })), await send(JSON.stringify({ event: "start", itemId: "b" })), await send("not json")];
      const a = l.events("a").map((e) => e.event);
      l.reset();
      const afterReset = l.events("a").length;
      l.close();
      return { statuses, a, afterReset };
    `);
    expect(out).toEqual({ statuses: [204, 204, 204, 400], a: ["start", "mode"], afterReset: 0 });
  });

  it("wakes the waiting run on an event, including one that landed before it waited", () => {
    const out = run(`
      const l = await startProbeListener();
      const url = "http://127.0.0.1:" + l.port + "/probe";
      let t = Date.now();
      setTimeout(() => fetch(url, { method: "POST", body: JSON.stringify({ event: "mode", itemId: "a" }) }), 50);
      await l.next(10000);
      const woke = Date.now() - t;
      await fetch(url, { method: "POST", body: JSON.stringify({ event: "ended", itemId: "a" }) });
      t = Date.now();
      await l.next(10000);
      const early = Date.now() - t;
      t = Date.now();
      await l.next(100);
      const quiet = Date.now() - t;
      l.close();
      return { woke: woke < 5000, early: early < 5000, quiet: quiet >= 90 };
    `);
    expect(out).toEqual({ woke: true, early: true, quiet: true });
  });
});
