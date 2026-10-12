import { StringDecoder } from "node:string_decoder";

export function redactTestOutput(text, environment) {
  for (const name of ["JELLYFIN_API_KEY", "JELLYFIN_ACCESS_TOKEN", "JELLYFIN_PASSWORD"]) {
    const secret = environment[name];
    if (!secret) continue;
    for (const value of [encodeURIComponent(secret), secret]) text = text.split(value).join("[REDACTED]");
  }
  return text;
}

/**
 * execFile's failure message repeats the whole command line. This is the same failure naming
 * only the tool, with what it wrote to stderr and each of `hidden` (a link, a URL) removed.
 */
export function commandFailure(tool, error, hidden = []) {
  let detail = String(error?.stderr ?? "").trim();
  for (const value of hidden) if (value) detail = detail.split(value).join("[REDACTED]");
  return new Error(`${tool} failed (${error?.code ?? error?.signal ?? "unknown"})${detail ? `: ${detail}` : ""}`);
}

export function redactedTestWriter(write, environment) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  return {
    write(chunk) {
      pending += decoder.write(Buffer.from(chunk));
      const boundary = pending.lastIndexOf("\n");
      if (boundary < 0) return;
      write(redactTestOutput(pending.slice(0, boundary + 1), environment));
      pending = pending.slice(boundary + 1);
    },
    end() {
      pending += decoder.end();
      if (pending) write(redactTestOutput(pending, environment));
      pending = "";
    },
  };
}
