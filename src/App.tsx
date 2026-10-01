import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Server,
  Shield,
  Plus,
  LogOut,
  Menu,
  X,
  Activity,
  Cpu,
  HardDrive,
  Terminal,
} from 'lucide-react';
import {
  MAX_HOSTS_PER_USER,
  type AuthenticatedUserDTO,
  type HealthReportDTO,
  type HostSummaryDTO,
} from './shared/types';
import { apiFetch } from './client/api';
import { LogoMark } from './client/LogoMark';
import { LoginView } from './client/LoginView';
import { CreateHostModal } from './client/CreateHostModal';
import { HostPanelView } from './client/HostPanelView';
import { AdminControlPlaneView } from './client/AdminControlPlaneView';

type WorkspaceSection = 'dashboard' | 'host-panel' | 'admin';

export default function App() {
  const [health, setHealth] = useState<HealthReportDTO | null>(null);
  const [user, setUser] = useState<AuthenticatedUserDTO | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [inspectorMode, setInspectorMode] = useState<boolean>(false);
  const [initializing, setInitializing] = useState<boolean>(true);

  const [section, setSection] = useState<WorkspaceSection>('dashboard');
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);

  // Dashboard Real Data State (Strictly from API — never hardcoded fake arrays)
  const [hosts, setHosts] = useState<HostSummaryDTO[]>([]);
  const [availableNodes, setAvailableNodes] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  useEffect(() => {
    void bootstrapApp();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        void bootstrapApp();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  async function bootstrapApp() {
    setInitializing(true);
    try {
      const [healthRes, authRes] = await Promise.all([
        apiFetch<HealthReportDTO>('/api/health').catch(() => null),
        apiFetch<{
          authenticated: boolean;
          user: AuthenticatedUserDTO | null;
        }>('/api/auth/me').catch(() => null),
      ]);

      if (healthRes) setHealth(healthRes);

      if (authRes?.authenticated && authRes.user) {
        setAuthenticated(true);
        setUser(authRes.user);
        setInspectorMode(false);
        await loadHostsDashboard();
      } else {
        setAuthenticated(false);
        setUser(null);
      }
    } finally {
      setInitializing(false);
    }
  }

  async function loadHostsDashboard() {
    try {
      const data = await apiFetch<{
        hosts: HostSummaryDTO[];
        availableNodes: any[];
        recentActivity: any[];
      }>('/api/hosts');
      setHosts(data.hosts);
      setAvailableNodes(data.availableNodes);
      setRecentActivity(data.recentActivity);
    } catch {
      setHosts([]);
      setAvailableNodes([]);
      setRecentActivity([]);
    }
  }

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    setAuthenticated(false);
    setInspectorMode(false);
    setUser(null);
    setHosts([]);
  }

  if (initializing) {
    return (
      <div className="min-h-screen bg-[#090A10] text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <img
            src="/assets/Logo.png"
            alt="HyperHost"
            referrerPolicy="no-referrer"
            className="w-8 h-8 object-contain animate-pulse"
          />
          <span>Initializing HyperHost Control Plane...</span>
        </div>
      </div>
    );
  }

  if (!authenticated && !inspectorMode) {
    return (
      <LoginView
        health={health}
        onRefreshAuth={() => void bootstrapApp()}
        onOpenInspector={() => {
          setInspectorMode(true);
          setSection('dashboard');
        }}
      />
    );
  }

  const totalHostsCount = hosts.length;
  const onlineHostsCount = hosts.filter((h) => h.status === 'ONLINE' && h.nodeOnline).length;
  const offlineHostsCount = totalHostsCount - onlineHostsCount;
  const totalAllocatedMemoryMb = hosts.reduce((acc, h) => acc + h.memoryLimitMb, 0);
  const totalAllocatedStorageMb = hosts.reduce((acc, h) => acc + h.diskLimitMb, 0);

  return (
    <div className="min-h-screen bg-[#090A10] text-slate-100 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#0D0F18] border-r border-slate-800/90 justify-between shrink-0">
        <div className="p-5 space-y-6">
          <LogoMark size="md" />

          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => setSection('dashboard')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                section === 'dashboard'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Dashboard & Hosts</span>
            </button>

            <button
              type="button"
              onClick={() => setSection('host-panel')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                section === 'host-panel'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Terminal className="w-4 h-4" />
              <span>Host Control Panel</span>
            </button>

            <button
              type="button"
              onClick={() => setSection('admin')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                section === 'admin'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Control Plane Admin</span>
            </button>
          </nav>
        </div>

        {/* User / Quota Footer */}
        <div className="p-4 border-t border-slate-800/90 space-y-3">
          <div className="p-3 rounded-xl bg-[#11131F] border border-slate-800 text-xs space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span>Account Quota</span>
              <span className="font-mono tabular-nums text-white">
                {totalHostsCount} / {MAX_HOSTS_PER_USER} Hosts
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500"
                style={{
                  width: `${Math.min(100, (totalHostsCount / MAX_HOSTS_PER_USER) * 100)}%`,
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between px-1">
            <div className="truncate">
              <div className="text-xs font-semibold text-white truncate">
                {user ? user.displayName : 'Unauthenticated Inspector'}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {user ? `@${user.username}` : 'Read-Only Preview'}
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign Out"
              className="p-2 rounded-lg text-slate-400 hover:text-white bg-slate-900 border border-slate-800 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Top Navbar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0D0F18] border-b border-slate-800">
        <LogoMark size="sm" />
        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="lg:hidden bg-[#0D0F18] border-b border-slate-800 px-4 py-3 space-y-2">
          <button
            type="button"
            onClick={() => {
              setSection('dashboard');
              setMobileMenuOpen(false);
            }}
            className="block w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Dashboard & Hosts
          </button>
          <button
            type="button"
            onClick={() => {
              setSection('host-panel');
              setMobileMenuOpen(false);
            }}
            className="block w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Host Control Panel
          </button>
          <button
            type="button"
            onClick={() => {
              setSection('admin');
              setMobileMenuOpen(false);
            }}
            className="block w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Control Plane Admin
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-red-400 hover:bg-slate-800"
          >
            Exit to Login
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="hidden lg:flex items-center justify-between px-8 py-4 border-b border-slate-800/80 bg-[#090A10]">
          <div className="text-xs text-slate-400">
            <span>HyperHost Control Plane</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>
              Runtime Nodes Connected:{' '}
              <strong className="font-mono text-white">
                {health?.runtime.connectedNodes ?? 0}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              disabled={totalHostsCount >= MAX_HOSTS_PER_USER}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Host ({totalHostsCount}/{MAX_HOSTS_PER_USER})</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-8">
          {section === 'dashboard' && (
            <>
              {/* Welcome Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-white">
                    Welcome, {user ? user.displayName : 'Operator'}
                  </h1>
                  <p className="text-xs text-slate-400 mt-1">
                    Manage your Discord & Telegram Bot Hosts, monitor Runtime Node connectivity, and configure startup environments.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(true)}
                  disabled={totalHostsCount >= MAX_HOSTS_PER_USER}
                  className="lg:hidden px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg inline-flex items-center gap-1.5 self-start cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Host</span>
                </button>
              </div>

              {/* 24. DASHBOARD METRICS GRID */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400">Total Hosts</div>
                  <div className="text-xl font-bold text-white font-mono tabular-nums mt-1">
                    {totalHostsCount} / {MAX_HOSTS_PER_USER}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400">Online Hosts</div>
                  <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums mt-1">
                    {onlineHostsCount}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400">Offline / Pending</div>
                  <div className="text-xl font-bold text-amber-400 font-mono tabular-nums mt-1">
                    {offlineHostsCount}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                    <span>CPU Usage</span>
                  </div>
                  <div className="text-sm font-mono text-slate-300 mt-1.5">
                    {health?.runtime.connectedNodes
                      ? '0.0%'
                      : 'No metrics available'}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Memory Quota</span>
                  </div>
                  <div className="text-sm font-mono tabular-nums text-slate-200 mt-1.5">
                    {totalAllocatedMemoryMb} MB
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Storage Quota</span>
                  </div>
                  <div className="text-sm font-mono tabular-nums text-slate-200 mt-1.5">
                    {totalAllocatedStorageMb} MB
                  </div>
                </div>
              </div>

              {/* My Hosts Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">My Hosts</h2>
                  <span className="text-xs text-slate-400 font-mono tabular-nums">
                    {totalHostsCount} of {MAX_HOSTS_PER_USER} used
                  </span>
                </div>

                {hosts.length === 0 ? (
                  <div className="p-10 rounded-2xl bg-[#11131F] border border-slate-800 text-center space-y-4">
                    <Server className="w-8 h-8 text-indigo-400 mx-auto" />
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-white">
                        No Hosts Provisioned Yet
                      </div>
                      <p className="text-xs text-slate-400 max-w-md mx-auto">
                        Create your first Discord Bot, Telegram Bot, Node.js, Python, Java, Go, or Rust Host, or open the Host Panel to inspect Console, Startup, Network, and Permissions.
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => setCreateModalOpen(true)}
                        className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
                      >
                        Create Host
                      </button>
                      <button
                        type="button"
                        onClick={() => setSection('host-panel')}
                        className="px-4 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg cursor-pointer"
                      >
                        Open Host Panel Workspace
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {hosts.map((host) => {
                      const isOnline = host.status === 'ONLINE' && host.nodeOnline;
                      return (
                        <div
                          key={host.id}
                          className="p-5 rounded-2xl bg-[#11131F] border border-slate-800 hover:border-indigo-500/40 transition-colors flex flex-col justify-between space-y-5"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h3 className="text-base font-bold text-white truncate">
                                {host.name}
                              </h3>
                              <span
                                className={`text-xs font-medium ${
                                  isOnline
                                    ? 'text-emerald-400'
                                    : host.status === 'PENDING'
                                    ? 'text-amber-400'
                                    : 'text-slate-400'
                                }`}
                              >
                                ● {isOnline ? 'Online' : host.status}
                              </span>
                            </div>

                            <div className="text-xs text-slate-400">
                              <span>{host.runtime} {host.runtimeVersion}</span>
                              <span className="mx-1.5" aria-hidden="true">·</span>
                              <span>{host.type.replace('_', ' ')}</span>
                            </div>

                            <div className="pt-2 text-xs font-mono tabular-nums text-slate-300 space-y-1">
                              <div>
                                CPU Limit: {host.cpuLimitPercent}% · RAM Limit: {host.memoryLimitMb} MB
                              </div>
                              <div className="text-slate-500">
                                {host.nodeOnline
                                  ? `Node: ${host.nodeName}`
                                  : 'Runtime node unavailable'}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedHostId(host.id);
                              setSection('host-panel');
                            }}
                            className="w-full py-2 px-4 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors cursor-pointer"
                          >
                            Manage
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Activity */}
              <div className="space-y-3">
                <h2 className="text-base font-bold text-white">Recent Activity</h2>
                {recentActivity.length === 0 ? (
                  <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 text-xs text-slate-400 text-center">
                    No recent activity recorded in PostgreSQL.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentActivity.map((act) => (
                      <div
                        key={act.id}
                        className="p-3.5 rounded-xl bg-[#11131F] border border-slate-800 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-semibold text-white">{act.action}</span>
                          {act.hostName && (
                            <>
                              <span className="mx-2 text-slate-500">·</span>
                              <span className="text-indigo-300">{act.hostName}</span>
                            </>
                          )}
                        </div>
                        <span className="font-mono text-slate-500 tabular-nums">
                          {act.createdAt}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {section === 'host-panel' && (
            <HostPanelView
              hostId={selectedHostId}
              inspectorMode={inspectorMode}
              onBack={() => setSection('dashboard')}
              onHostDeleted={() => {
                setSelectedHostId(null);
                setSection('dashboard');
                void loadHostsDashboard();
              }}
            />
          )}

          {section === 'admin' && <AdminControlPlaneView />}
        </main>
      </div>

      <CreateHostModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={(newHostId) => {
          void loadHostsDashboard();
          setSelectedHostId(newHostId);
          setSection('host-panel');
        }}
        currentHostCount={totalHostsCount}
        availableNodes={availableNodes}
      />
    </div>
  );
}
