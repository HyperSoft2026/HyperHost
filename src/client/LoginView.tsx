import React, { useState } from 'react';
import { ShieldCheck, ExternalLink, Server, Database, Lock, AlertCircle, Layers } from 'lucide-react';
import { LogoMark } from './LogoMark';
import { apiFetch, ClientApiError } from './api';
import type { HealthReportDTO } from '../shared/types';

interface LoginViewProps {
  health: HealthReportDTO | null;
  onRefreshAuth: () => void;
  onOpenInspector: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  health,
  onRefreshAuth,
  onOpenInspector,
}) => {
  const [authError, setAuthError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const handleDiscordLogin = async () => {
    setAuthError(null);
    setConnecting(true);
    try {
      const origin = window.location.origin;
      const data = await apiFetch<{ url: string; redirectUri: string }>(
        `/api/auth/url?origin=${encodeURIComponent(origin)}`
      );

      const popup = window.open(
        data.url,
        'hyperhost_discord_oauth',
        'width=580,height=720'
      );

      if (!popup) {
        window.location.href = data.url;
      }
    } catch (err) {
      if (err instanceof ClientApiError) {
        setAuthError(`[${err.code}] ${err.message}`);
      } else {
        setAuthError('Unable to initiate Discord OAuth2 flow.');
      }
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090A10] text-slate-100 flex flex-col justify-between">
      {/* Top Bar */}
      <header className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between max-w-7xl w-full mx-auto">
        <LogoMark size="md" />
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span>Control Plane API: {health?.api === 'online' ? 'Online' : 'Checking'}</span>
          <span aria-hidden="true">·</span>
          <span>Max Quota: {health?.limits.maxHostsPerUser ?? 10} Hosts / User</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Platform Identity & Architecture */}
          <div className="lg:col-span-7 space-y-6">
            <div className="text-xs font-medium text-indigo-400">
              <span>HyperSoft Cloud Infrastructure</span>
              <span className="mx-2" aria-hidden="true">·</span>
              <span>Control Plane & Runtime Plane Separation</span>
            </div>

            <h1
              className="text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Professional Discord & Telegram Bot Hosting Platform
            </h1>

            <p className="text-sm text-slate-400 leading-relaxed max-w-xl">
              Deploy and manage isolated application Hosts for Discord bots, Telegram bots, Node.js, Python, Java, Go, and Rust workloads with granular permissions, encrypted environment vaults, and real-time WebSocket console streams.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800/90 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Server className="w-4 h-4 text-indigo-400" />
                  <span>Isolated Runtime Plane</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Strict separation between the Fastify Control Plane and remote Runtime Nodes managing containers, CPU/RAM/Disk quotas, and network allocations.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800/90 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Lock className="w-4 h-4 text-indigo-400" />
                  <span>Zero-Trust Security</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Discord OAuth2 identity, AES-256-GCM encrypted secrets, 21 granular collaborator permission scopes, and full audit logging.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Discord OAuth2 Authentication Card */}
          <div className="lg:col-span-5">
            <div className="p-6 sm:p-8 rounded-2xl bg-[#11131F] border border-slate-800 space-y-6">
              <div className="flex items-center gap-3.5">
                <img
                  src="/assets/Logo.png"
                  alt="HyperHost"
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-xl bg-[#171A2B] border border-indigo-500/30 p-1.5 object-contain"
                />
                <div>
                  <h2 className="text-lg font-bold text-white">Sign in to HyperHost</h2>
                  <p className="text-xs text-slate-400">
                    Authenticate with your Discord account
                  </p>
                </div>
              </div>

              {authError && (
                <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold">Authentication Unavailable</div>
                    <div className="text-red-300/90 leading-relaxed">{authError}</div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleDiscordLogin}
                  disabled={connecting}
                  className="w-full py-3 px-4 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>{connecting ? 'Connecting to Discord...' : 'Continue with Discord OAuth2'}</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenInspector}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Inspect Control Plane & Host Panel UI</span>
                </button>
              </div>

              {/* Real Infrastructure Diagnostics */}
              <div className="pt-4 border-t border-slate-800/80 space-y-2.5 text-xs">
                <div className="font-semibold text-slate-300 flex items-center justify-between">
                  <span>Control Plane Telemetry</span>
                  <button
                    type="button"
                    onClick={onRefreshAuth}
                    className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                  >
                    Refresh
                  </button>
                </div>

                <div className="space-y-1.5 font-mono text-[11px]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      Fastify API Server
                    </span>
                    <span className="text-emerald-400">ONLINE</span>
                  </div>

                  <div className="flex items-center justify-between text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-indigo-400" />
                      PostgreSQL (Prisma)
                    </span>
                    <span
                      className={
                        health?.database.connected
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }
                    >
                      {health?.database.connected
                        ? `CONNECTED (${health.database.latencyMs}ms)`
                        : 'AWAITING DATABASE_URL'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-400">
                    <span>Discord OAuth2 Env</span>
                    <span
                      className={
                        health?.auth.discordOAuthConfigured
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }
                    >
                      {health?.auth.discordOAuthConfigured
                        ? 'CONFIGURED'
                        : 'AWAITING CREDENTIALS'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-400">
                    <span>Connected Runtime Nodes</span>
                    <span className="text-slate-200 tabular-nums">
                      {health?.runtime.connectedNodes ?? 0} / {health?.runtime.totalRegisteredNodes ?? 0}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="px-6 py-5 border-t border-slate-800/80 text-xs text-slate-500 max-w-7xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>HyperHost Control Plane — Powered by HyperSoft</div>
        <div>Fastify · Prisma · PostgreSQL · WebSocket · Discord OAuth2</div>
      </footer>
    </div>
  );
};
