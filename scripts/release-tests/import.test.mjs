import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { adopt, findDeviceFolders, planImport } from "../appstore/import.mjs";

function desktop(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-import-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
/** A capture taken `order` seconds into the session, so the import sees the order it was shot in. */
async function shot(folder, name, [width, height], order) {
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, name);
  await sharp({ create: { width, height, channels: 3, background: "#1C1C1E" } })
    .png()
    .toFile(file);
  const at = new Date(Date.UTC(2026, 9, 15, 17, 0, order));
  fs.utimesSync(file, at, at);
}

test("an iPhone Duo folder is read as the Duo, not as iPhone", (t) => {
  const root = desktop(t);
  for (const name of ["iPhone Duo", "iphone-duo", "iPhone"]) fs.mkdirSync(path.join(root, name));
  const found = Object.fromEntries(findDeviceFolders(root).folders.map((f) => [f.name, [f.deviceKey, f.ambiguous ?? null]]));
  assert.deepEqual(found, { "iPhone Duo": ["duo", null], "iphone-duo": ["duo", null], iPhone: ["iphone", null] });
});

test("Duo images fill each shot's screens by shape, in the order they were taken", async (t) => {
  const root = desktop(t);
  const folder = path.join(root, "iPhone Duo");
  await shot(folder, "Simulator Screenshot - iPhone Duo - a.png", [2853, 2007], 1);
  await shot(folder, "Simulator Screenshot - iPhone Duo - b.png", [1398, 2034], 2);
  await shot(folder, "Simulator Screenshot - iPhone Duo - c.png", [2853, 2007], 3);
  await shot(folder, "Simulator Screenshot - iPhone Duo - d.png", [1320, 2868], 4);
  const shots = [
    { id: "01-library", layout: "pair" },
    { id: "02-player", layout: "inner" },
  ];
  const { results } = await planImport({}, [{ deviceKey: "duo", shots }], root, 10);
  const [duo] = results;
  const filled = Object.fromEntries(duo.assignments.map((a) => [`${a.shot.id}.${a.mode}`, a.file?.name ?? null]));
  assert.deepEqual(filled, {
    "01-library.inner": "Simulator Screenshot - iPhone Duo - a.png",
    "02-player.inner": "Simulator Screenshot - iPhone Duo - c.png",
    "01-library.outer": "Simulator Screenshot - iPhone Duo - b.png",
  });
  assert.deepEqual(
    duo.rejected.map((f) => f.name),
    ["Simulator Screenshot - iPhone Duo - d.png"],
  );

  const captures = path.join(root, "captures");
  assert.equal(adopt(results, captures), 3);
  assert.deepEqual(fs.readdirSync(path.join(captures, "duo")).sort(), ["01-library.inner.png", "01-library.outer.png", "02-player.inner.png"]);
});

test("a file named for a shot claims that shot's screen of its own shape", async (t) => {
  const root = desktop(t);
  const folder = path.join(root, "duo");
  await shot(folder, "z-first.png", [1398, 2034], 1);
  await shot(folder, "02-player.outer.png", [1398, 2034], 2);
  const shots = [
    { id: "01-library", layout: "outer" },
    { id: "02-player", layout: "outer" },
  ];
  const { results } = await planImport({}, [{ deviceKey: "duo", shots }], root, 10);
  const filled = Object.fromEntries(results[0].assignments.map((a) => [a.shot.id, a.file?.name]));
  assert.deepEqual(filled, { "01-library": "z-first.png", "02-player": "02-player.outer.png" });
});
