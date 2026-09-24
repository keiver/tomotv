import { StringDecoder } from "node:string_decoder";

export function redactTestOutput(text, environment) {
  for (const name of ["JELLYFIN_API_KEY", "JELLYFIN_ACCESS_TOKEN", "JELLYFIN_PASSWORD"]) {
    const secret = environment[name];
    if (!secret) continue;
    for (const value of [encodeURIComponent(secret), secret]) text = text.split(value).join("[REDACTED]");
  }
  return text;
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
