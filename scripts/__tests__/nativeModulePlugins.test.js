const fs = require("node:fs");
const path = require("node:path");
const { expo } = require("../../app.json");

const root = path.resolve(__dirname, "../..");
const MODULES = ["MultiAudioResourceLoader", "NetworkInfo", "DeviceEnvironment", "FileAttributes", "MacKeyCommands"];

describe.each(MODULES)("native module %s", (name) => {
  const plugin = require(`../../plugins/with${name}`);
  const folder = path.join(root, "native/ios", name);

  it("is listed in app.json", () => {
    expect(expo.plugins).toContain(`./plugins/with${name}`);
  });

  it("its plugin lists exactly the files in its own folder", () => {
    expect([...plugin.MODULE_FILES].sort()).toEqual(fs.readdirSync(folder).sort());
  });
});

it("the plugin that sets the bridging header runs before the modules that need it", () => {
  const order = MODULES.map((name) => expo.plugins.indexOf(`./plugins/with${name}`));
  expect(Math.min(...order)).toBe(order[0]);
});
