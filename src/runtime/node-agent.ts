/**
 * HyperHost Standalone Runtime Node Agent Daemon
 * Powered by HyperSoft
 *
 * Deployable on dedicated Runtime Node servers (separate from the Clever Cloud Control Plane).
 * Connects via persistent authenticated WebSocket to `/api/runtime/nodes/ws`, completes
 * capability handshake, reports real OS telemetry heartbeats, and executes isolated Host workloads.
 */
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import WebSocket from 'ws';
import { logger } from '../server/logger';
import type { RuntimeExecutionSpec } from './interfaces';

function loadDotEnvIfPresent(): void {
  const candidatePaths = [
    process.env.HYPERHOST_BOOTSTRAP_ENV_FILE,
    '/etc/hyperhost/node-agent.env',
    path.resolve(process.cwd(), '.env'),
  ].filter((p): p is string => Boolean(p));

  for (const envPath of candidatePaths) {
    try {
      if (!fsSync.existsSync(envPath)) continue;
      const content = fsSync.readFileSync(envPath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined && val !== '') {
          process.env[key] = val;
        }
      }
    } catch {
      // Ignore read errors
    }
  }
}

loadDotEnvIfPresent();

const WORKSPACE_ROOT = path.resolve(
  process.env.NODE_WORKSPACE_ROOT || '/tmp/hyperhost-workspaces'
);

const ALLOWED_RUNTIME_BINARIES = new Set([
  'node',
  'npm',
  'npx',
  'tsx',
  'bun',
  'deno',
  'python',
  'python3',
  'pip',
  'pip3',
  'uvicorn',
  'gunicorn',
  'java',
  'javac',
  'mvn',
  'gradle',
  'go',
  'cargo',
  'rustc',
  'php',
  'composer',
  'ruby',
  'bundle',
  'dotnet',
]);

const FORBIDDEN_ENV_KEYS = new Set([
  'NODE_TOKEN',
  'RUNTIME_NODE_SECRET',
  'NODE_ENROLLMENT_SECRET',
  'CONTROL_PLANE_WS_URL',
  'CONTROL_PLANE_URL',
  'DATABASE_URL',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_SECRET',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'NODE_OPTIONS',
]);

interface ManagedHostProcess {
  hostId: string;
  proc: ChildProcessWithoutNullStreams;
  startedAt: number;
  memoryLimitMb: number;
  diskLimitMb: number;
  cpuLimitPercent: number;
  stoppingIntentionally?: boolean;
}

const runningProcesses = new Map<string, ManagedHostProcess>();

export function normalizeControlPlaneWsUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  const withWsScheme = trimmed
    .replace(/^https:\/\//i, 'wss://')
    .replace(/^http:\/\//i, 'ws://');
  if (withWsScheme.endsWith('/api/runtime/nodes/ws')) {
    return withWsScheme;
  }
  return `${withWsScheme}/api/runtime/nodes/ws`;
}

function getCleanHostId(hostId: string): string {
  const clean = hostId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) {
    throw new Error('Invalid host identifier');
  }
  return clean;
}

export function resolveSafeHostPath(hostId: string, requestedPath: string): string {
  if (requestedPath.includes('\0')) {
    throw new Error('Path traversal is prohibited');
  }
  const cleanHostId = getCleanHostId(hostId);
  const rootDir = path.resolve(WORKSPACE_ROOT, cleanHostId);

  let rel = requestedPath.trim();
  if (rel === '/home/container' || rel === '/home/container/') {
    rel = '/';
  } else if (rel.startsWith('/home/container/')) {
    rel = rel.slice('/home/container'.length);
  }

  const segments = rel.split(/[\\/]+/);
  if (segments.includes('..')) {
    throw new Error('Path traversal is prohibited');
  }

  const normalizedRel = path.posix.normalize('/' + rel.replace(/\\/g, '/'));
  const target = path.resolve(rootDir, '.' + normalizedRel);
  const relativeToRoot = path.relative(rootDir, target);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('Path traversal is prohibited');
  }
  return target;
}

export function parseAndValidateStartupCommand(
  hostId: string,
  workDir: string,
  rawCommand: string,
  extraArgs: string[] = []
): { binary: string; args: string[] } {
  const trimmed = (rawCommand || 'node index.js').trim();
  if (!trimmed) {
    throw new Error('Startup command cannot be empty');
  }

  // Prohibit shell metacharacters and command chaining
  if (/[;&|`$><\n\r\0]/.test(trimmed)) {
    throw new Error(
      'Startup command contains prohibited shell control characters'
    );
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const rawBinary = parts[0];
  const combinedArgs = [...parts.slice(1), ...extraArgs.map(String)];

  let resolvedBinary: string;
  if (rawBinary.startsWith('./')) {
    const candidate = resolveSafeHostPath(hostId, rawBinary.slice(2));
    resolvedBinary = candidate;
  } else if (ALLOWED_RUNTIME_BINARIES.has(rawBinary)) {
    resolvedBinary = rawBinary;
  } else {
    throw new Error(
      `Executable "${rawBinary}" is not permitted outside the Host workspace.`
    );
  }

  const safeArgs: string[] = [];
  for (const arg of combinedArgs) {
    if (arg.includes('\0') || arg.includes('\n') || arg.includes('\r')) {
      throw new Error('Invalid startup argument');
    }
    if (arg.split(/[\\/]+/).includes('..')) {
      throw new Error('Path traversal in startup arguments is prohibited');
    }
    if (arg === '/home/container' || arg.startsWith('/home/container/')) {
      const mapped = resolveSafeHostPath(hostId, arg);
      safeArgs.push(path.relative(workDir, mapped) || '.');
      continue;
    }
    if (arg.startsWith('/')) {
      const candidate = path.resolve(arg);
      const rel = path.relative(workDir, candidate);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(
          `Startup argument "${arg}" references a path outside the Host workspace.`
        );
      }
    }
    safeArgs.push(arg);
  }

  return { binary: resolvedBinary, args: safeArgs };
}

async function ensureWorkspaceInitialized(
  hostId: string,
  spec?: Partial<RuntimeExecutionSpec>
): Promise<string> {
  const rootDir = resolveSafeHostPath(hostId, '/');
  await fs.mkdir(rootDir, { recursive: true });

  const entries = await fs.readdir(rootDir).catch(() => []);
  if (entries.length > 0) {
    return rootDir;
  }

  const cmd = (spec?.startupCommand || 'node index.js').trim();
  const runtime = spec?.runtime || 'NODEJS';

  if (runtime === 'PYTHON' || cmd.startsWith('python')) {
    const targetFile = cmd.includes('main.py')
      ? resolveSafeHostPath(hostId, 'main.py')
      : resolveSafeHostPath(hostId, 'main.py');
    const pyBootstrap = [
      'import os, sys, time, signal, threading',
      '',
      'running = True',
      'def handle_sig(signum, frame):',
      '    global running',
      '    print("[HyperHost] Received shutdown signal, stopping process...", flush=True)',
      '    running = False',
      '    sys.exit(0)',
      '',
      'signal.signal(signal.SIGTERM, handle_sig)',
      'signal.signal(signal.SIGINT, handle_sig)',
      '',
      'print(f"[HyperHost] Python Host process started (PID {os.getpid()})", flush=True)',
      '',
      'def read_stdin():',
      '    for line in sys.stdin:',
      '        cmd = line.strip()',
      '        if not cmd:',
      '            continue',
      '        if cmd == "ping":',
      '            print("pong", flush=True)',
      '        elif cmd == "status":',
      '            print(f"status: RUNNING (PID {os.getpid()})", flush=True)',
      '        elif cmd == "stop":',
      '            handle_sig(signal.SIGTERM, None)',
      '        else:',
      '            print(f"[stdin] Executed: {cmd}", flush=True)',
      '',
      'threading.Thread(target=read_stdin, daemon=True).start()',
      'while running:',
      '    time.sleep(5)',
      '',
    ].join('\n');
    await fs.writeFile(targetFile, pyBootstrap, 'utf-8');
  } else {
    const targetFile = resolveSafeHostPath(hostId, 'index.js');
    const nodeBootstrap = [
      "const readline = require('node:readline');",
      'const startedAt = Date.now();',
      'console.log(`[HyperHost] Host process started and online (PID ${process.pid}, Node ${process.version})`);',
      '',
      'const rl = readline.createInterface({ input: process.stdin, terminal: false });',
      "rl.on('line', (line) => {",
      '  const cmd = line.trim();',
      '  if (!cmd) return;',
      "  if (cmd === 'ping') {",
      "    console.log('pong');",
      "  } else if (cmd === 'status' || cmd === 'uptime') {",
      '    const up = Math.floor((Date.now() - startedAt) / 1000);',
      '    console.log(`[HyperHost] Status: RUNNING | PID: ${process.pid} | Uptime: ${up}s`);',
      "  } else if (cmd === 'help') {",
      "    console.log('Available commands: help, ping, status, uptime, stop');",
      "  } else if (cmd === 'stop') {",
      "    console.log('[HyperHost] Stopping host process...');",
      '    process.exit(0);',
      '  } else {',
      '    console.log(`[HyperHost] Command received: ${cmd}`);',
      '  }',
      '});',
      '',
      'const keepAlive = setInterval(() => {}, 15000);',
      "const shutdown = (sig) => {",
      '  clearInterval(keepAlive);',
      '  console.log(`[HyperHost] Received ${sig}, shutting down cleanly...`);',
      '  process.exit(0);',
      '};',
      "process.on('SIGTERM', () => shutdown('SIGTERM'));",
      "process.on('SIGINT', () => shutdown('SIGINT'));",
      '',
    ].join('\n');
    await fs.writeFile(targetFile, nodeBootstrap, 'utf-8');
  }

  return rootDir;
}

async function calculateDirectorySizeBytes(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await calculateDirectorySizeBytes(fullPath);
      } else if (entry.isFile()) {
        const st = await fs.stat(fullPath);
        total += st.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

async function collectProcessResourceUsage(
  pid: number | undefined
): Promise<{ memoryBytes: number; cpuPercent: number }> {
  if (!pid || pid <= 0) {
    return { memoryBytes: 0, cpuPercent: 0 };
  }
  try {
    const statusRaw = await fs.readFile(`/proc/${pid}/status`, 'utf-8');
    const rssMatch = statusRaw.match(/^VmRSS:\s+(\d+)\s+kB/m);
    const memoryBytes = rssMatch ? Number(rssMatch[1]) * 1024 : 0;

    let cpuPercent = 0;
    try {
      const statRaw = await fs.readFile(`/proc/${pid}/stat`, 'utf-8');
      const closeParen = statRaw.lastIndexOf(')');
      if (closeParen > 0) {
        const fields = statRaw
          .slice(closeParen + 2)
          .trim()
          .split(/\s+/);
        const utimeTicks = Number(fields[11] || 0);
        const stimeTicks = Number(fields[12] || 0);
        const totalSeconds = (utimeTicks + stimeTicks) / 100;
        const uptimeRaw = await fs.readFile('/proc/uptime', 'utf-8');
        const systemUptimeSec = Number(uptimeRaw.trim().split(/\s+/)[0] || 0);
        const startTimeTicks = Number(fields[19] || 0);
        const procElapsedSec = Math.max(
          1,
          systemUptimeSec - startTimeTicks / 100
        );
        cpuPercent = Math.min(
          100,
          Math.round((totalSeconds / procElapsedSec) * 100 * 10) / 10
        );
      }
    } catch {
      cpuPercent = 0;
    }

    return { memoryBytes, cpuPercent };
  } catch {
    return { memoryBytes: 0, cpuPercent: 0 };
  }
}

async function collectNodeOsResources() {
  const totalMemMb = Math.round(os.totalmem() / 1048576);
  const freeMemMb = Math.round(os.freemem() / 1048576);
  const usedMemMb = Math.max(0, totalMemMb - freeMemMb);
  const loadAvg = os.loadavg()[0] || 0;
  const cpuCount = Math.max(1, os.cpus().length);
  const cpuUsagePercent = Math.min(100, Math.round((loadAvg / cpuCount) * 100));

  let diskUsedMb = 0;
  let diskTotalMb = 102400;
  try {
    await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
    const statfs = await fs.statfs(WORKSPACE_ROOT);
    const totalBytes = Number(statfs.bsize) * Number(statfs.blocks);
    const availBytes = Number(statfs.bsize) * Number(statfs.bavail);
    if (totalBytes > 0) {
      diskTotalMb = Math.max(1024, Math.round(totalBytes / 1048576));
      diskUsedMb = Math.max(0, Math.round((totalBytes - availBytes) / 1048576));
    }
  } catch {
    // Keep safe defaults if statfs is unsupported
  }

  return {
    cpuUsagePercent,
    memoryUsedMb: usedMemMb,
    memoryTotalMb: totalMemMb,
    diskUsedMb,
    diskTotalMb,
    activeContainers: runningProcesses.size,
  };
}

async function stopManagedHostProcess(
  hostId: string,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM',
  timeoutMs = 5_000
): Promise<void> {
  const existing = runningProcesses.get(hostId);
  if (!existing) {
    return;
  }

  existing.stoppingIntentionally = true;
  const proc = existing.proc;

  if (proc.exitCode !== null || proc.killed) {
    runningProcesses.delete(hostId);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      runningProcesses.delete(hostId);
      resolve();
    };

    proc.once('exit', finish);
    proc.once('error', finish);

    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore
      }
      finish();
    }, timeoutMs);

    try {
      proc.kill(signal);
    } catch {
      finish();
    }
  });
}

async function copyDirectoryRecursive(
  srcDir: string,
  destDir: string,
  hash: crypto.Hash
): Promise<number> {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  let totalBytes = 0;

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      totalBytes += await copyDirectoryRecursive(srcPath, destPath, hash);
    } else if (entry.isFile()) {
      const data = await fs.readFile(srcPath);
      await fs.writeFile(destPath, data);
      hash.update(entry.name);
      hash.update(data);
      totalBytes += data.byteLength;
    }
  }
  return totalBytes;
}

export function startStandaloneNodeAgent(): void {
  const controlPlaneWsUrl = (
    process.env.CONTROL_PLANE_WS_URL ||
    process.env.CONTROL_PLANE_URL ||
    ''
  ).trim();
  const nodeId = (process.env.NODE_ID || '').trim();
  const nodeToken = (
    process.env.NODE_TOKEN ||
    process.env.RUNTIME_NODE_SECRET ||
    process.env.NODE_ENROLLMENT_SECRET ||
    ''
  ).trim();
  const nodeFqdn = (process.env.NODE_FQDN || os.hostname() || 'runtime-node.local').trim();
  const nodeLocation = (process.env.NODE_LOCATION || 'External Runtime Node').trim();
  const dedicatedHostId = (process.env.HOST_ID || '').trim();

  if (!controlPlaneWsUrl || !nodeId || !nodeToken) {
    logger.error(
      'Missing required Runtime Node Agent bootstrap configuration (CONTROL_PLANE_WS_URL, NODE_ID, NODE_TOKEN)'
    );
    process.exit(1);
  }

  const wsEndpoint = normalizeControlPlaneWsUrl(controlPlaneWsUrl);
  let shuttingDown = false;
  let activeWs: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const connect = () => {
    if (shuttingDown) return;

    const wsHeaders: Record<string, string> = {
      'x-hyperhost-node-id': nodeId,
      'x-hyperhost-node-fqdn': nodeFqdn,
      'x-hyperhost-node-location': nodeLocation,
      Authorization: `Bearer ${nodeToken}`,
    };
    if (dedicatedHostId) {
      wsHeaders['x-hyperhost-host-id'] = dedicatedHostId;
    }

    const ws = new WebSocket(wsEndpoint, {
      headers: wsHeaders,
    });
    activeWs = ws;

    let heartbeatInterval: NodeJS.Timeout | null = null;
    let handshakeAcked = false;

    const sendJson = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    const sendHelloHandshake = async () => {
      const resources = await collectNodeOsResources();
      sendJson({
        type: 'hello',
        version: '1.0.0',
        dedicatedHostId: dedicatedHostId || undefined,
        supportedRuntimes: ['NODEJS', 'PYTHON', 'JAVA', 'GO', 'RUST'],
        osPlatform: os.platform(),
        architecture: os.arch(),
        resources,
        runningHostIds: Array.from(runningProcesses.keys()),
      });
    };

    ws.on('open', () => {
      logger.info('Runtime Node Agent connected WebSocket to Control Plane', {
        nodeId,
        endpoint: wsEndpoint,
      });

      void sendHelloHandshake();

      heartbeatInterval = setInterval(async () => {
        if (ws.readyState === WebSocket.OPEN) {
          const resources = await collectNodeOsResources();
          sendJson({
            type: 'heartbeat',
            status: 'ONLINE',
            resources,
            runningHostIds: Array.from(runningProcesses.keys()),
          });
        }
      }, 15_000);
    });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          requestId?: string;
          method?: string;
          params?: any;
          code?: string;
          message?: string;
        };

        if (msg.type === 'welcome') {
          if (!handshakeAcked) {
            await sendHelloHandshake();
          }
          return;
        }

        if (msg.type === 'handshake_ack') {
          handshakeAcked = true;
          logger.info('Runtime Node Agent handshake acknowledged (ONLINE)', {
            nodeId,
          });
          return;
        }

        if (msg.type === 'error') {
          logger.error('Control Plane rejected Runtime Node Agent message', {
            nodeId,
            code: msg.code,
            reason: msg.message,
          });
          return;
        }

        if (msg.type !== 'rpc_request' || !msg.requestId || !msg.method) {
          return;
        }

        const replyRpc = (ok: boolean, result?: any, error?: string) => {
          sendJson({
            type: 'rpc_response',
            requestId: msg.requestId,
            ok,
            result,
            error,
          });
        };

        try {
          const p = msg.params || {};

          if (msg.method === 'process.start' || msg.method === 'process.restart') {
            const hostId = String(p.hostId || p.spec?.hostId || '');
            const spec = (p.spec || {}) as Partial<RuntimeExecutionSpec>;

            await stopManagedHostProcess(hostId, 'SIGTERM', 4_000);

            const workDir = await ensureWorkspaceInitialized(hostId, spec);
            const execCwd = spec.workingDirectory
              ? resolveSafeHostPath(hostId, spec.workingDirectory)
              : workDir;
            await fs.mkdir(execCwd, { recursive: true });

            const { binary, args } = parseAndValidateStartupCommand(
              hostId,
              execCwd,
              String(spec.startupCommand || 'node index.js'),
              Array.isArray(spec.startupArgs) ? spec.startupArgs : []
            );

            // Build sanitized environment (never expose Node Agent secrets)
            const sanitizedHostEnv: Record<string, string> = {};
            if (spec.environment && typeof spec.environment === 'object') {
              for (const [k, v] of Object.entries(spec.environment)) {
                if (!FORBIDDEN_ENV_KEYS.has(k.toUpperCase())) {
                  sanitizedHostEnv[k] = String(v);
                }
              }
            }

            const primaryPort = spec.allocations?.find((a) => a.isPrimary)?.port;
            if (primaryPort) {
              sanitizedHostEnv.PORT = String(primaryPort);
              sanitizedHostEnv.SERVER_PORT = String(primaryPort);
            }

            const child = spawn(binary, args, {
              cwd: execCwd,
              shell: false,
              stdio: ['pipe', 'pipe', 'pipe'],
              env: {
                PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                HOME: workDir,
                USERPROFILE: workDir,
                LANG: 'C.UTF-8',
                NODE_ENV: 'production',
                PYTHONUNBUFFERED: '1',
                ...sanitizedHostEnv,
              },
            });

            let recentStderr = '';

            child.stdout.on('data', (chunk) => {
              sendJson({
                type: 'console',
                hostId,
                stream: 'stdout',
                data: chunk.toString(),
                timestamp: new Date().toISOString(),
              });
            });

            child.stderr.on('data', (chunk) => {
              const text = chunk.toString();
              recentStderr = (recentStderr + text).slice(-500);
              sendJson({
                type: 'console',
                hostId,
                stream: 'stderr',
                data: text,
                timestamp: new Date().toISOString(),
              });
            });

            // Wait for real OS process spawn + brief stabilization check
            await new Promise<void>((resolve, reject) => {
              let spawned = false;
              let settled = false;
              let stabilizeTimer: NodeJS.Timeout | null = null;

              const onError = (err: Error) => {
                if (stabilizeTimer) clearTimeout(stabilizeTimer);
                runningProcesses.delete(hostId);
                sendJson({
                  type: 'console',
                  hostId,
                  stream: 'stderr',
                  data: `[HyperHost Node] Failed to spawn process "${binary}": ${err.message}\n`,
                  timestamp: new Date().toISOString(),
                });
                sendJson({
                  type: 'host_status',
                  hostId,
                  status: 'ERROR',
                });
                if (!settled) {
                  settled = true;
                  reject(
                    new Error(`Failed to spawn "${binary}": ${err.message}`)
                  );
                }
              };

              const onEarlyExit = (
                code: number | null,
                signal: NodeJS.Signals | null
              ) => {
                if (stabilizeTimer) clearTimeout(stabilizeTimer);
                const managed = runningProcesses.get(hostId);
                runningProcesses.delete(hostId);
                const intentional = Boolean(managed?.stoppingIntentionally);
                const exitStatus =
                  intentional || code === 0 ? 'STOPPED' : 'ERROR';

                sendJson({
                  type: 'console',
                  hostId,
                  stream: 'system',
                  data: `[HyperHost Node] Process exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})\n`,
                  timestamp: new Date().toISOString(),
                });
                sendJson({
                  type: 'host_status',
                  hostId,
                  status: exitStatus,
                });

                if (!settled) {
                  settled = true;
                  if (exitStatus === 'ERROR') {
                    const detail = recentStderr.trim()
                      ? `: ${recentStderr.trim().split('\n')[0]}`
                      : '';
                    reject(
                      new Error(
                        `Process exited immediately with code ${code ?? 1}${detail}`
                      )
                    );
                  } else {
                    resolve();
                  }
                }
              };

              child.once('error', onError);
              child.once('exit', onEarlyExit);

              child.once('spawn', () => {
                spawned = true;
                runningProcesses.set(hostId, {
                  hostId,
                  proc: child,
                  startedAt: Date.now(),
                  memoryLimitMb: Number(spec.resources?.memoryLimitMb || 512),
                  diskLimitMb: Number(spec.resources?.diskLimitMb || 2048),
                  cpuLimitPercent: Number(spec.resources?.cpuLimitPercent || 100),
                });

                stabilizeTimer = setTimeout(() => {
                  if (settled) return;
                  settled = true;
                  sendJson({
                    type: 'console',
                    hostId,
                    stream: 'system',
                    data: `[HyperHost Node] Process started and running (PID ${child.pid})\n`,
                    timestamp: new Date().toISOString(),
                  });
                  sendJson({
                    type: 'host_status',
                    hostId,
                    status: 'RUNNING',
                  });
                  resolve();
                }, 200);
              });

              if (!spawned && child.exitCode !== null) {
                onEarlyExit(child.exitCode, null);
              }
            });

            const activeProc = runningProcesses.get(hostId);
            replyRpc(true, {
              started: true,
              status: activeProc ? 'RUNNING' : 'STOPPED',
              pid: activeProc?.proc.pid ?? null,
            });
            return;
          }

          if (msg.method === 'process.stop' || msg.method === 'process.kill') {
            const hostId = String(p.hostId);
            const sig = msg.method === 'process.kill' ? 'SIGKILL' : 'SIGTERM';
            await stopManagedHostProcess(hostId, sig, 5_000);
            sendJson({
              type: 'host_status',
              hostId,
              status: 'STOPPED',
            });
            replyRpc(true, { stopped: true, status: 'STOPPED' });
            return;
          }

          if (msg.method === 'process.stdin') {
            const hostId = String(p.hostId);
            const existing = runningProcesses.get(hostId);
            if (!existing || existing.proc.exitCode !== null) {
              replyRpc(false, undefined, 'Host process is not running.');
              return;
            }
            const cmdLine = String(p.commandLine || '');
            existing.proc.stdin.write(cmdLine + '\n');
            replyRpc(true, { written: true });
            return;
          }

          if (msg.method === 'files.list') {
            const dir = resolveSafeHostPath(String(p.hostId), String(p.path || '/'));
            await fs.mkdir(dir, { recursive: true });
            const dirents = await fs.readdir(dir, { withFileTypes: true });
            const entries = await Promise.all(
              dirents.map(async (d) => {
                const full = path.join(dir, d.name);
                const st = await fs.stat(full);
                return {
                  name: d.name,
                  path: path.posix.join(String(p.path || '/'), d.name),
                  isDirectory: d.isDirectory(),
                  sizeBytes: st.size,
                  modifiedAt: st.mtime.toISOString(),
                  permissions: d.isDirectory() ? 'drwxr-xr-x' : '-rw-r--r--',
                };
              })
            );
            replyRpc(true, entries);
            return;
          }

          if (msg.method === 'files.read') {
            const file = resolveSafeHostPath(String(p.hostId), String(p.path));
            const content = await fs.readFile(file, 'utf-8');
            replyRpc(true, { content });
            return;
          }

          if (msg.method === 'files.write') {
            const file = resolveSafeHostPath(String(p.hostId), String(p.path));
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, String(p.content ?? ''), 'utf-8');
            replyRpc(true, { written: true });
            return;
          }

          if (msg.method === 'files.mkdir') {
            const dir = resolveSafeHostPath(String(p.hostId), String(p.path));
            await fs.mkdir(dir, { recursive: true });
            replyRpc(true, { created: true });
            return;
          }

          if (msg.method === 'files.rename' || msg.method === 'files.move') {
            const source = resolveSafeHostPath(
              String(p.hostId),
              String(p.sourcePath)
            );
            const target = resolveSafeHostPath(
              String(p.hostId),
              String(p.targetPath)
            );
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.rename(source, target);
            replyRpc(true, { moved: true });
            return;
          }

          if (msg.method === 'files.delete') {
            const target = resolveSafeHostPath(String(p.hostId), String(p.path));
            const rootDir = resolveSafeHostPath(String(p.hostId), '/');
            if (target === rootDir) {
              throw new Error('Cannot delete the root workspace directory');
            }
            await fs.rm(target, { recursive: true, force: true });
            replyRpc(true, { deleted: true });
            return;
          }

          if (
            msg.method === 'container.create' ||
            msg.method === 'container.reinstall'
          ) {
            const hostId = String(p.spec?.hostId || p.hostId);
            await stopManagedHostProcess(hostId, 'SIGTERM', 4_000);
            const workDir = resolveSafeHostPath(hostId, '/');
            if (msg.method === 'container.reinstall') {
              await fs.rm(workDir, { recursive: true, force: true });
            }
            await ensureWorkspaceInitialized(hostId, p.spec);
            sendJson({
              type: 'host_status',
              hostId,
              status: 'STOPPED',
            });
            replyRpc(true, { containerId: `ws_${hostId}` });
            return;
          }

          if (msg.method === 'container.remove') {
            const hostId = String(p.hostId);
            await stopManagedHostProcess(hostId, 'SIGKILL', 2_000);
            const workDir = resolveSafeHostPath(hostId, '/');
            await fs.rm(workDir, { recursive: true, force: true });
            replyRpc(true, { removed: true });
            return;
          }

          if (msg.method === 'container.inspect') {
            const hostId = String(p.hostId);
            const proc = runningProcesses.get(hostId);
            const isRunning = Boolean(proc && proc.proc.exitCode === null);
            replyRpc(true, {
              status: isRunning ? 'RUNNING' : 'STOPPED',
              running: isRunning,
              exitCode: proc ? proc.proc.exitCode : null,
            });
            return;
          }

          if (msg.method === 'metrics.node') {
            const telemetry = await collectNodeOsResources();
            replyRpc(true, telemetry);
            return;
          }

          if (msg.method === 'metrics.host') {
            const hostId = String(p.hostId);
            const managed = runningProcesses.get(hostId);
            const isRunning = Boolean(managed && managed.proc.exitCode === null);
            const workDir = resolveSafeHostPath(hostId, '/');
            const [diskBytes, procUsage] = await Promise.all([
              calculateDirectorySizeBytes(workDir),
              isRunning
                ? collectProcessResourceUsage(managed?.proc.pid)
                : Promise.resolve({ memoryBytes: 0, cpuPercent: 0 }),
            ]);

            const memLimitMb = managed?.memoryLimitMb || 512;
            const diskLimitMb = managed?.diskLimitMb || 2048;

            replyRpc(true, {
              hostId,
              cpuPercent: procUsage.cpuPercent,
              memoryBytes: procUsage.memoryBytes,
              memoryLimitBytes: memLimitMb * 1048576,
              diskBytes,
              diskLimitBytes: diskLimitMb * 1048576,
              networkRxBytes: 0,
              networkTxBytes: 0,
              uptimeSeconds:
                isRunning && managed
                  ? Math.max(1, Math.floor((Date.now() - managed.startedAt) / 1000))
                  : 0,
              state: isRunning ? 'RUNNING' : 'STOPPED',
              collectedAt: new Date().toISOString(),
            });
            return;
          }

          if (msg.method === 'backup.create') {
            const hostId = getCleanHostId(String(p.hostId));
            const backupId = getCleanHostId(String(p.backupId));
            const workDir = resolveSafeHostPath(hostId, '/');
            await fs.mkdir(workDir, { recursive: true });
            const backupDir = path.resolve(
              WORKSPACE_ROOT,
              '_backups',
              hostId,
              backupId
            );
            const sha = crypto.createHash('sha256');
            const sizeBytes = await copyDirectoryRecursive(workDir, backupDir, sha);
            replyRpc(true, {
              storageKey: `${hostId}/${backupId}`,
              sizeBytes: String(sizeBytes),
              checksumSha256: sha.digest('hex'),
            });
            return;
          }

          if (msg.method === 'backup.restore') {
            const hostId = getCleanHostId(String(p.hostId));
            const backupId = getCleanHostId(String(p.backupId));
            const backupDir = path.resolve(
              WORKSPACE_ROOT,
              '_backups',
              hostId,
              backupId
            );
            const workDir = resolveSafeHostPath(hostId, '/');
            await stopManagedHostProcess(hostId, 'SIGTERM', 4_000);
            await fs.rm(workDir, { recursive: true, force: true });
            const sha = crypto.createHash('sha256');
            await copyDirectoryRecursive(backupDir, workDir, sha);
            replyRpc(true, { restored: true });
            return;
          }

          if (msg.method === 'backup.delete') {
            const rawKey = String(p.storageKey || '');
            const [rawHostId, rawBackupId] = rawKey.split('/');
            if (rawHostId && rawBackupId) {
              const backupDir = path.resolve(
                WORKSPACE_ROOT,
                '_backups',
                getCleanHostId(rawHostId),
                getCleanHostId(rawBackupId)
              );
              await fs.rm(backupDir, { recursive: true, force: true });
            }
            replyRpc(true, { deleted: true });
            return;
          }

          replyRpc(false, undefined, `Unsupported RPC method: ${msg.method}`);
        } catch (err) {
          replyRpc(
            false,
            undefined,
            err instanceof Error ? err.message : 'Node execution error'
          );
        }
      } catch {
        // Ignore malformed frame
      }
    });

    ws.on('close', (code, reasonBuf) => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (shuttingDown) return;
      const reason = reasonBuf?.toString() || 'closed';
      logger.warn('Runtime Node Agent WebSocket disconnected; reconnecting in 5s', {
        nodeId,
        code,
        reason,
      });
      reconnectTimer = setTimeout(connect, 5_000);
    });

    ws.on('error', (err) => {
      logger.warn('Runtime Node Agent WebSocket connection error', {
        nodeId,
        error: err.message,
      });
    });
  };

  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    logger.info('Shutting down Runtime Node Agent and stopping managed Host processes...', {
      nodeId,
      activeProcesses: runningProcesses.size,
    });
    for (const hostId of Array.from(runningProcesses.keys())) {
      await stopManagedHostProcess(hostId, 'SIGTERM', 3_000);
    }
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      activeWs.close(1000, 'NODE_SHUTDOWN');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void gracefulShutdown());
  process.on('SIGTERM', () => void gracefulShutdown());

  connect();
}

const invokedScript = process.argv[1] || '';
if (
  invokedScript.endsWith('node-agent.ts') ||
  invokedScript.endsWith('node-agent.js')
) {
  startStandaloneNodeAgent();
}
