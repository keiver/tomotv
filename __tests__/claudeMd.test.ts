/** The agent instruction files load into sessions: every path, script and symbol they name has to be real. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const doc = read("CLAUDE.md");
// A gitignored file exists here but not in a CI checkout, so only files git would carry count.
const repoFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const repoFileSet = new Set(repoFiles);
const GENERATED = new Set(["ios", "macos", "tvos", "android"]);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function spans(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function isPath(span: string): boolean {
  if (/\s|:\/\/|[<>]/.test(span) || /^[/~@]/.test(span)) return false;
  if (span.includes("/")) return !GENERATED.has(span.split("/")[0]);
  return /\.(md|js|json)$/.test(span);
}

function expandBraces(pattern: string): string[] {
  const match = pattern.match(/\{([^}]+)\}/);
  if (!match) return [pattern];
  return match[1].split(",").flatMap((part) => expandBraces(pattern.replace(match[0], part)));
}

/** A file git carries at this path or glob, or under it when it names a folder. */
function inRepo(pattern: string): boolean {
  const body = pattern
    .replace(/\/$/, "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  const matcher = new RegExp(`^${body}(/.*)?$`);
  return repoFiles.some((file) => matcher.test(file));
}

function listedDirs(dir: string): string[] {
  return fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const INSTRUCTION_FILES = ["CLAUDE.md", "memories/CLAUDE-debugging.md", ...fs.readdirSync(path.join(root, ".claude", "rules")).map((name) => `.claude/rules/${name}`)];

describe.each(INSTRUCTION_FILES)("%s", (file) => {
  const text = read(file);
  const prose = text.replace(/```[\s\S]*?```/g, "");

  it("names only paths that exist", () => {
    const missing = prose
      .split("\n")
      .flatMap(spans)
      .filter(isPath)
      .flatMap(expandBraces)
      .filter((pattern) => !inRepo(pattern));
    expect(missing).toEqual([]);
  });

  it("names only npm scripts that package.json defines", () => {
    const scripts = Object.keys(JSON.parse(read("package.json")).scripts);
    const named = [...text.matchAll(/npm run ([\w:.-]+)/g)].map((match) => match[1]);
    expect(named.filter((name) => !scripts.includes(name))).toEqual([]);
  });

  it("finds every symbol in the file listed before it on the same line", () => {
    const missing: string[] = [];
    for (const line of prose.split("\n")) {
      let file: string | null = null;
      for (const span of spans(line)) {
        if (isPath(span)) {
          file = repoFileSet.has(span) ? path.join(root, span) : null;
        } else if (file && IDENTIFIER.test(span) && !new RegExp(`\\b${span.replace(/\$/g, "\\$")}\\b`).test(fs.readFileSync(file, "utf8"))) {
          missing.push(`${span} in ${path.relative(root, file)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("CLAUDE.md", () => {
  it("names every package, native module and memories file in the repo", () => {
    const unnamed = [
      ...listedDirs("packages").map((name) => `packages/${name}`),
      ...listedDirs("native/ios")
        .filter((name) => name !== "Tests")
        .map((name) => `native/ios/${name}`),
      ...fs.readdirSync(path.join(root, "memories")).map((name) => `memories/${name}`),
    ].filter((name) => !doc.includes(`\`${name}\``));
    expect(unnamed).toEqual([]);
  });

  it("gives every package a rule file scoped to its folder", () => {
    const missing = listedDirs("packages").filter((name) => !repoFileSet.has(`.claude/rules/${name}.md`) || !read(`.claude/rules/${name}.md`).includes(`"packages/${name}/**"`));
    expect(missing).toEqual([]);
  });
});

describe("package boundaries", () => {
  const importsOf = (file: string) => [...fs.readFileSync(file, "utf8").matchAll(/(?:from\s+|import\(|require\()\s*["']([^"']+)["']/g)].map((match) => match[1]);

  it("keeps app code out of every package's source", () => {
    const offenders = listedDirs("packages")
      .flatMap((name) => sourceFiles(path.join(root, "packages", name, "src")))
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith("@/")))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });

  it("keeps the engine from importing the live package", () => {
    const offenders = sourceFiles(path.join(root, "packages", "tomo-engine", "src"))
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith("@keiver/tomo-live")))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});
