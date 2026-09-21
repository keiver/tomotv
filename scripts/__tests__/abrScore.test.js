const { execFileSync } = require("node:child_process");
const path = require("node:path");

function evaluate(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", `import {score, variantRuns} from './scripts/lib/abr-score.mjs'; console.log(JSON.stringify(${expression}));`], {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8",
    }),
  );
}

describe("Slipstream scoring", () => {
  it("reports a missed startup target without treating it as playback failure", () => {
    const result = evaluate(`score('S5', [
      {kind:'start', ms:0},
      {kind:'firstFrame', ms:9930, position:0},
      {kind:'tick', ms:150000, position:140.07, advanced:true, status:2},
      {kind:'end', ms:150000}
    ])`);
    expect(result.startup).toEqual({ milliseconds: 9930, targetMs: 8000, meetsTarget: false });
    expect(result.checks.find((check) => check.name === "plays").ok).toBe(true);
    expect(result.checks.some((check) => check.name === "starts inside the budget")).toBe(false);
  });

  it("still rejects a run that never shows a frame", () => {
    const result = evaluate(`score('S5', [{kind:'start', ms:0}, {kind:'end', ms:150000}])`);
    expect(result.startup).toEqual({ milliseconds: null, targetMs: 8000, meetsTarget: false });
    expect(result.pass).toBe(false);
    expect(result.checks.find((check) => check.name === "plays").ok).toBe(false);
  });

  it.each(["S4", "S8"])("rejects an item replacement in %s", (scenario) => {
    const result = evaluate(`score('${scenario}', [{kind:'start', ms:0}, {kind:'firstFrame', ms:2000, position:0}, {kind:'climb', ms:61000}, {kind:'end', ms:150000}])`);
    expect(result.checks.find((check) => check.name === "player item survives")).toMatchObject({ ok: false, detail: "1 replacements, 0 allowed" });
  });

  it("does not turn failed or abandoned fetches into a variant switch", () => {
    const result = evaluate(`variantRuns([
      {kind:'req', ms:1000, path:'seg0.m4s', status:200, bytes:100},
      {kind:'req', ms:2000, path:'t0-seg0.m4s', status:200, bytes:0},
      {kind:'req', ms:3000, path:'t1-seg0.m4s', status:503, bytes:100},
      {kind:'req', ms:4000, path:'seg1.m4s', status:200, bytes:100}
    ])`);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ variant: "copy", count: 2 });
  });

  it("rejects a temporary track loss even when the final catalogue recovers", () => {
    const result = evaluate(`score('S7', [
      {kind:'firstFrame', ms:2000, position:0},
      {kind:'tracks', ms:5000, audio:1},
      {kind:'textTracks', ms:5000, subtitles:2},
      {kind:'end', ms:390000, audible:2, legible:3}
    ], {expectAudio:2, expectSubs:3})`);
    expect(result.checks.find((check) => check.name === "all audio tracks listed").ok).toBe(false);
    expect(result.checks.find((check) => check.name === "all subtitle tracks listed").ok).toBe(false);
  });
});
