import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

type EngineHandle = {
  port: number;
  child: ChildProcess;
};

const globalForEngine = globalThis as typeof globalThis & {
  __mtgCentralForge?: EngineHandle;
};

const READY_MS = 120_000;
const DEFAULT_ROOT = "/Users/Geraldo/Downloads/RE_Forge-main";

/** The official checkout keeps this app in central/ and the engine beside it. */
function forgeRoot(): string {
  if (process.env.RE_FORGE_ROOT) return process.env.RE_FORGE_ROOT;
  const candidates = [path.resolve(process.cwd(), ".."), path.resolve(process.cwd())];
  for (const root of candidates) {
    if (existsSync(path.join(root, "engine", "target", "re-forge-engine.jar"))) return root;
  }
  return DEFAULT_ROOT;
}
const DEFAULT_JAVA_HOME = "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home";

function javaBin(): string {
  const home = process.env.JAVA_HOME || DEFAULT_JAVA_HOME;
  const bin = path.join(home, "bin", "java");
  return existsSync(bin) ? bin : "java";
}

/** Starts the local RE:Forge engine once per server process and returns its port. */
export function ensureForgeEngine(): Promise<number> {
  const current = globalForEngine.__mtgCentralForge;
  if (current && current.child.exitCode === null && !current.child.killed) {
    return Promise.resolve(current.port);
  }

  const root = forgeRoot();
  const jar = path.join(root, "engine", "target", "re-forge-engine.jar");
  const assets = path.join(root, "forge", "forge-gui");
  if (!existsSync(jar)) {
    return Promise.reject(
      new Error("The play engine is not built yet. Its jar was not found next to RE:Forge."),
    );
  }
  if (!existsSync(assets)) {
    return Promise.reject(new Error("The play engine card data was not found."));
  }

  const bin = javaBin();
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      ["-Xmx2g", "-jar", jar, "--port", "0", "--assets", assets, "--exit-with-parent"],
      // stdin stays open. The engine treats a closed stdin as "the launcher died" and exits.
      { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
    );

    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("The play engine took too long to start."), READY_MS);

    let buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      const match = buffer.match(/READY (\d+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      const port = Number(match[1]);
      globalForEngine.__mtgCentralForge = { port, child };
      resolve(port);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      const line = chunk.trim();
      if (line) console.error("[play-engine]", line);
    });
    child.on("error", (err) => {
      const missing = err.message.includes("ENOENT");
      fail(missing ? "Java 21 was not found. Install a JDK and try Play again." : err.message);
    });
    child.on("exit", (code) => {
      if (globalForEngine.__mtgCentralForge?.child === child) {
        globalForEngine.__mtgCentralForge = undefined;
      }
      if (!settled) fail(`The play engine stopped before it was ready (${code ?? "no code"}).`);
    });
  });
}
