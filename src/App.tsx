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
  CheckCircle2,
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
import { LanguageSwitcher, useI18n } from './client/i18n';

type WorkspaceSection = 'dashboard' | 'host-panel' | 'admin';

export default function App() {
  const { t } = useI18n();
  const [health, setHealth] = useState<HealthReportDTO | null>(null);
  const [user, setUser] = useState<AuthenticatedUserDTO | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [initializing, setInitializing] = useState<boolean>(true);
  const [showDiscordLoginBanner, setShowDiscordLoginBanner] =
    useState<boolean>(false);

  const [section, setSection] = useState<WorkspaceSection>('dashboard');
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);

  const [hosts, setHosts] = useState<HostSummaryDTO[]>([]);
  const [availableNodes, setAvailableNodes] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('login') === 'discord_success') {
      setShowDiscordLoginBanner(true);
      params.delete('login');
      const cleanSearch = params.toString();
      const nextUrl = `${window.location.pathname}${
        cleanSearch ? `?${cleanSearch}` : ''
      }${window.location.hash}`;
      window.history.replaceState({}, '', nextUrl);
    }

    void bootstrapApp();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setShowDiscordLoginBanner(true);
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
      if (data.hosts.length > 0 && !selectedHostId) {
        setSelectedHostId(data.hosts[0].id);
      }
    } catch {
      setHosts([]);
      setAvailableNodes([]);
      setRecentActivity([]);
    }
  }

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    setAuthenticated(false);
    setUser(null);
    setHosts([]);
    setSelectedHostId(null);
    setShowDiscordLoginBanner(false);
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
          <span>{t.initializing}</span>
        </div>
      </div>
    );
  }

  if (!authenticated || !user) {
    return (
      <LoginView
        health={health}
        onRefreshAuth={() => void bootstrapApp()}
      />
    );
  }

  const totalHostsCount = hosts.length;
  const onlineHostsCount = hosts.filter(
    (h) => h.status === 'ONLINE' && h.nodeOnline
  ).length;
  const offlineHostsCount = totalHostsCount - onlineHostsCount;
  const totalAllocatedMemoryMb = hosts.reduce(
    (acc, h) => acc + h.memoryLimitMb,
    0
  );
  const totalAllocatedStorageMb = hosts.reduce(
    (acc, h) => acc + h.diskLimitMb,
    0
  );

  return (
    <div className="min-h-screen bg-[#090A10] text-slate-100 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#0D0F18] border-e border-slate-800/90 justify-between shrink-0">
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
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span>{t.navDashboard}</span>
            </button>

            {selectedHostId && (
              <button
                type="button"
                onClick={() => setSection('host-panel')}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                  section === 'host-panel'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Terminal className="w-4 h-4 shrink-0" />
                <span>{t.navHostPanel}</span>
              </button>
            )}

            {user.role === 'ADMIN' && (
              <button
                type="button"
                onClick={() => setSection('admin')}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                  section === 'admin'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Shield className="w-4 h-4 shrink-0" />
                <span>{t.navAdmin}</span>
              </button>
            )}
          </nav>
        </div>

        {/* User / Quota Footer */}
        <div className="p-4 border-t border-slate-800/90 space-y-3">
          <div className="p-3 rounded-xl bg-[#11131F] border border-slate-800 text-xs space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span>{t.accountQuota}</span>
              <span className="font-mono tabular-nums text-white" dir="ltr">
                {totalHostsCount} / {MAX_HOSTS_PER_USER} {t.hostsWord}
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500"
                style={{
                  width: `${Math.min(
                    100,
                    (totalHostsCount / MAX_HOSTS_PER_USER) * 100
                  )}%`,
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between px-1 gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.displayName}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full border border-slate-700 object-cover shrink-0"
                />
              ) : null}
              <div className="truncate">
                <div className="text-xs font-semibold text-white truncate">
                  {user.displayName}
                </div>
                <div className="text-[11px] text-slate-400 truncate" dir="ltr">
                  @{user.username}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title={t.signOut}
              className="p-2 rounded-lg text-slate-400 hover:text-white bg-slate-900 border border-slate-800 cursor-pointer shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Top Navbar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0D0F18] border-b border-slate-800">
        <LogoMark size="sm" />
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="lg:hidden bg-[#0D0F18] border-b border-slate-800 px-4 py-3 space-y-2">
          <button
            type="button"
            onClick={() => {
              setSection('dashboard');
              setMobileMenuOpen(false);
            }}
            className="block w-full text-start px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            {t.navDashboard}
          </button>
          {selectedHostId && (
            <button
              type="button"
              onClick={() => {
                setSection('host-panel');
                setMobileMenuOpen(false);
              }}
              className="block w-full text-start px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              {t.navHostPanel}
            </button>
          )}
          {user.role === 'ADMIN' && (
            <button
              type="button"
              onClick={() => {
                setSection('admin');
                setMobileMenuOpen(false);
              }}
              className="block w-full text-start px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              {t.navAdmin}
            </button>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full text-start px-3 py-2 rounded-lg text-xs font-medium text-red-400 hover:bg-slate-800"
          >
            {t.signOut}
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="hidden lg:flex items-center justify-between px-8 py-4 border-b border-slate-800/80 bg-[#090A10]">
          <div className="text-xs text-slate-400">
            <span>{t.controlPlaneHeader}</span>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            <span>
              {t.runtimeNodesConnected}:{' '}
              <strong className="font-mono text-white">
                {health?.runtime.connectedNodes ?? 0}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              disabled={totalHostsCount >= MAX_HOSTS_PER_USER}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>
                {t.createHost} ({totalHostsCount}/{MAX_HOSTS_PER_USER})
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-8">
          {/* In-App Discord Login Notification Banner */}
          {showDiscordLoginBanner && (
            <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
                <div className="text-xs space-y-0.5">
                  <div className="font-bold text-white">
                    {t.discordLoginSuccessTitle} — {user.displayName} (@{user.username})
                  </div>
                  <div className="text-slate-300">
                    {t.discordLoginSuccessDesc}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDiscordLoginBanner(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-900/80 border border-slate-700 rounded-lg self-end sm:self-center cursor-pointer"
              >
                {t.dismiss}
              </button>
            </div>
          )}

          {section === 'dashboard' && (
            <>
              {/* Welcome Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-white">
                    {t.welcomeUser} {user.displayName}
                  </h1>
                  <p className="text-xs text-slate-400 mt-1">
                    {t.dashboardSubtitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(true)}
                  disabled={totalHostsCount >= MAX_HOSTS_PER_USER}
                  className="lg:hidden px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg inline-flex items-center gap-1.5 self-start cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t.createHost}</span>
                </button>
              </div>

              {/* 24. DASHBOARD METRICS GRID */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400">{t.totalHosts}</div>
                  <div
                    className="text-xl font-bold text-white font-mono tabular-nums mt-1"
                    dir="ltr"
                  >
                    {totalHostsCount} / {MAX_HOSTS_PER_USER}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400">{t.onlineHosts}</div>
                  <div
                    className="text-xl font-bold text-emerald-400 font-mono tabular-nums mt-1"
                    dir="ltr"
                  >
                    {onlineHostsCount}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400">{t.offlinePending}</div>
                  <div
                    className="text-xl font-bold text-amber-400 font-mono tabular-nums mt-1"
                    dir="ltr"
                  >
                    {offlineHostsCount}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>{t.cpuUsage}</span>
                  </div>
                  <div className="text-sm font-mono text-slate-300 mt-1.5">
                    {health?.runtime.connectedNodes
                      ? '0.0%'
                      : t.noMetricsAvailable}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>{t.memoryQuota}</span>
                  </div>
                  <div
                    className="text-sm font-mono tabular-nums text-slate-200 mt-1.5"
                    dir="ltr"
                  >
                    {totalAllocatedMemoryMb} MB
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>{t.storageQuota}</span>
                  </div>
                  <div
                    className="text-sm font-mono tabular-nums text-slate-200 mt-1.5"
                    dir="ltr"
                  >
                    {totalAllocatedStorageMb} MB
                  </div>
                </div>
              </div>

              {/* My Hosts Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">{t.myHosts}</h2>
                  <span
                    className="text-xs text-slate-400 font-mono tabular-nums"
                    dir="ltr"
                  >
                    {totalHostsCount} / {MAX_HOSTS_PER_USER} {t.usedOf}
                  </span>
                </div>

                {hosts.length === 0 ? (
                  <div className="p-10 rounded-2xl bg-[#11131F] border border-slate-800 text-center space-y-4">
                    <Server className="w-8 h-8 text-indigo-400 mx-auto" />
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-white">
                        {t.noHostsTitle}
                      </div>
                      <p className="text-xs text-slate-400 max-w-md mx-auto">
                        {t.noHostsDesc}
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => setCreateModalOpen(true)}
                        className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
                      >
                        {t.createHost}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {hosts.map((host) => {
                      const isOnline =
                        host.status === 'ONLINE' && host.nodeOnline;
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
                                ● {isOnline ? t.online : host.status}
                              </span>
                            </div>

                            <div className="text-xs text-slate-400" dir="ltr">
                              <span>
                                {host.runtime} {host.runtimeVersion}
                              </span>
                              <span className="mx-1.5" aria-hidden="true">
                                ·
                              </span>
                              <span>{host.type.replace('_', ' ')}</span>
                            </div>

                            <div className="pt-2 text-xs font-mono tabular-nums text-slate-300 space-y-1">
                              <div>
                                {t.cpuLimit}: {host.cpuLimitPercent}% ·{' '}
                                {t.ramLimit}: {host.memoryLimitMb} MB
                              </div>
                              <div className="text-slate-500">
                                {host.nodeOnline
                                  ? `${t.nodeLabel}: ${host.nodeName}`
                                  : t.runtimeNodeUnavailable}
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
                            {t.manage}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Activity */}
              <div className="space-y-3">
                <h2 className="text-base font-bold text-white">
                  {t.recentActivity}
                </h2>
                {recentActivity.length === 0 ? (
                  <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 text-xs text-slate-400 text-center">
                    {t.noRecentActivity}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentActivity.map((act) => (
                      <div
                        key={act.id}
                        className="p-3.5 rounded-xl bg-[#11131F] border border-slate-800 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-semibold text-white">
                            {act.action}
                          </span>
                          {act.hostName && (
                            <>
                              <span className="mx-2 text-slate-500">·</span>
                              <span className="text-indigo-300">
                                {act.hostName}
                              </span>
                            </>
                          )}
                        </div>
                        <span
                          className="font-mono text-slate-500 tabular-nums"
                          dir="ltr"
                        >
                          {act.createdAt}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {section === 'host-panel' && selectedHostId && (
            <HostPanelView
              hostId={selectedHostId}
              onBack={() => setSection('dashboard')}
              onHostDeleted={() => {
                setSelectedHostId(null);
                setSection('dashboard');
                void loadHostsDashboard();
              }}
            />
          )}

          {section === 'admin' && user.role === 'ADMIN' && (
            <AdminControlPlaneView />
          )}
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
