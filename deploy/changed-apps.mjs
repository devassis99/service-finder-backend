#!/usr/bin/env node
// Which apps need deploying — for .github/workflows/deploy.yml.
//
//   node deploy/changed-apps.mjs [--head=<sha>] [<base>] [<app>=<base> ...]
//
//   <app>=<base>  compares that app with its own commit. The workflow
//                 passes the commit each service is running now, read off
//                 its image tag.
//   <base>        compares every other app with this one — handy locally:
//                 `node deploy/changed-apps.mjs origin/main`.
//   --head        what is about to be deployed (default HEAD).
//
// Prints one `<app>=true|false` line per app under apps/, the format
// $GITHUB_OUTPUT takes, and says why on stderr.
//
// An app is changed when a file changed in its own folder, in any
// workspace package it depends on (followed through package.json's
// "workspace:" dependencies, so a new dependency is picked up without
// editing this file), or in one of its own task definitions. A change to
// anything every image is built from — the Dockerfile, the lockfile, the
// entrypoint, this workflow — changes every app. An app with no commit to
// compare with — none given, an image tagged "latest", a commit this
// clone does not have — counts as changed: deploying too much is safe,
// skipping a change is not.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Files that go into every image, or decide how every app is deployed. */
const SHARED = [
  /^Dockerfile$/,
  /^\.dockerignore$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig\.base\.json$/,
  /^\.nvmrc$/,
  /^deploy\/docker-entrypoint\.sh$/,
  /^deploy\/ecs\/render\.py$/,
  /^deploy\/changed-apps\.mjs$/,
  /^\.github\/workflows\/deploy\.yml$/,
];

/** Each app's task definitions, beyond its own folder. */
const TASK_DEFINITIONS = {
  api: ["api", "migrate"],
};

function readPackages(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((folder) => existsSync(path.join(folder, "package.json")))
    .map((folder) => ({
      folder,
      manifest: JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")),
    }));
}

const apps = readPackages("apps");
const names = apps.map((app) => path.basename(app.folder));
const byName = new Map([...apps, ...readPackages("packages")].map((p) => [p.manifest.name, p]));

let head = "HEAD";
let fallback;
const bases = {};
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--head=")) {
    head = arg.slice("--head=".length);
  } else if (arg.includes("=")) {
    const [name, base] = arg.split("=", 2);
    if (!names.includes(name)) {
      console.error(`No app called "${name}" under apps/ (there are: ${names.join(", ")}).`);
      process.exit(2);
    }
    bases[name] = base;
  } else {
    fallback = arg;
  }
}

/** The app's folder and the folder of every workspace package it uses, directly or not. */
function foldersOf(app) {
  const folders = new Set();
  const visit = (pkg) => {
    if (folders.has(pkg.folder)) return;
    folders.add(pkg.folder);
    const deps = { ...pkg.manifest.dependencies, ...pkg.manifest.devDependencies };
    for (const [name, spec] of Object.entries(deps)) {
      if (String(spec).startsWith("workspace:") && byName.has(name)) visit(byName.get(name));
    }
  };
  visit(app);
  return [...folders];
}

function isCommit(ref) {
  if (!ref || /^0+$/.test(ref)) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Files that differ between base and head, or null when base is no commit to compare with. */
const diffs = new Map();
function changedSince(base) {
  if (!diffs.has(base)) {
    diffs.set(
      base,
      isCommit(base)
        ? execFileSync("git", ["diff", "--name-only", base, head], { encoding: "utf8" })
            .split("\n")
            .filter(Boolean)
        : null,
    );
  }
  return diffs.get(base);
}

const short = (ref) => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);
const sample = (files) =>
  `${files.length} file${files.length === 1 ? "" : "s"}, e.g. ${files.slice(0, 3).join(", ")}`;

for (const app of apps) {
  const name = path.basename(app.folder);
  const base = bases[name] ?? fallback;
  const changed = changedSince(base);

  let deploy;
  let why;
  if (changed === null) {
    deploy = true;
    why = `no commit to compare with (${base ? `"${base}"` : "none given"})`;
  } else {
    const shared = changed.filter((file) => SHARED.some((pattern) => pattern.test(file)));
    const folders = foldersOf(app).map((folder) => `${folder}/`);
    const definitions = (TASK_DEFINITIONS[name] ?? [name]).map(
      (family) => `deploy/ecs/task-definition.${family}.json`,
    );
    const own = changed.filter(
      (file) => folders.some((folder) => file.startsWith(folder)) || definitions.includes(file),
    );
    deploy = shared.length > 0 || own.length > 0;
    why =
      shared.length > 0
        ? `shared build files changed since ${short(base)} (${sample(shared)})`
        : own.length > 0
          ? `changed since ${short(base)} (${sample(own)})`
          : `unchanged since ${short(base)} (watches ${folders.join(" ")})`;
  }

  console.log(`${name}=${deploy}`);
  console.error(`${name}: ${deploy ? "deploy" : "skip"} — ${why}`);
}
