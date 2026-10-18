jest.mock("expo/config-plugins", () => ({ withDangerousMod: jest.fn() }));

const { addEnginePods } = require("../app.plugin");

const podsPath = "../packages/tomo-engine/ios";
const sharedDirectory = `require_relative '${podsPath}/spm-build-directory'`;

test("prebuild adds the shared directory before the engine pods and stays idempotent", () => {
  const result = addEnginePods("target 'TomoTV' do\n  use_expo_modules!\nend\n", podsPath);
  expect(result.startsWith(sharedDirectory)).toBe(true);
  for (const name of ["TomoEngine", "TomoLiveSources", "TomoFFmpeg"]) {
    expect(result).toContain(`pod '${name}', :path => '${podsPath}'`);
  }
  expect(addEnginePods(result, podsPath)).toBe(result);
});

test("existing engine pods still acquire their shared directory configuration", () => {
  const existing = ["TomoEngine", "TomoLiveSources", "TomoFFmpeg"].map((name) => `pod '${name}'`).join("\n");
  expect(addEnginePods(existing, podsPath)).toBe(`${sharedDirectory}\n\n${existing}`);
});

test("a missing Expo anchor fails instead of silently omitting engine pods", () => {
  expect(() => addEnginePods("target 'TomoTV' do\nend\n", podsPath)).toThrow("Could not find use_expo_modules!");
});
