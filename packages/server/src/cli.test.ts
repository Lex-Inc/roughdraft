import fs from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRoughdraftMarkdown } from "@roughdraft/rfm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCliDependencies,
  createDefaultOpenUrl,
  ensureServerRunning,
  getServerStateFilePath,
  runCli,
  WATCH_POLL_SECONDS,
} from "./cli";
import { createApp } from "./index";
import { ROUGHDRAFT_DEFAULT_PORT } from "./network";

interface StartedServer {
  close: () => Promise<void>;
}

async function listenOnLoopbackServers(
  port: number,
  app: ReturnType<typeof createApp>["app"],
): Promise<StartedServer> {
  const servers: Server[] = [];

  for (const host of ["127.0.0.1", "::1"]) {
    const server = createHttpServer(app);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL") {
            resolve();
            return;
          }

          reject(error);
        });

        server.listen(port, host, () => resolve());
      });
      if (server.listening) {
        servers.push(server);
      }
    } catch (error) {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      throw error;
    }
  }

  return {
    close: async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve, reject) => {
              server.closeAllConnections?.();
              server.close((error) => {
                if (error) {
                  reject(error);
                  return;
                }
                resolve();
              });
            }),
        ),
      );
    },
  };
}

describe("cli", () => {
  let tempDir: string;
  let stateDir: string;
  let projectDir: string;
  let devFrontendStateFile: string;
  let nextPid: number;
  let runningPids: Set<number>;
  let serverByPid: Map<number, StartedServer>;
  let portByPid: Map<number, number>;
  const serverRoot = path.resolve(
    fileURLToPath(new URL("../../..", import.meta.url)),
  );

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-cli-"));
    stateDir = path.join(tempDir, "state");
    projectDir = path.join(tempDir, "project");
    devFrontendStateFile = path.join(tempDir, "dev-frontend.json");
    fs.mkdirSync(projectDir, { recursive: true });
    nextPid = 1000;
    runningPids = new Set<number>();
    serverByPid = new Map<number, StartedServer>();
    portByPid = new Map<number, number>();
  });

  function expectedOpenUrl(baseUrl: string, documentPath: string): string {
    const url = new URL(baseUrl);
    url.pathname = "/";
    url.searchParams.set("path", documentPath);
    return url.toString();
  }

  function parseOnlyJsonLog<T>(logs: string[]): T {
    expect(logs).toHaveLength(1);
    return JSON.parse(logs[0] ?? "{}") as T;
  }

  function extractHelpExample(
    logs: string[],
    startLine: string,
    stopLine: string,
  ): string {
    const startIndex = logs.indexOf(startLine);
    const stopIndex = logs.indexOf(stopLine);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(stopIndex).toBeGreaterThan(startIndex);

    return `${logs
      .slice(startIndex + 1, stopIndex)
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^ {2}/, ""))
      .join("\n")}\n`;
  }

  async function noUpdateStatus() {
    return {
      packageName: "roughdraft",
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
      updateCommand: "npm i -g roughdraft@latest",
    };
  }

  afterEach(async () => {
    await Promise.all(
      Array.from(serverByPid.values(), (server) => server.close()),
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createTestDependencies() {
    const logs: string[] = [];
    const errors: string[] = [];
    let lastOpenedUrl: string | null = null;
    let spawnCount = 0;

    const deps = createCliDependencies({
      env: {
        ...process.env,
        ROUGHDRAFT_STATE_DIR: stateDir,
        ROUGHDRAFT_DEV_FRONTEND_STATE_FILE: devFrontendStateFile,
      },
      cwd: projectDir,
      fetchImpl: async (input, init) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );
        const port = Number.parseInt(url.port || "80", 10);
        const hasActiveServer = Array.from(portByPid.entries()).some(
          ([pid, activePort]) => runningPids.has(pid) && activePort === port,
        );

        if (url.pathname === "/api/status" && !hasActiveServer) {
          throw new Error("connect ECONNREFUSED");
        }

        return fetch(input, init);
      },
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
      openUrl: (url) => {
        lastOpenedUrl = url;
        return "disabled";
      },
      resolveUpdateStatus: noUpdateStatus,
      spawnServerProcess: async ({ port, projectDir: nextProjectDir }) => {
        spawnCount += 1;
        const pid = nextPid;
        nextPid += 1;
        const { app } = createApp({
          port,
          projectDir: nextProjectDir,
          serverRoot,
          staticDirPath: nextProjectDir,
        });
        const started = await listenOnLoopbackServers(port, app);
        runningPids.add(pid);
        serverByPid.set(pid, started);
        portByPid.set(pid, port);
        return { pid };
      },
      isProcessRunning: (pid) => runningPids.has(pid),
      stopProcess: async (pid) => {
        const server = serverByPid.get(pid);
        if (server) {
          await server.close();
        }
        serverByPid.delete(pid);
        portByPid.delete(pid);
        runningPids.delete(pid);
      },
    });

    return {
      deps,
      logs,
      errors,
      getLastOpenedUrl: () => lastOpenedUrl,
      getSpawnCount: () => spawnCount,
    };
  }

  it("writes server state and reuses a running background server", async () => {
    const test = createTestDependencies();

    const first = await ensureServerRunning(test.deps, { projectDir });
    const second = await ensureServerRunning(test.deps, { projectDir });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(first.server.url).toBe(`http://localhost:${first.server.port}`);
    expect(test.getSpawnCount()).toBe(1);

    const stateFilePath = getServerStateFilePath(test.deps.env);
    const persisted = JSON.parse(fs.readFileSync(stateFilePath, "utf8")) as {
      port: number;
      pid: number;
      startedAt: string;
      url: string;
    };

    expect(persisted).toMatchObject({
      port: first.server.port,
      pid: first.server.pid,
      url: first.server.url,
    });
    expect(typeof persisted.startedAt).toBe("string");
  });

  it("auto-starts from open and opens the requested markdown file URL", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");

    const exitCode = await runCli(
      ["open", documentPath, "--no-watch"],
      test.deps,
    );
    const persisted = JSON.parse(
      fs.readFileSync(getServerStateFilePath(test.deps.env), "utf8"),
    ) as { port: number };

    expect(exitCode).toBe(0);
    expect(test.getSpawnCount()).toBe(1);
    expect(test.getLastOpenedUrl()).toBe(
      expectedOpenUrl(`http://localhost:${persisted.port}`, documentPath),
    );
    expect(fs.existsSync(getServerStateFilePath(test.deps.env))).toBeTruthy();
  });

  it("prints an update notice after a successful human-readable command", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");

    const exitCode = await runCli(["open", documentPath, "--no-watch"], {
      ...test.deps,
      resolveUpdateStatus: async () => ({
        packageName: "roughdraft",
        currentVersion: "0.1.1",
        latestVersion: "0.1.3",
        updateAvailable: true,
        updateCommand: "npm i -g roughdraft@latest",
      }),
    });

    expect(exitCode).toBe(0);
    expect(test.logs.at(-1)).toBe(
      "Roughdraft update available: 0.1.1 -> 0.1.3. Run `npm i -g roughdraft@latest` to update.",
    );
  });

  it("does not add an update notice to JSON command output", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");

    const exitCode = await runCli(
      ["open", documentPath, "--no-watch", "--json"],
      {
        ...test.deps,
        resolveUpdateStatus: async () => ({
          packageName: "roughdraft",
          currentVersion: "0.1.1",
          latestVersion: "0.1.3",
          updateAvailable: true,
          updateCommand: "npm i -g roughdraft@latest",
        }),
      },
    );
    const payload = parseOnlyJsonLog<{ opened: boolean }>(test.logs);

    expect(exitCode).toBe(0);
    expect(payload.opened).toBe(true);
  });

  it("keeps the original command result when the update check fails", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");

    const exitCode = await runCli(["open", documentPath, "--no-watch"], {
      ...test.deps,
      resolveUpdateStatus: async () => {
        throw new Error("registry unavailable");
      },
    });

    expect(exitCode).toBe(0);
    expect(test.logs).not.toContain("registry unavailable");
  });

  it("reuses a connected document window before opening another browser window", async () => {
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");

    let postedOpenRequest: { path?: string; url?: string } | null = null;
    let lastOpenedUrl: string | null = null;
    const deps = createCliDependencies({
      env: {
        ...process.env,
        ROUGHDRAFT_STATE_DIR: stateDir,
      },
      cwd: projectDir,
      fetchImpl: async (input, init) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );

        if (
          url.pathname === "/api/status" &&
          url.port === String(ROUGHDRAFT_DEFAULT_PORT)
        ) {
          return new Response(
            JSON.stringify({
              backend: "local-files",
              port: ROUGHDRAFT_DEFAULT_PORT,
              projectDir,
              serverRoot,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        if (url.pathname === "/api/open-request" && init?.method === "POST") {
          postedOpenRequest = JSON.parse(String(init.body));
          return new Response(JSON.stringify({ delivered: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        throw new Error("connect ECONNREFUSED");
      },
      isProcessRunning: () => false,
      stopProcess: async () => {},
      spawnServerProcess: async () => {
        throw new Error("should not spawn");
      },
      openUrl: (url) => {
        lastOpenedUrl = url;
        return "browser";
      },
      log: () => {},
      error: () => {},
    });

    const exitCode = await runCli(["open", documentPath, "--no-watch"], deps);

    expect(exitCode).toBe(0);
    expect(postedOpenRequest).toEqual({
      path: documentPath,
      url: expectedOpenUrl(
        `http://localhost:${ROUGHDRAFT_DEFAULT_PORT}`,
        documentPath,
      ),
    });
    expect(lastOpenedUrl).toBeNull();
  });

  it("opens the default browser on macOS when Chrome is installed but not the default browser", () => {
    const opened: Array<{ command: string; args: string[] }> = [];
    const openUrl = createDefaultOpenUrl({
      env: {},
      platform: "darwin",
      spawnSyncCommand: (command, args) => {
        if (command === "plutil") {
          expect(args?.join(" ")).toContain(
            "com.apple.launchservices.secure.plist",
          );
          return {
            status: 0,
            stdout: JSON.stringify([
              {
                LSHandlerURLScheme: "http",
                LSHandlerRoleAll: "com.apple.Safari",
              },
            ]),
          } as ReturnType<typeof import("node:child_process").spawnSync>;
        }

        if (command === "open" && args?.[0] === "-Ra") {
          return {
            status: 0,
            stdout: "",
          } as ReturnType<typeof import("node:child_process").spawnSync>;
        }

        throw new Error(`unexpected spawnSync command ${command}`);
      },
      openDetachedCommand: (command, args) => {
        opened.push({ command, args });
      },
    });

    const mode = openUrl("http://localhost:4020/?file=draft.md");

    expect(mode).toBe("browser");
    expect(opened).toEqual([
      { command: "open", args: ["http://localhost:4020/?file=draft.md"] },
    ]);
  });

  it("opens a Chrome app window on macOS when Chrome is the default browser", () => {
    const opened: Array<{ command: string; args: string[] }> = [];
    const openUrl = createDefaultOpenUrl({
      env: {},
      platform: "darwin",
      spawnSyncCommand: (command, args) => {
        if (command === "plutil") {
          return {
            status: 0,
            stdout: JSON.stringify([
              {
                LSHandlerURLScheme: "http",
                LSHandlerRoleAll: "com.google.Chrome",
              },
            ]),
          } as ReturnType<typeof import("node:child_process").spawnSync>;
        }

        if (command === "open" && args?.[0] === "-Ra") {
          return {
            status: 0,
            stdout: "",
          } as ReturnType<typeof import("node:child_process").spawnSync>;
        }

        throw new Error(`unexpected spawnSync command ${command}`);
      },
      openDetachedCommand: (command, args) => {
        opened.push({ command, args });
      },
    });

    const mode = openUrl("http://localhost:4020/?file=draft.md");

    expect(mode).toBe("chrome-app");
    expect(opened).toEqual([
      {
        command: "open",
        args: [
          "-na",
          "Google Chrome",
          "--args",
          "--app=http://localhost:4020/?file=draft.md",
        ],
      },
    ]);
  });

  it("opens the default browser on Windows without macOS browser detection", () => {
    const opened: Array<{ command: string; args: string[] }> = [];
    const openUrl = createDefaultOpenUrl({
      env: {},
      platform: "win32",
      spawnSyncCommand: () => {
        throw new Error("macOS browser detection should not run on Windows");
      },
      openDetachedCommand: (command, args) => {
        opened.push({ command, args });
      },
    });

    const mode = openUrl("http://localhost:4020/?file=draft.md");

    expect(mode).toBe("browser");
    expect(opened).toEqual([
      {
        command: "cmd",
        args: ["/c", "start", "", "http://localhost:4020/?file=draft.md"],
      },
    ]);
  });

  it("opens the default browser on Linux without macOS browser detection", () => {
    const opened: Array<{ command: string; args: string[] }> = [];
    const openUrl = createDefaultOpenUrl({
      env: {},
      platform: "linux",
      spawnSyncCommand: () => {
        throw new Error("macOS browser detection should not run on Linux");
      },
      openDetachedCommand: (command, args) => {
        opened.push({ command, args });
      },
    });

    const mode = openUrl("http://localhost:4020/?file=draft.md");

    expect(mode).toBe("browser");
    expect(opened).toEqual([
      {
        command: "xdg-open",
        args: ["http://localhost:4020/?file=draft.md"],
      },
    ]);
  });

  it("prints only the document URL from open --print-url", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");

    const exitCode = await runCli(
      ["open", documentPath, "--print-url"],
      test.deps,
    );
    const persisted = JSON.parse(
      fs.readFileSync(getServerStateFilePath(test.deps.env), "utf8"),
    ) as { port: number };

    expect(exitCode).toBe(0);
    expect(test.logs).toEqual([
      expectedOpenUrl(`http://localhost:${persisted.port}`, documentPath),
    ]);
    expect(test.getLastOpenedUrl()).toBeNull();
  });

  it("emits JSON from open --no-watch --json without scraping human prose", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");

    const exitCode = await runCli(
      ["open", documentPath, "--no-watch", "--json"],
      test.deps,
    );
    const persisted = JSON.parse(
      fs.readFileSync(getServerStateFilePath(test.deps.env), "utf8"),
    ) as { port: number };
    const payload = parseOnlyJsonLog<{
      opened: boolean;
      url: string;
      serverUrl: string;
      path: string;
      openMode: string;
    }>(test.logs);

    expect(exitCode).toBe(0);
    expect(payload).toEqual({
      opened: true,
      url: expectedOpenUrl(`http://localhost:${persisted.port}`, documentPath),
      serverUrl: `http://localhost:${persisted.port}`,
      path: documentPath,
      openMode: "disabled",
    });
  });

  it("prefers the live dev frontend URL when it matches this checkout", async () => {
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");
    fs.writeFileSync(
      devFrontendStateFile,
      `${JSON.stringify(
        {
          apiPort: 3000,
          appPort: 5173,
          mode: "full-dev",
          repoRoot: serverRoot,
          startedAt: new Date().toISOString(),
          url: "http://localhost:5173",
        },
        null,
        2,
      )}\n`,
    );

    let lastOpenedUrl: string | null = null;
    let spawnCount = 0;

    const deps = createCliDependencies({
      env: {
        ...process.env,
        ROUGHDRAFT_STATE_DIR: stateDir,
        ROUGHDRAFT_DEV_FRONTEND_STATE_FILE: devFrontendStateFile,
      },
      cwd: projectDir,
      fetchImpl: async (input, init) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );

        if (url.pathname === "/api/status" && url.port === "5173") {
          return new Response(
            JSON.stringify({
              backend: "local-files",
              projectDir,
              serverRoot,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        return fetch(input, init);
      },
      spawnServerProcess: async () => {
        spawnCount += 1;
        throw new Error("should not spawn");
      },
      isProcessRunning: (pid) => runningPids.has(pid),
      stopProcess: async (pid) => {
        const server = serverByPid.get(pid);
        if (server) {
          await server.close();
        }
        serverByPid.delete(pid);
        portByPid.delete(pid);
        runningPids.delete(pid);
      },
      openUrl: (url) => {
        lastOpenedUrl = url;
        return "disabled";
      },
      log: () => {},
      error: () => {},
    });

    const exitCode = await runCli(["open", documentPath, "--no-watch"], deps);

    expect(exitCode).toBe(0);
    expect(spawnCount).toBe(0);
    expect(lastOpenedUrl).toBe(
      expectedOpenUrl("http://localhost:5173", documentPath),
    );
  });

  it("posts the default open watcher to the dev API behind the live frontend", async () => {
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");
    fs.writeFileSync(
      devFrontendStateFile,
      `${JSON.stringify(
        {
          apiPort: 3000,
          appPort: 5173,
          mode: "full-dev",
          repoRoot: serverRoot,
          startedAt: new Date().toISOString(),
          url: "http://localhost:5173",
        },
        null,
        2,
      )}\n`,
    );

    let lastOpenedUrl: string | null = null;
    let watchUrl: string | null = null;
    let spawnCount = 0;

    const deps = createCliDependencies({
      env: {
        ...process.env,
        ROUGHDRAFT_STATE_DIR: stateDir,
        ROUGHDRAFT_DEV_FRONTEND_STATE_FILE: devFrontendStateFile,
      },
      cwd: projectDir,
      fetchImpl: async (input, _init) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );

        if (url.pathname === "/api/status" && url.port === "5173") {
          return new Response(
            JSON.stringify({
              backend: "local-files",
              port: 3000,
              projectDir,
              serverRoot,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        if (url.pathname === "/api/review-events/watch") {
          watchUrl = url.toString();
          return new Response(
            JSON.stringify({
              events: [{ documentPath, type: "review.completed" }],
              timedOut: false,
              nextSequence: 2,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected request: ${url.toString()}`);
      },
      spawnServerProcess: async () => {
        spawnCount += 1;
        throw new Error("should not spawn");
      },
      isProcessRunning: () => false,
      stopProcess: async () => {},
      openUrl: (url) => {
        lastOpenedUrl = url;
        return "disabled";
      },
      log: () => {},
      error: () => {},
      resolveUpdateStatus: noUpdateStatus,
    });

    const exitCode = await runCli(
      ["open", documentPath, "--json", "--batch-window", "0"],
      deps,
    );

    expect(exitCode).toBe(0);
    expect(spawnCount).toBe(0);
    expect(lastOpenedUrl).toBe(
      expectedOpenUrl("http://localhost:5173", documentPath),
    );
    expect(watchUrl).toBe("http://localhost:3000/api/review-events/watch");
  });

  it("falls back to the api server URL when the dev frontend hint is stale", async () => {
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");
    fs.writeFileSync(
      devFrontendStateFile,
      `${JSON.stringify(
        {
          apiPort: 3000,
          appPort: 5173,
          mode: "full-dev",
          repoRoot: serverRoot,
          startedAt: new Date().toISOString(),
          url: "http://localhost:5173",
        },
        null,
        2,
      )}\n`,
    );

    const test = createTestDependencies();
    const exitCode = await runCli(
      ["open", documentPath, "--no-watch"],
      test.deps,
    );
    const persisted = JSON.parse(
      fs.readFileSync(getServerStateFilePath(test.deps.env), "utf8"),
    ) as { port: number };

    expect(exitCode).toBe(0);
    expect(test.getSpawnCount()).toBe(1);
    expect(test.getLastOpenedUrl()).toBe(
      expectedOpenUrl(`http://localhost:${persisted.port}`, documentPath),
    );
  });

  it("uses the preview-web frontend URL when that workflow is active", async () => {
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");
    fs.writeFileSync(
      devFrontendStateFile,
      `${JSON.stringify(
        {
          apiPort: null,
          appPort: 5174,
          mode: "preview-web",
          repoRoot: serverRoot,
          startedAt: new Date().toISOString(),
          url: "http://localhost:5174",
        },
        null,
        2,
      )}\n`,
    );

    let lastOpenedUrl: string | null = null;
    let spawnCount = 0;

    const deps = createCliDependencies({
      env: {
        ...process.env,
        ROUGHDRAFT_STATE_DIR: stateDir,
        ROUGHDRAFT_DEV_FRONTEND_STATE_FILE: devFrontendStateFile,
      },
      cwd: projectDir,
      fetchImpl: async (input) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );

        if (url.href === "http://localhost:5174/") {
          return new Response("<!doctype html><html></html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        }

        throw new Error("connect ECONNREFUSED");
      },
      spawnServerProcess: async () => {
        spawnCount += 1;
        throw new Error("should not spawn");
      },
      isProcessRunning: () => false,
      stopProcess: async () => {},
      openUrl: (url) => {
        lastOpenedUrl = url;
        return "disabled";
      },
      log: () => {},
      error: () => {},
    });

    const exitCode = await runCli(["open", documentPath, "--no-watch"], deps);

    expect(exitCode).toBe(0);
    expect(spawnCount).toBe(0);
    expect(lastOpenedUrl).toBe(
      expectedOpenUrl("http://localhost:5174", documentPath),
    );
  });

  it("rejects missing markdown files before opening", async () => {
    const test = createTestDependencies();
    const missingPath = path.join(projectDir, "missing.md");

    const exitCode = await runCli(["open", missingPath], test.deps);

    expect(exitCode).toBe(1);
    expect(test.getSpawnCount()).toBe(0);
    expect(test.errors).toContain(`Path not found: ${missingPath}`);
    expect(test.getLastOpenedUrl()).toBeNull();
  });

  it("stops the running server and removes persisted state", async () => {
    const test = createTestDependencies();

    await ensureServerRunning(test.deps, { projectDir });
    const stopExitCode = await runCli(["stop"], test.deps);
    const statusExitCode = await runCli(["status"], test.deps);

    expect(stopExitCode).toBe(0);
    expect(statusExitCode).toBe(1);
    expect(fs.existsSync(getServerStateFilePath(test.deps.env))).toBeFalsy();
    expect(test.logs).toContain(
      "Roughdraft is not running. Start it with `roughdraft start`.",
    );
  });

  it("returns successful JSON status when Roughdraft is not running", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["status", "--json"], test.deps);
    const payload = parseOnlyJsonLog<{
      running: boolean;
      stateFile: string;
    }>(test.logs);

    expect(exitCode).toBe(0);
    expect(payload).toEqual({
      running: false,
      stateFile: getServerStateFilePath(test.deps.env),
    });
  });

  it("emits JSON from status when Roughdraft is running", async () => {
    const test = createTestDependencies();
    const result = await ensureServerRunning(test.deps, { projectDir });

    const exitCode = await runCli(["status", "--json"], test.deps);
    const payload = parseOnlyJsonLog<{
      running: boolean;
      url: string;
      port: number;
      pid: number;
      startedAt: string;
      stateFile: string;
      managed: boolean;
    }>(test.logs);

    expect(exitCode).toBe(0);
    expect(payload).toEqual({
      running: true,
      url: result.server.url,
      port: result.server.port,
      pid: result.server.pid,
      startedAt: result.server.startedAt,
      stateFile: getServerStateFilePath(test.deps.env),
      managed: true,
    });
  });

  it("prints watch and mcp in top-level help", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["--help"], test.deps);

    expect(exitCode).toBe(0);
    expect(test.logs.join("\n")).toContain("watch <path>");
    expect(test.logs.join("\n")).toContain("mcp");
  });

  it("waits for a review completed event from watch --json", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");

    const watchPromise = runCli(
      [
        "watch",
        documentPath,
        "--json",
        "--timeout",
        "2",
        "--batch-window",
        "0",
      ],
      test.deps,
    );

    let persisted: { port: number } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const stateFile = getServerStateFilePath(test.deps.env);
      if (fs.existsSync(stateFile)) {
        persisted = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
          port: number;
        };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(persisted).not.toBeNull();
    await fetch(`http://localhost:${persisted?.port}/api/review-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath: projectDir,
        path: "draft.md",
        overallComment: "Please prioritize the CLI contract.",
      }),
    });

    const exitCode = await watchPromise;
    const payload = parseOnlyJsonLog<{
      timedOut: boolean;
      events: Array<{
        documentPath: string;
        overallComment?: string;
        type: string;
      }>;
    }>(test.logs);

    expect(exitCode).toBe(0);
    expect(payload.timedOut).toBe(false);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      documentPath,
      overallComment: "Please prioritize the CLI contract.",
      type: "review.completed",
    });
  });

  it("re-polls with bounded timeouts and afterSequence threading until an event arrives", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");

    const watchBodies: Array<Record<string, unknown>> = [];
    const watchResponses = [
      { events: [], timedOut: true, nextSequence: 5 },
      {
        events: [{ documentPath, type: "review.completed", sequence: 5 }],
        timedOut: false,
        nextSequence: 6,
      },
    ];
    const deps = {
      ...test.deps,
      fetchImpl: (async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );
        if (url.pathname === "/api/review-events/watch") {
          watchBodies.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          );
          const payload =
            watchResponses[
              Math.min(watchBodies.length, watchResponses.length) - 1
            ];
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return test.deps.fetchImpl(input, init);
      }) as typeof fetch,
    };

    const exitCode = await runCli(["watch", documentPath, "--json"], deps);

    expect(exitCode).toBe(0);
    expect(watchBodies).toHaveLength(2);
    expect(watchBodies[0]).toMatchObject({
      fromNow: true,
      timeoutSeconds: WATCH_POLL_SECONDS,
    });
    expect(watchBodies[0]).not.toHaveProperty("afterSequence");
    expect(watchBodies[1]).toMatchObject({
      fromNow: false,
      afterSequence: 4,
      timeoutSeconds: WATCH_POLL_SECONDS,
    });

    const payload = parseOnlyJsonLog<{
      timedOut: boolean;
      events: Array<{ documentPath: string; type: string }>;
    }>(test.logs);
    expect(payload.timedOut).toBe(false);
    expect(payload.events).toHaveLength(1);
  });

  it("opens a document and waits for the next review event by default from open --json", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");
    let watchRequestBody: {
      timeoutSeconds?: number;
      batchWindowSeconds?: number;
    } | null = null;
    const deps = {
      ...test.deps,
      fetchImpl: async (input: Parameters<typeof fetch>[0], init) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );
        if (
          url.pathname === "/api/review-events/watch" &&
          typeof init?.body === "string"
        ) {
          watchRequestBody = JSON.parse(init.body) as {
            timeoutSeconds?: number;
            batchWindowSeconds?: number;
          };
        }
        return test.deps.fetchImpl(input, init);
      },
    };

    const watchPromise = runCli(
      ["open", documentPath, "--json", "--batch-window", "0"],
      deps,
    );

    let persisted: { port: number } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const stateFile = getServerStateFilePath(test.deps.env);
      if (fs.existsSync(stateFile)) {
        persisted = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
          port: number;
        };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(persisted).not.toBeNull();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (watchRequestBody) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(watchRequestBody).toMatchObject({
      batchWindowSeconds: 0,
      timeoutSeconds: WATCH_POLL_SECONDS,
    });
    await fetch(`http://localhost:${persisted?.port}/api/review-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath: projectDir, path: "draft.md" }),
    });

    const exitCode = await watchPromise;
    const payload = parseOnlyJsonLog<{
      timedOut: boolean;
      events: Array<{ documentPath: string; type: string }>;
    }>(test.logs);

    expect(exitCode).toBe(0);
    expect(test.getLastOpenedUrl()).toContain(encodeURIComponent(documentPath));
    expect(payload).toMatchObject({
      timedOut: false,
      events: [
        {
          documentPath,
          type: "review.completed",
        },
      ],
    });
  });

  it("cleans stale state during status checks", async () => {
    const test = createTestDependencies();
    const stateFilePath = getServerStateFilePath(test.deps.env);

    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(
      stateFilePath,
      JSON.stringify({
        port: 3999,
        pid: 999999,
        startedAt: new Date().toISOString(),
        url: "http://localhost:3999",
      }),
    );

    const exitCode = await runCli(["status"], test.deps);

    expect(exitCode).toBe(1);
    expect(fs.existsSync(stateFilePath)).toBeFalsy();
  });

  it("reports and reuses an unmanaged server when the tracked pid is stale", async () => {
    const logs: string[] = [];
    const stateFilePath = path.join(stateDir, "server.json");

    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(
      stateFilePath,
      JSON.stringify({
        port: ROUGHDRAFT_DEFAULT_PORT,
        pid: 424242,
        startedAt: new Date().toISOString(),
        url: `http://localhost:${ROUGHDRAFT_DEFAULT_PORT}`,
      }),
    );

    const deps = createCliDependencies({
      env: {
        ...process.env,
        ROUGHDRAFT_STATE_DIR: stateDir,
      },
      cwd: projectDir,
      fetchImpl: async (input) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );

        if (
          url.pathname === "/api/status" &&
          url.port === String(ROUGHDRAFT_DEFAULT_PORT)
        ) {
          return new Response(
            JSON.stringify({
              backend: "local-files",
              port: ROUGHDRAFT_DEFAULT_PORT,
              projectDir,
              serverRoot,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error("connect ECONNREFUSED");
      },
      isProcessRunning: () => false,
      stopProcess: async () => {},
      spawnServerProcess: async () => {
        throw new Error("should not spawn");
      },
      openUrl: () => "disabled",
      log: (message) => logs.push(message),
      error: () => {},
    });

    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "# Draft\n");

    const statusExitCode = await runCli(["status"], deps);
    const openExitCode = await runCli(
      ["open", documentPath, "--no-watch"],
      deps,
    );

    expect(statusExitCode).toBe(0);
    expect(openExitCode).toBe(0);
    expect(logs).toContain(
      `Roughdraft is running at http://localhost:${ROUGHDRAFT_DEFAULT_PORT}`,
    );
    expect(logs).toContain(
      `This server is not managed by ${getServerStateFilePath(deps.env)}.`,
    );
    expect(fs.existsSync(stateFilePath)).toBeFalsy();
  });

  it("rejects directories before opening", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["open", projectDir], test.deps);

    expect(exitCode).toBe(1);
    expect(test.getSpawnCount()).toBe(0);
    expect(test.errors).toContain(
      `Roughdraft can only open .md files: ${projectDir}`,
    );
    expect(test.getLastOpenedUrl()).toBeNull();
  });

  it("cleans stale state and warns when another Roughdraft instance owns the port during stop", async () => {
    const errors: string[] = [];
    const stateFilePath = path.join(stateDir, "server.json");

    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(
      stateFilePath,
      JSON.stringify({
        port: ROUGHDRAFT_DEFAULT_PORT,
        pid: 424242,
        startedAt: new Date().toISOString(),
        url: `http://localhost:${ROUGHDRAFT_DEFAULT_PORT}`,
      }),
    );

    const deps = createCliDependencies({
      env: {
        ...process.env,
        ROUGHDRAFT_STATE_DIR: stateDir,
      },
      cwd: projectDir,
      fetchImpl: async (input) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );

        if (
          url.pathname === "/api/status" &&
          url.port === String(ROUGHDRAFT_DEFAULT_PORT)
        ) {
          return new Response(
            JSON.stringify({
              backend: "local-files",
              port: ROUGHDRAFT_DEFAULT_PORT,
              projectDir,
              serverRoot,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error("connect ECONNREFUSED");
      },
      isProcessRunning: () => false,
      stopProcess: async () => {},
      spawnServerProcess: async () => {
        throw new Error("should not spawn");
      },
      openUrl: () => "disabled",
      log: () => {},
      error: (message) => errors.push(message),
    });

    const stopExitCode = await runCli(["stop"], deps);

    expect(stopExitCode).toBe(1);
    expect(errors).toContain(
      `Stopped tracked Roughdraft process 424242, but another Roughdraft instance is still running at http://localhost:${ROUGHDRAFT_DEFAULT_PORT}.`,
    );
    expect(fs.existsSync(stateFilePath)).toBeFalsy();
  });

  it("stops a confidently identified unmanaged server with stop --all", async () => {
    const logs: string[] = [];
    let unmanagedRunning = true;
    let stoppedPid: number | null = null;

    const deps = createCliDependencies({
      env: {
        ...process.env,
        ROUGHDRAFT_STATE_DIR: stateDir,
      },
      cwd: projectDir,
      fetchImpl: async (input) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );

        if (
          unmanagedRunning &&
          url.pathname === "/api/status" &&
          url.port === String(ROUGHDRAFT_DEFAULT_PORT)
        ) {
          return new Response(
            JSON.stringify({
              backend: "local-files",
              pid: 4242,
              port: ROUGHDRAFT_DEFAULT_PORT,
              projectDir,
              serverRoot,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error("connect ECONNREFUSED");
      },
      isProcessRunning: (pid) => unmanagedRunning && pid === 4242,
      stopProcess: async (pid) => {
        stoppedPid = pid;
        unmanagedRunning = false;
      },
      spawnServerProcess: async () => {
        throw new Error("should not spawn");
      },
      openUrl: () => "disabled",
      log: (message) => logs.push(message),
      error: () => {},
    });

    const exitCode = await runCli(["stop", "--all"], deps);

    expect(exitCode).toBe(0);
    expect(stoppedPid).toBe(4242);
    expect(logs).toContain(
      `Stopped unmanaged Roughdraft at http://localhost:${ROUGHDRAFT_DEFAULT_PORT}.`,
    );
  });

  it("documents extended review syntax in criticmarkup help", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["help", "criticmarkup"], test.deps);

    expect(exitCode).toBe(0);
    expect(test.logs).toContain("When adding new review feedback:");
    expect(test.logs).toContain(
      "  Prefer compact references like {>>Comment<<}{#c1} with metadata in final YAML endmatter.",
    );
    expect(test.logs).toContain(
      "  Use `c1`, `c2`, etc. for comment ids and `s1`, `s2`, etc. for suggested-change ids.",
    );
    expect(test.logs).toContain("Suggested changes with ids:");
    expect(test.logs).toContain("  Add {++one concrete example++}{#s1}.");
    expect(test.logs).toContain(
      "  Replace {~~vague phrasing~>specific wording~~}{#s2}.",
    );
    expect(test.logs).toContain("Reply to an existing comment:");
    expect(test.logs).toContain(
      "  Existing inline attribute metadata is still accepted for compatibility.",
    );
    expect(test.logs).toContain(
      "  Comment ids are document-local and usually look like `c1`, `c2`, `c3`.",
    );
    expect(test.logs).toContain(
      "  Treat CriticMarkup inside fenced code blocks as literal example text.",
    );
    expect(test.logs).toContain(
      "  https://roughdraft.md/spec/roughdraft-flavored-markdown.md",
    );
  });

  it("prints copyable criticmarkup suggestion examples with required YAML metadata", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["help", "criticmarkup"], test.deps);
    const example = extractHelpExample(
      test.logs,
      "Suggested changes with ids:",
      "Reply to an existing comment:",
    );
    const validation = validateRoughdraftMarkdown(example);

    expect(exitCode).toBe(0);
    expect(example).toContain("suggestions:");
    expect(example).toContain("  s1:");
    expect(example).toContain("  s2:");
    expect(validation.diagnostics).toEqual([]);
    expect(validation.summary.suggestions).toBe(2);
  });

  it("points general help to agent setup", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["help"], test.deps);

    expect(exitCode).toBe(0);
    expect(test.logs).toContain(
      "  help agent         Print the agent setup prompt",
    );
    expect(test.logs).toContain("Agent setup: https://roughdraft.md/setup.md");
    expect(test.logs).toContain(
      "Use `roughdraft help agent` for a copyable setup prompt.",
    );
  });

  it("prints a copyable agent setup prompt", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["help", "agent"], test.deps);

    expect(exitCode).toBe(0);
    expect(test.logs).toContain(
      "To set up your coding agent, paste this into it:",
    );
    expect(test.logs).toContain(
      "Install Roughdraft for me using `npm i -g roughdraft`, then read https://roughdraft.md/setup.md and set yourself up to use it.",
    );
    expect(test.logs).toContain(
      "This command only prints setup text. It does not edit agent instruction files.",
    );
  });

  it("keeps CLAUDE.md as a short compatibility shim to AGENTS.md", () => {
    const claudePath = path.join(serverRoot, "CLAUDE.md");
    const claude = fs.readFileSync(claudePath, "utf8");

    expect(claude.length).toBeLessThan(200);
    expect(claude).toContain("@AGENTS.md");
    expect(claude).toContain("compatibility shim");
    expect(fs.lstatSync(claudePath).isSymbolicLink()).toBe(false);
  });

  it("treats removed install command as an unknown command", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["install"], test.deps);

    expect(exitCode).toBe(2);
    expect(test.errors).toContain("Unknown command: install.");
    expect(test.logs).toEqual([]);
  });

  it("prints package version only for --version", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["--version"], test.deps);

    expect(exitCode).toBe(0);
    expect(test.logs).toHaveLength(1);
    expect(test.logs[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("shows per-command help", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["open", "--help"], test.deps);

    expect(exitCode).toBe(0);
    expect(test.logs).toContain(
      "  roughdraft open <path> [--no-open] [--no-watch] [--print-url] [--port <port>]",
    );
    expect(test.logs).toContain(
      "  --no-watch           Open the file without waiting",
    );
    expect(test.logs).toContain(
      "  --timeout <seconds>  Maximum watch time; omitted means no timeout",
    );
  });

  it("shows doctor help with the optional markdown path", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["doctor", "--help"], test.deps);

    expect(exitCode).toBe(0);
    expect(test.logs).toContain("  roughdraft doctor [path] [--json]");
  });

  it("rejects unknown command typos with suggestions", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["stats"], test.deps);

    expect(exitCode).toBe(2);
    expect(test.errors).toContain(
      "Unknown command: stats. Did you mean status?",
    );
  });

  it("supports agent-setup as a direct setup helper", async () => {
    const test = createTestDependencies();

    const exitCode = await runCli(["agent-setup"], test.deps);

    expect(exitCode).toBe(0);
    expect(test.logs).toContain(
      "Live setup instructions: https://roughdraft.md/setup.md",
    );
  });

  it("reports dev wrapper metadata from doctor --json", async () => {
    const logs: string[] = [];
    const wrapperPath = path.join(tempDir, "bin", "roughdraft-dev-lyon-v2");
    const devStateDir = path.join(
      tempDir,
      ".roughdraft",
      "dev",
      "roughdraft-dev-lyon-v2",
    );
    const deps = createCliDependencies({
      env: {
        ...process.env,
        ROUGHDRAFT_DEV_WRAPPER_NAME: "roughdraft-dev-lyon-v2",
        ROUGHDRAFT_DEV_WRAPPER_PATH: wrapperPath,
        ROUGHDRAFT_DEV_WRAPPER_REPO_ROOT: serverRoot,
        ROUGHDRAFT_STATE_DIR: devStateDir,
      },
      cwd: projectDir,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      log: (message) => logs.push(message),
      error: () => {},
    });

    const exitCode = await runCli(["doctor", "--json"], deps);
    const payload = parseOnlyJsonLog<{
      devWrapper: {
        commandName: string;
        path: string;
        repoRoot: string;
        repoRootMatches: boolean;
        stateDir: string;
      };
    }>(logs);

    expect(exitCode).toBe(0);
    expect(payload.devWrapper).toEqual({
      commandName: "roughdraft-dev-lyon-v2",
      path: wrapperPath,
      repoRoot: serverRoot,
      repoRootMatches: true,
      stateDir: devStateDir,
    });
  });

  it("validates a conforming markdown file from doctor path", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(
      documentPath,
      'Please revisit {==this sentence==}{>>Needs a source.<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}.\n',
    );

    const exitCode = await runCli(["doctor", documentPath], test.deps);

    expect(exitCode).toBe(0);
    expect(test.logs).toContain("Roughdraft Markdown doctor: draft.md");
    expect(test.logs).toContain("Status: passed");
    expect(test.logs).toContain("Found 1 comment(s) and 0 suggestion(s).");
  });

  it("returns validation errors from doctor path", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(documentPath, "{>>Needs metadata<<}\n");

    const exitCode = await runCli(["doctor", documentPath], test.deps);

    expect(exitCode).toBe(1);
    expect(test.logs).toContain("Status: failed");
    expect(test.logs).toContain("Errors:");
    expect(test.logs).toContain(
      "  1:1  Missing required metadata attribute `id`.",
    );
  });

  it("emits JSON validation output from doctor path --json", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.md");
    fs.writeFileSync(
      documentPath,
      [
        '{>>First<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}',
        '{++Second++}{id="c1" by="user" at="2026-04-28T12:01:00.000Z"}',
      ].join("\n"),
    );

    const exitCode = await runCli(
      ["doctor", documentPath, "--json"],
      test.deps,
    );
    const payload = parseOnlyJsonLog<{
      kind: string;
      path: string;
      ok: boolean;
      errors: Array<{ code: string }>;
      summary: { comments: number; suggestions: number };
    }>(test.logs);

    expect(exitCode).toBe(1);
    expect(payload).toMatchObject({
      kind: "markdown",
      path: documentPath,
      ok: false,
      summary: {
        comments: 1,
        suggestions: 1,
      },
    });
    expect(payload.errors.map((error) => error.code)).toContain("duplicate-id");
  });

  it("rejects missing markdown files from doctor path before validation", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "missing.md");

    const exitCode = await runCli(["doctor", documentPath], test.deps);

    expect(exitCode).toBe(2);
    expect(test.errors).toContain(`Path not found: ${documentPath}`);
  });

  it("rejects non-markdown doctor paths as usage errors", async () => {
    const test = createTestDependencies();
    const documentPath = path.join(projectDir, "draft.txt");
    fs.writeFileSync(documentPath, "# Draft\n");

    const exitCode = await runCli(["doctor", documentPath], test.deps);

    expect(exitCode).toBe(2);
    expect(test.errors).toContain(
      `Roughdraft doctor can only validate .md files: ${documentPath}`,
    );
  });

  it("starts a new server when the preferred port belongs to another checkout", async () => {
    const stateFilePath = path.join(stateDir, "server.json");
    const otherServerRoot = path.join(tempDir, "other-checkout");
    let spawnedPort: number | null = null;
    let spawnedProjectDir: string | null = null;
    let spawned = false;

    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(
      stateFilePath,
      JSON.stringify({
        port: ROUGHDRAFT_DEFAULT_PORT,
        pid: 424242,
        startedAt: new Date().toISOString(),
        url: `http://localhost:${ROUGHDRAFT_DEFAULT_PORT}`,
      }),
    );

    const deps = createCliDependencies({
      env: {
        ...process.env,
        ROUGHDRAFT_STATE_DIR: stateDir,
      },
      cwd: projectDir,
      fetchImpl: async (input) => {
        const url =
          input instanceof URL
            ? input
            : new URL(
                typeof input === "string" ? input : input.url,
                "http://localhost",
              );

        if (url.pathname !== "/api/status") {
          throw new Error("Unexpected request");
        }

        if (url.port === String(ROUGHDRAFT_DEFAULT_PORT)) {
          return new Response(
            JSON.stringify({
              backend: "local-files",
              port: ROUGHDRAFT_DEFAULT_PORT,
              projectDir: path.join(tempDir, "other-project"),
              serverRoot: otherServerRoot,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        if (url.port === String(ROUGHDRAFT_DEFAULT_PORT + 1) && spawned) {
          return new Response(
            JSON.stringify({
              backend: "local-files",
              port: ROUGHDRAFT_DEFAULT_PORT + 1,
              projectDir,
              serverRoot,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error("connect ECONNREFUSED");
      },
      findAvailablePortImpl: async () => ROUGHDRAFT_DEFAULT_PORT + 1,
      spawnServerProcess: async ({ port, projectDir: nextProjectDir }) => {
        spawned = true;
        spawnedPort = port;
        spawnedProjectDir = nextProjectDir;
        return { pid: 1001 };
      },
      isProcessRunning: (pid) => pid === 424242,
      stopProcess: async () => {},
      openUrl: () => "disabled",
      log: () => {},
      error: () => {},
    });

    const result = await ensureServerRunning(deps, { projectDir });

    expect(result.reused).toBe(false);
    expect(spawnedPort).toBe(ROUGHDRAFT_DEFAULT_PORT + 1);
    expect(spawnedProjectDir).toBe(projectDir);
    expect(result.server.port).toBe(ROUGHDRAFT_DEFAULT_PORT + 1);
  });
});

describe("runCli open in remote mode", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-cli-remote-"));
    projectDir = path.join(tempDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function startRemoteHost(remoteDocumentToken?: string): Promise<{
    url: string;
    close: () => Promise<void>;
  }> {
    const { app } = createApp({
      homeDir: tempDir,
      remoteDocumentToken,
      staticDirPath: tempDir,
    });
    const server = createHttpServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind remote host");
    }
    return {
      url: `http://127.0.0.1:${address.port}`,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    };
  }

  it("prints register failure and exits 1 when the remote host is unreachable", async () => {
    const filePath = path.join(projectDir, "draft.md");
    fs.writeFileSync(filePath, "# hello\n");

    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = await runCli(["open", filePath], {
      env: { ROUGHDRAFT_HOST: "http://127.0.0.1:1" },
      cwd: projectDir,
      log: (m) => logs.push(m),
      error: (m) => errors.push(m),
      openUrl: () => "disabled",
      resolveUpdateStatus: async () => ({
        packageName: "roughdraft",
        currentVersion: "0.1.0",
        latestVersion: "0.1.0",
        updateAvailable: false,
        updateCommand: "",
      }),
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Could not register remote session");
  });

  it("rejects non-.md targets in remote mode without contacting the host", async () => {
    const filePath = path.join(projectDir, "notes.txt");
    fs.writeFileSync(filePath, "hello");

    const errors: string[] = [];
    let fetchCalls = 0;

    const exitCode = await runCli(["open", filePath], {
      env: { ROUGHDRAFT_HOST: "http://127.0.0.1:1" },
      cwd: projectDir,
      log: () => {},
      error: (m) => errors.push(m),
      openUrl: () => "disabled",
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response("", { status: 200 });
      },
      resolveUpdateStatus: async () => ({
        packageName: "roughdraft",
        currentVersion: "0.1.0",
        latestVersion: "0.1.0",
        updateAvailable: false,
        updateCommand: "",
      }),
    });

    expect(exitCode).toBe(1);
    expect(fetchCalls).toBe(0);
    expect(errors.join("\n")).toContain("can only open .md files");
  });

  it("registers a session, opens the viewer URL, and writes save events to disk", {
    timeout: 15_000,
  }, async () => {
    const remote = await startRemoteHost();
    try {
      const filePath = path.join(projectDir, "draft.md");
      fs.writeFileSync(filePath, "before\n");

      const logs: string[] = [];
      const errors: string[] = [];
      let openedUrl: string | null = null;

      const cliPromise = runCli(["open", filePath], {
        env: { ROUGHDRAFT_HOST: remote.url },
        cwd: projectDir,
        log: (m) => logs.push(m),
        error: (m) => errors.push(m),
        openUrl: (url) => {
          openedUrl = url;
          return "disabled";
        },
        resolveUpdateStatus: async () => ({
          packageName: "roughdraft",
          currentVersion: "0.1.0",
          latestVersion: "0.1.0",
          updateAvailable: false,
          updateCommand: "",
        }),
      });

      // Wait for the CLI to register and open the SSE channel.
      const deadline = Date.now() + 4000;
      while (openedUrl === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(openedUrl).not.toBeNull();
      const sessionId = new URL(
        openedUrl as unknown as string,
      ).searchParams.get("session");
      expect(sessionId).toBeTruthy();

      // Wait until the server actually has the SSE client connected before PUTting.
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Trigger a save event by PUTting new content.
      const putResponse = await fetch(
        `${remote.url}/api/remote-document/${sessionId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "after\n" }),
        },
      );
      expect(putResponse.status).toBe(200);

      // Wait until the file on disk reflects the save.
      const writeDeadline = Date.now() + 4000;
      while (
        fs.readFileSync(filePath, "utf-8") !== "after\n" &&
        Date.now() < writeDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fs.readFileSync(filePath, "utf-8")).toBe("after\n");

      // Closing the server ends the SSE stream and lets the CLI exit cleanly.
      await remote.close();
      const exitCode = await cliPromise;
      expect(exitCode).toBe(0);
      expect(
        logs.some((m) => m.includes("Opened remote Roughdraft session")),
      ).toBe(true);
    } finally {
      await remote.close();
    }
  });

  it("authenticates remote registration and the CLI save-back stream with ROUGHDRAFT_TOKEN", {
    timeout: 15_000,
  }, async () => {
    const remote = await startRemoteHost("secret-token");
    try {
      const filePath = path.join(projectDir, "draft.md");
      fs.writeFileSync(filePath, "before\n");

      const logs: string[] = [];
      const errors: string[] = [];
      let openedUrl: string | null = null;

      const cliPromise = runCli(["open", filePath], {
        env: {
          ROUGHDRAFT_HOST: remote.url,
          ROUGHDRAFT_TOKEN: "secret-token",
        },
        cwd: projectDir,
        log: (m) => logs.push(m),
        error: (m) => errors.push(m),
        openUrl: (url) => {
          openedUrl = url;
          return "disabled";
        },
        resolveUpdateStatus: async () => ({
          packageName: "roughdraft",
          currentVersion: "0.1.0",
          latestVersion: "0.1.0",
          updateAvailable: false,
          updateCommand: "",
        }),
      });

      const openDeadline = Date.now() + 4000;
      while (openedUrl === null && Date.now() < openDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(openedUrl).not.toBeNull();

      const parsedOpenedUrl = new URL(openedUrl as unknown as string);
      const sessionId = parsedOpenedUrl.searchParams.get("session");
      expect(sessionId).toBeTruthy();
      expect(parsedOpenedUrl.searchParams.get("token")).toBe("secret-token");

      await new Promise((resolve) => setTimeout(resolve, 100));

      const putResponse = await fetch(
        `${remote.url}/api/remote-document/${sessionId}`,
        {
          method: "PUT",
          headers: {
            Authorization: "Bearer secret-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: "after-token\n" }),
        },
      );
      expect(putResponse.status).toBe(200);

      const writeDeadline = Date.now() + 4000;
      while (
        fs.readFileSync(filePath, "utf-8") !== "after-token\n" &&
        Date.now() < writeDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fs.readFileSync(filePath, "utf-8")).toBe("after-token\n");

      await remote.close();
      expect(await cliPromise).toBe(0);
      expect(errors).toEqual([]);
      expect(
        logs.some((m) => m.includes("Opened remote Roughdraft session")),
      ).toBe(true);
    } finally {
      await remote.close();
    }
  });

  it("writes remote saves to disk without altering markdown constructs", {
    timeout: 15_000,
  }, async () => {
    const remote = await startRemoteHost();
    try {
      const filePath = path.join(projectDir, "roundtrip.md");
      const originalContent = [
        "---",
        "title: Remote Roundtrip",
        "---",
        "",
        "# Remote Roundtrip",
        "",
        "{>>Keep this comment<<}",
        "{++new text++}",
        "{--old text--}",
        "{~~old~>new~~}",
        "{==highlight==}",
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "- [ ] task",
        "",
        "```md",
        "{>>literal example<<}",
        "```",
        "",
        "Inline `{>>literal<<}` and [local](./neighbor.md).",
        "",
        "<aside>supported html</aside>",
        "",
      ].join("\n");
      const savedContent = originalContent.replace(
        "# Remote Roundtrip",
        "# Remote Roundtrip Edited",
      );
      fs.writeFileSync(filePath, originalContent);

      const logs: string[] = [];
      const errors: string[] = [];
      let openedUrl: string | null = null;

      const cliPromise = runCli(["open", filePath], {
        env: { ROUGHDRAFT_HOST: remote.url },
        cwd: projectDir,
        log: (m) => logs.push(m),
        error: (m) => errors.push(m),
        openUrl: (url) => {
          openedUrl = url;
          return "disabled";
        },
        resolveUpdateStatus: async () => ({
          packageName: "roughdraft",
          currentVersion: "0.1.0",
          latestVersion: "0.1.0",
          updateAvailable: false,
          updateCommand: "",
        }),
      });

      const openDeadline = Date.now() + 4000;
      while (openedUrl === null && Date.now() < openDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(openedUrl).not.toBeNull();

      const sessionId = new URL(
        openedUrl as unknown as string,
      ).searchParams.get("session");
      expect(sessionId).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 100));

      const loaded = await fetch(
        `${remote.url}/api/remote-document/${sessionId}`,
      );
      expect(loaded.status).toBe(200);
      const payload = (await loaded.json()) as { version: string };

      const putResponse = await fetch(
        `${remote.url}/api/remote-document/${sessionId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: savedContent,
            expectedVersion: payload.version,
          }),
        },
      );
      expect(putResponse.status).toBe(200);

      const writeDeadline = Date.now() + 4000;
      while (
        fs.readFileSync(filePath, "utf-8") !== savedContent &&
        Date.now() < writeDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fs.readFileSync(filePath, "utf-8")).toBe(savedContent);

      await remote.close();
      expect(await cliPromise).toBe(0);
      expect(errors).toEqual([]);
      expect(
        logs.some((m) => m.includes("Saved") && m.includes("roundtrip.md")),
      ).toBe(true);
    } finally {
      await remote.close();
    }
  });

  it("keeps the CLI save-back stream when a browser also watches the remote session", {
    timeout: 15_000,
  }, async () => {
    const remote = await startRemoteHost();
    let browserEventsReader: ReadableStreamDefaultReader<Uint8Array> | null =
      null;

    try {
      const filePath = path.join(projectDir, "draft.md");
      fs.writeFileSync(filePath, "before\n");

      const logs: string[] = [];
      const errors: string[] = [];
      let openedUrl: string | null = null;
      let cliSettled = false;

      const cliPromise = runCli(["open", filePath], {
        env: { ROUGHDRAFT_HOST: remote.url },
        cwd: projectDir,
        log: (m) => logs.push(m),
        error: (m) => errors.push(m),
        openUrl: (url) => {
          openedUrl = url;
          return "disabled";
        },
        resolveUpdateStatus: async () => ({
          packageName: "roughdraft",
          currentVersion: "0.1.0",
          latestVersion: "0.1.0",
          updateAvailable: false,
          updateCommand: "",
        }),
      }).finally(() => {
        cliSettled = true;
      });

      const openDeadline = Date.now() + 4000;
      while (openedUrl === null && Date.now() < openDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(openedUrl).not.toBeNull();

      const sessionId = new URL(
        openedUrl as unknown as string,
      ).searchParams.get("session");
      expect(sessionId).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 100));

      const browserEvents = await fetch(
        `${remote.url}/api/remote-document/${sessionId}/events?role=viewer`,
      );
      expect(browserEvents.status).toBe(200);
      browserEventsReader = browserEvents.body?.getReader() ?? null;
      expect(browserEventsReader).not.toBeNull();

      const decoder = new TextDecoder();
      let connectedChunk = "";
      const browserConnectDeadline = Date.now() + 4000;
      while (
        !connectedChunk.includes("event: connected") &&
        Date.now() < browserConnectDeadline
      ) {
        const chunk = await browserEventsReader?.read();
        if (!chunk || chunk.done) break;
        connectedChunk += decoder.decode(chunk.value);
      }
      expect(connectedChunk).toContain("event: connected");

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(cliSettled).toBe(false);

      const putResponse = await fetch(
        `${remote.url}/api/remote-document/${sessionId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "after-browser-watch\n" }),
        },
      );
      expect(putResponse.status).toBe(200);

      const writeDeadline = Date.now() + 4000;
      while (
        fs.readFileSync(filePath, "utf-8") !== "after-browser-watch\n" &&
        Date.now() < writeDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fs.readFileSync(filePath, "utf-8")).toBe("after-browser-watch\n");

      await browserEventsReader?.cancel();
      await remote.close();
      expect(await cliPromise).toBe(0);
      expect(errors).toEqual([]);
      expect(
        logs.some((m) => m.includes("Opened remote Roughdraft session")),
      ).toBe(true);
    } finally {
      await browserEventsReader?.cancel().catch(() => undefined);
      await remote.close();
    }
  });
});
