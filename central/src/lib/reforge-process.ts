import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

type EngineHandle = { port: number; child: ChildProcess };
const globalForEngine = globalThis as typeof globalThis & {
  __mtgCentralForge?: EngineHandle;
  __mtgCentralForgeStarting?: Promise<number>;
};
const READY_MS = 120_000;

function configuredPort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid RE_FORGE_ENGINE_PORT.");
  return port;
}

function forgeRoot(): string {
  if (process.env.RE_FORGE_ROOT) return process.env.RE_FORGE_ROOT;
  const candidates = [
    path.resolve(/* turbopackIgnore: true */ process.cwd(), ".."),
    path.resolve(/* turbopackIgnore: true */ process.cwd()),
  ];
  return candidates.find((root) => existsSync(path.join(root, "engine", "target", "re-forge-engine.jar"))) ?? candidates[0];
}

function javaBin(root: string): string {
  const executable = process.platform === "win32" ? "java.exe" : "java";
  if (process.env.JAVA_HOME) return path.join(process.env.JAVA_HOME, "bin", executable);
  const bundled = path.join(root, "runtime", "bin", executable);
  return existsSync(bundled) ? bundled : executable;
}

/** Desktop owns its existing engine; browser development starts exactly one process. */
export function ensureForgeEngine(): Promise<number> {
  if (process.env.RE_FORGE_ENGINE_PORT) {
    try { return Promise.resolve(configuredPort(process.env.RE_FORGE_ENGINE_PORT)); }
    catch (error) { return Promise.reject(error); }
  }
  const current = globalForEngine.__mtgCentralForge;
  if (current && current.child.exitCode === null && !current.child.killed) return Promise.resolve(current.port);
  if (globalForEngine.__mtgCentralForgeStarting) return globalForEngine.__mtgCentralForgeStarting;
  const root = forgeRoot();
  const sourceJar = path.join(root, "engine", "target", "re-forge-engine.jar");
  const jar = existsSync(sourceJar) ? sourceJar : path.join(root, "engine", "re-forge-engine.jar");
  const sourceAssets = path.join(root, "forge", "forge-gui");
  const assets = existsSync(sourceAssets) ? sourceAssets : path.join(root, "forge-gui");
  if (!existsSync(jar)) return Promise.reject(new Error("The RE:Forge engine has not been built."));
  if (!existsSync(assets)) return Promise.reject(new Error("The RE:Forge card data was not found."));
  const start = new Promise<number>((resolve, reject) => {
    const args = ["-Xmx2g", "-jar", jar, "--port", "0", "--assets", assets, "--exit-with-parent"];
    if (process.env.RE_FORGE_DATA) args.push("--data", process.env.RE_FORGE_DATA);
    const child = spawn(/* turbopackIgnore: true */ javaBin(root), args, { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
      buffer = (buffer + chunk).slice(-16_000);
      const match = buffer.match(/^READY (\d+)\r?$/m);
      if (!match || settled) return;
      let port: number;
      try { port = configuredPort(match[1]); } catch { return; }
      settled = true;
      clearTimeout(timer);
      globalForEngine.__mtgCentralForge = { port, child };
      resolve(port);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => console.error("[play-engine]", chunk.slice(-4_000).trim()));
    child.on("error", (error) => fail(error.message.includes("ENOENT") ? "Java 21 was not found." : error.message));
    child.on("exit", (code) => {
      if (globalForEngine.__mtgCentralForge?.child === child) globalForEngine.__mtgCentralForge = undefined;
      if (!settled) fail(`The play engine stopped before it was ready (${code ?? "no code"}).`);
    });
  });
  const pending = start.finally(() => {
    if (globalForEngine.__mtgCentralForgeStarting === pending) globalForEngine.__mtgCentralForgeStarting = undefined;
  });
  globalForEngine.__mtgCentralForgeStarting = pending;
  return pending;
}
