const { execFileSync } = require("node:child_process");
const path = require("node:path");

function evaluate(expression) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {score, variantRuns, profileRates, copyBitrates, playerSelections, stallEpisodes} from './scripts/lib/abr-score.mjs'; import {deviceTimeline} from './scripts/abr-drill.mjs'; console.log(JSON.stringify(${expression}));`,
      ],
      {
        cwd: path.resolve(__dirname, "../.."),
        encoding: "utf8",
      },
    ),
  );
}

function recordedRun({ id = "S1", seconds = 60, kbps = 0, events = [], omit = [], options = {} } = {}) {
  const timeline = [
    { kind: "start", ms: 0 },
    { kind: "rate", ms: 0, atSec: 0, kbps },
    { kind: "master", ms: 0, text: "#EXTM3U\nmedia.m3u8\nt0.m3u8\nt1.m3u8\nt2.m3u8\nt3.m3u8\n" },
    { kind: "cap", ms: 0, mbps: 8 },
    { kind: "firstFrame", ms: 2000, position: 0 },
    { kind: "access", ms: 2000, indicated: 6_400_000, position: 0 },
    { kind: "tick", ms: seconds * 1000, position: seconds - 2, advanced: true, status: 2 },
    { kind: "end", ms: seconds * 1000 },
  ].filter((record) => !omit.includes(record.kind));
  return evaluate(
    `score(${JSON.stringify(id)}, ${JSON.stringify([...timeline, ...events])}, ${JSON.stringify({ ladder: [260_000, 520_000], heights: [144, 240], sourceBps: 6_400_000, copyBps: [6_400_000], ...options })})`,
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
    const result = evaluate(`score('${scenario}', [{kind:'start', ms:0}, {kind:'firstFrame', ms:2000, position:0}, {kind:'reload', ms:61000}, {kind:'end', ms:150000}])`);
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

  it("passes measured progress and player-reported selection without claiming displayed quality", () => {
    const result = recordedRun();
    expect(result.status).toBe("PASS");
    expect(result.checks.find((check) => check.name.startsWith("player reports the copy")).detail).toContain("not a displayed-frame measurement");
  });

  it("keeps extra rung downloads diagnostic when AVPlayer reports the copy", () => {
    const result = recordedRun({ events: [0, 1, 2, 3].map((segment) => ({ kind: "req", ms: 3000 + segment * 1000, path: `t0-seg${segment}.m4s`, status: 200, bytes: 100 })) });
    expect(result.status).toBe("PASS");
    expect(result.diagnostics.find((entry) => entry.name === "video deliveries").detail).toContain("4 rung");
    expect(result.checks.some((check) => check.name === "plays the copy, not a rung")).toBe(false);
  });

  it("does not gate on the half-link download floor or request reversals", () => {
    const result = recordedRun({
      id: "S2",
      seconds: 90,
      kbps: 1500,
      omit: ["access"],
      options: { ladder: [260_000, 360_000, 520_000, 920_000], heights: [144, 144, 240, 360] },
      events: [
        { kind: "access", ms: 2000, indicated: 260_000 },
        ...["t0", "t3", "t0", "t3", "t0", "t3", "t0"].map((variant, index) => ({ kind: "req", ms: 46000 + index * 6000, path: `${variant}-seg${index}.m4s`, status: 200, bytes: 100 })),
      ],
    });
    expect(result.status).toBe("PASS");
    expect(result.diagnostics.find((entry) => entry.name.startsWith("request reversals")).detail).toContain("5 after");
  });

  it.each(["master", "access", "rate", "cap", "end"])("marks missing %s evidence incomplete, not passed", (kind) => {
    const result = recordedRun({ omit: [kind] });
    expect(result.status).toBe("INCOMPLETE");
    expect(result.pass).toBe(false);
  });

  it("does not replace missing player evidence with successful downloads", () => {
    const result = recordedRun({ omit: ["access"], events: [{ kind: "req", ms: 5000, path: "seg0.m4s", status: 200, bytes: 100 }] });
    expect(result.status).toBe("INCOMPLETE");
  });

  it("marks an unmapped latest bitrate incomplete instead of carrying an older copy report", () => {
    expect(recordedRun({ events: [{ kind: "access", ms: 40000, indicated: 123456 }] }).status).toBe("INCOMPLETE");
  });

  it("maps both original audio associations and refuses ambiguous bitrate matches", () => {
    expect(evaluate(`copyBitrates({primaryVideoBandwidth:6000000, audioTracks:[{bandwidth:640000}], tiers:[{}]})`)).toEqual([6_640_000, 6_120_000]);
    expect(evaluate(`copyBitrates({serverVideoOnly:true, primaryVideoBandwidth:6000000})`)).toEqual([]);
    const selections = evaluate(`playerSelections([{kind:'access',ms:1,indicated:260000}], {ladder:[260000],copyBps:[260000]})`);
    expect(selections[0].variant).toBeNull();
  });

  it("uses the latest proxy profile and actual transition timestamps", () => {
    const rates = evaluate(`profileRates([
      {kind:'profile',t:100,steps:[{atSec:0,kbps:600}]},
      {kind:'rate',reason:'profile',t:2000,atSec:0,kbps:1500},
      {kind:'profile',t:2001,steps:[{atSec:0,kbps:1500},{atSec:60,kbps:30000}]},
      {kind:'rate',reason:'profile',t:62503,atSec:60,kbps:30000},
      {kind:'rate',reason:'control',t:99000,kbps:0}
    ],5000)`);
    expect(rates).toEqual([
      { kind: "rate", ms: -3000, atSec: 0, kbps: 1500 },
      { kind: "rate", ms: 57503, atSec: 60, kbps: 30000 },
    ]);
  });

  it("times recovery from the actual rise and excludes requests started before it", () => {
    const result = recordedRun({
      id: "S4",
      seconds: 150,
      kbps: 1500,
      omit: ["access"],
      events: [
        { kind: "access", ms: 2000, indicated: 260000 },
        { kind: "rate", ms: 62500, atSec: 60, kbps: 30000 },
        { kind: "access", ms: 130000, indicated: 6400000 },
        { kind: "req", ms: 65000, doneMs: 10000, path: "seg0.m4s", status: 200, bytes: 100 },
        { kind: "req", ms: 131000, doneMs: 1000, path: "seg1.m4s", status: 200, bytes: 100 },
      ],
    });
    expect(result.status).toBe("PASS");
    expect(result.checks.find((check) => check.name === "player reports a climb back to the copy").detail).toContain("+67.5s");
    expect(result.diagnostics.find((entry) => entry.name === "copy delivery after recovery").detail).toContain("+67.5s");
  });

  it("cannot claim recovery from a copy run that predates the drop", () => {
    const result = recordedRun({
      id: "S7",
      seconds: 390,
      kbps: 30000,
      events: [
        { kind: "rate", ms: 60000, atSec: 60, kbps: 1500 },
        { kind: "rate", ms: 210000, atSec: 210, kbps: 30000 },
        { kind: "req", ms: 5000, path: "seg0.m4s", status: 200, bytes: 100 },
        { kind: "req", ms: 220000, doneMs: 30000, path: "seg1.m4s", status: 200, bytes: 100 },
      ],
    });
    expect(result.status).toBe("INCOMPLETE");
    expect(result.checks.find((check) => check.name === "player reports a climb back to the copy").ok).toBeNull();
    expect(result.diagnostics.find((entry) => entry.name === "copy delivery after recovery").detail).toBe("no post-recovery copy request");
  });

  it("still fails a recorded stall and an interrupted playback clock", () => {
    const result = recordedRun({
      omit: ["tick"],
      events: [
        { kind: "tick", ms: 10000, position: 8, advanced: false, status: 1 },
        { kind: "tick", ms: 60000, position: 8, advanced: false, status: 1 },
      ],
    });
    expect(result.status).toBe("FAIL");
    expect(result.checks.find((check) => check.name === "no stall after first frame").ok).toBe(false);
    expect(result.checks.find((check) => check.name === "plays to the end of the run").ok).toBe(false);
  });

  it("does not extend stall duration using an HTTP completion after recording stopped", () => {
    const episodes = evaluate(`stallEpisodes([
      {kind:'firstFrame',ms:1000,position:0},
      {kind:'tick',ms:5000,position:4,status:1,advanced:false},
      {kind:'end',ms:10000},
      {kind:'req',ms:30000,path:'t0-seg1.m4s',status:200,bytes:100}
    ])`);
    expect(episodes).toEqual([{ fromMs: 5000, toMs: 10000, position: 4 }]);
  });

  it("does not invent zero tracks when the catalogue was not captured", () => {
    const result = recordedRun({ options: { expectAudio: 2, expectSubs: 3 } });
    expect(result.status).toBe("INCOMPLETE");
    expect(result.checks.find((check) => check.name === "all audio tracks listed").ok).toBeNull();
    expect(result.checks.find((check) => check.name === "all subtitle tracks listed").ok).toBeNull();
  });

  it("keeps a missing device recording at zero elapsed time without inventing tracks or a start timestamp", () => {
    const timeline = evaluate(`deviceTimeline({probeFile:'/nonexistent/tomotv/probe.jsonl',consoleLog:'/nonexistent/tomotv/console.log',endedAt:1000})`);
    expect(timeline).toEqual([
      { kind: "start", ms: 0 },
      { kind: "end", ms: 0 },
    ]);
  });
});
