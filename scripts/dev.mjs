#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";

/**
 * Runs the two halves of development at once, and says which one to open.
 *
 * The Worker serves the admin UI from a bundle built into it, so editing the
 * admin UI and reloading the Worker shows the same page as before -- the
 * source that changed is not what it is serving. The dev server is what serves
 * the source, and it forwards everything else to the Worker beside it, so the
 * browser still sees one origin and the session cookie still belongs to it.
 *
 * Which is to say: open the dev server, not the Worker.
 *
 * The dev server is started only once the Worker has said where it is. Neither
 * port is guaranteed -- something else on 8787 sends wrangler to 8788 without
 * complaint -- and a dev server forwarding to whatever else answers on the
 * port it assumed is worse than one that will not start: it works, against the
 * wrong Worker.
 */

const READY = /Ready on (http:\/\/[^\s]+)/;
const VITE_LOCAL = /Local:\s+(http:\/\/[^\s]+)/;

// Both announcements arrive dressed in colour, and vite puts an escape in the
// middle of its own port number. What is printed keeps the colour; what is
// read for a URL cannot.
//
// Built from the character code rather than written as an escape: a literal
// escape byte in source is the kind of thing an editor normalises away, and it
// would take the colour stripping with it.
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

function plain(line) {
  return line.replace(ANSI, "");
}

/**
 * `[ worker ]` and `[   ui   ]`, padded to one width.
 *
 * Two children write to the same terminal at once and neither waits its turn.
 * A label of a constant width puts the text that follows in a column, so one
 * child can be read down the page without reading the other.
 */
const NAMES = ["worker", "ui"];
const LABEL_WIDTH = Math.max(...NAMES.map((name) => name.length)) + 2;

function label(name) {
  const spare = Math.max(LABEL_WIDTH - name.length, 0);
  const left = Math.floor(spare / 2);
  return `[${" ".repeat(left)}${name}${" ".repeat(spare - left)}]`;
}

function announce(name, line) {
  process.stderr.write(`${label(name)} ${line}\n`);
}

/**
 * Both children are read line by line so their output can be labelled, and
 * being read is indistinguishable from being redirected to a file: wrangler
 * sees something that is not a terminal and drops its colour. It is told to
 * keep it -- but only when this really is a terminal, so that `pnpm dev > log`
 * still writes a log rather than a file full of escapes. Anyone who has an
 * opinion already has it set, and theirs wins.
 */
const colourEnv = process.stderr.isTTY ? { FORCE_COLOR: "1" } : {};

/**
 * Spawns a child, labelling each line of its output.
 *
 * An `args` list means no shell: handed to a shell, an argument list is
 * concatenated rather than escaped, which node warns about (DEP0190) and is
 * right to -- arguments forwarded from the command line make that a real
 * question. Where a shell cannot be avoided, because pnpm on Windows is a
 * batch file, the command line is written out as one string instead, so what
 * the shell is given is ours and in plain sight.
 *
 * What is printed keeps its colour; what `onLine` is given has none, because
 * it is read for URLs rather than shown.
 */
function run(name, command, { args, extraEnv, onLine } = {}) {
  const options = {
    stdio: ["inherit", "pipe", "pipe"],
    shell: args === undefined,
    env: { ...colourEnv, ...process.env, ...extraEnv },
  };
  const child = args === undefined ? spawn(command, options) : spawn(command, args, options);
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    let carry = "";
    stream.on("data", (chunk) => {
      const lines = (carry + chunk).split(/\r?\n/);
      carry = lines.pop() ?? "";
      for (const line of lines) {
        announce(name, line);
        onLine?.(plain(line));
      }
    });
  }
  return child;
}

const children = [];

/**
 * Ends a child and everything it started.
 *
 * Neither child is the process holding a port: one starts wrangler, the other
 * reaches vite through pnpm and a shell besides. Ending the child ends only
 * the child on Windows, and what it started keeps running, unreachable -- so
 * the next start finds 8787 and 5173 taken and quietly moves to 8788 and 5174.
 * The symptom is not a stray process; it is a second copy of everything.
 *
 * Synchronously, because the exit below does not wait: asked to do this in the
 * background, the kill loses the race and leaves behind exactly what it was
 * there to prevent.
 */
function endTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    child.kill();
  }
}

// One dying takes the other with it: a dev server with nothing to forward to
// answers every request with a proxy error, which reads as the admin UI being
// broken rather than as the Worker being gone.
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    endTree(child);
  }
  process.exit(code ?? 0);
}

let uiStarted = false;

function startUi(workerOrigin) {
  if (uiStarted) return;
  uiStarted = true;
  const child = run("ui", "pnpm --filter @axis-repository/admin-ui dev", {
    extraEnv: { AXIS_WORKER_ORIGIN: workerOrigin },
    onLine: (line) => {
      const local = VITE_LOCAL.exec(line);
      if (local) {
        process.stderr.write(
          `\n  ${label("ui")}  ${local[1].replace(/\/$/, "")}/ui/   <- open this one; it reloads as you edit\n`
          + `  ${label("worker")}  ${workerOrigin}   (serves the admin UI as last built)\n\n`,
        );
      }
    },
  });
  child.on("exit", (code) => stop(code ?? 1));
  children.push(child);
}

const worker = run("worker", process.execPath, {
  args: ["scripts/dev-worker.mjs", ...process.argv.slice(2)],
  onLine: (line) => {
    const ready = READY.exec(line);
    if (ready) {
      startUi(ready[1].replace(/\/$/, ""));
    }
  },
});
worker.on("exit", (code) => stop(code ?? 1));
children.push(worker);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(0));
}
