const { execFileSync } = require("node:child_process");
const path = require("node:path");

function evaluate(expression) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {execFile} from 'node:child_process'; import {promisify} from 'node:util'; import {loadEnv} from './scripts/playback-regression.mjs'; import {commandFailure, redactTestOutput, redactedTestWriter} from './scripts/lib/test-environment.mjs'; console.log(JSON.stringify(${expression}));`,
      ],
      { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" },
    ),
  );
}

describe("playback test environment", () => {
  it("requires credentials in the supplied environment even when a local credential file exists", () => {
    expect(evaluate(`(() => { try { loadEnv({}); return 'accepted'; } catch(error) { return error.message; } })()`)).toBe("Set JELLYFIN_URL and JELLYFIN_API_KEY in the environment");
  });

  it("uses only explicit environment settings", () => {
    expect(evaluate(`loadEnv({JELLYFIN_URL:'http://127.0.0.1:8096/', JELLYFIN_API_KEY:'test-only-key', JELLYFIN_USER_ID:'fixture-user', UNRELATED:'ignored'})`)).toMatchObject({
      JELLYFIN_URL: "http://127.0.0.1:8096",
      JELLYFIN_API_KEY: "test-only-key",
      JELLYFIN_USER_ID: "fixture-user",
    });
    expect(evaluate(`loadEnv({JELLYFIN_URL:'http://127.0.0.1:8096/', JELLYFIN_API_KEY:'test-only-key', UNRELATED:'ignored'})`)).not.toHaveProperty("UNRELATED");
  });

  it("redacts raw and URL-encoded credentials", () => {
    expect(
      evaluate(
        `redactTestOutput('test-only&key test-only%26key test-only-password test-only-token', {JELLYFIN_API_KEY:'test-only&key', JELLYFIN_PASSWORD:'test-only-password', JELLYFIN_ACCESS_TOKEN:'test-only-token'})`,
      ),
    ).toBe("[REDACTED] [REDACTED] [REDACTED] [REDACTED]");
  });

  it("reports a failed command without the link it was given", () => {
    // A real execFile failure: its own message repeats the arguments, the rethrown one does not.
    const failing = (command) =>
      `await (async () => { const link='tomotv://dev-session?token=test-only-token'; try { await promisify(execFile)(${command}); return 'ran'; } catch (error) { return [error.message.includes(link), commandFailure('simctl openurl', error, [link]).message]; } })()`;
    expect(evaluate(failing(`'false', ['openurl', link]`))).toEqual([true, "simctl openurl failed (1)"]);
    // What the tool wrote to stderr is kept, with the link taken out.
    expect(evaluate(failing(`'sh', ['-c', 'echo "cannot open $0" >&2; exit 3', link]`))).toEqual([true, "simctl openurl failed (3): cannot open [REDACTED]"]);
  });

  it("does not leak a credential split between output chunks", () => {
    expect(
      evaluate(
        `(() => { let output=''; const writer=redactedTestWriter(text=>output+=text,{JELLYFIN_API_KEY:'test-only-key'}); writer.write('ApiKey=test-'); writer.write('only-key\\nlast=test-only'); writer.write('-key'); writer.end(); return output; })()`,
      ),
    ).toBe("ApiKey=[REDACTED]\nlast=[REDACTED]");
  });
});
