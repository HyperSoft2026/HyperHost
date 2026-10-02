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
  AlertCircle,
  Globe,
  Copy,
  Check,
} from 'lucide-react';
import {
  MAX_HOSTS_PER_USER,
  type AuthenticatedUserDTO,
  type HealthReportDTO,
  type HostSummaryDTO,
} from './shared/types';
import { apiFetch } from './client/api';
import { LogoMark } from './client/LogoMark';
import {
  PublicPortal,
  isPublicRoutePath,
  type PublicRoutePath,
} from './client/PublicPortal';
import { CreateHostModal } from './client/CreateHostModal';
import { HostPanelView } from './client/HostPanelView';
import { AdminControlPlaneView } from './client/AdminControlPlaneView';
import { LanguageSwitcher, useI18n } from './client/i18n';

function normalizePathname(rawPath: string): string {
  if (!rawPath || rawPath === '/') return '/';
  const cleaned = rawPath.replace(/\/+$/, '');
  return cleaned || '/';
}

export default function App() {
  const { t, isRtl } = useI18n();
  const [pathname, setPathname] = useState<string>(() =>
    normalizePathname(window.location.pathname)
  );
  const [health, setHealth] = useState<HealthReportDTO | null>(null);
  const [user, setUser] = useState<AuthenticatedUserDTO | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [initializing, setInitializing] = useState<boolean>(true);
  const [showDiscordLoginBanner, setShowDiscordLoginBanner] =
    useState<boolean>(false);
  const [loginDmState, setLoginDmState] = useState<{
    sent: boolean;
    reason: string | null;
  }>({ sent: false, reason: null });
  const [hostCreatedDmBanner, setHostCreatedDmBanner] = useState<{
    visible: boolean;
    sent: boolean;
    reason: string | null;
  }>({ visible: false, sent: false, reason: null });

  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [hosts, setHosts] = useState<HostSummaryDTO[]>([]);
  const [availableNodes, setAvailableNodes] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  function navigateTo(nextPath: string, replace = false) {
    const normalized = normalizePathname(nextPath);
    if (replace) {
      window.history.replaceState({}, '', normalized);
    } else {
      window.history.pushState({}, '', normalized);
    }
    setPathname(normalized);
    setMobileMenuOpen(false);
  }

  useEffect(() => {
    const onPopState = () => {
      setPathname(normalizePathname(window.location.pathname));
      setMobileMenuOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isDiscordSuccess = params.get('login') === 'discord_success';
    if (isDiscordSuccess) {
      const dmStatus = params.get('dm');
      const dmReason = params.get('dm_reason');
      setLoginDmState({
        sent: dmStatus === 'sent',
        reason: dmStatus === 'sent' ? null : dmReason || 'DISCORD_API_ERROR',
      });
      setShowDiscordLoginBanner(true);
      params.delete('login');
      params.delete('dm');
      params.delete('dm_reason');
      const cleanSearch = params.toString();
      const targetPath =
        window.location.pathname === '/'
          ? '/dashboard'
          : normalizePathname(window.location.pathname);
      const nextUrl = `${targetPath}${
        cleanSearch ? `?${cleanSearch}` : ''
      }${window.location.hash}`;
      window.history.replaceState({}, '', nextUrl);
      setPathname(targetPath);
    }

    void bootstrapApp(isDiscordSuccess);

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const dmSent = Boolean(event.data?.dmSent);
        const dmReason =
          typeof event.data?.dmReason === 'string' ? event.data.dmReason : null;
        setLoginDmState({
          sent: dmSent,
          reason: dmSent ? null : dmReason || 'DISCORD_API_ERROR',
        });
        setShowDiscordLoginBanner(true);
        navigateTo('/dashboard', true);
        void bootstrapApp(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Synchronize `/hosts/:serverId` URL param with selectedHostId
  useEffect(() => {
    if (pathname.startsWith('/hosts/')) {
      const idFromUrl = decodeURIComponent(pathname.slice('/hosts/'.length));
      if (idFromUrl && idFromUrl !== selectedHostId) {
        setSelectedHostId(idFromUrl);
      }
    }
  }, [pathname]);

  // Poll dashboard while any Host is in an active provisioning lifecycle state
  useEffect(() => {
    if (!authenticated) return;
    const hasProvisioningHost = hosts.some((h) =>
      [
        'PENDING',
        'PROVISIONING',
        'BOOTSTRAPPING',
        'NODE_CONNECTING',
        'NODE_ONLINE',
        'STARTING',
      ].includes(h.status)
    );
    if (!hasProvisioningHost) return;
    const timer = window.setInterval(() => {
      void loadHostsDashboard();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [authenticated, hosts]);

  async function bootstrapApp(justLoggedIn = false) {
    setInitializing(true);
    try {
      const [healthRes, authRes] = await Promise.all([
        apiFetch<HealthReportDTO>('/api/health').catch(() => null),
        apiFetch<{
          authenticated: boolean;
          user: AuthenticatedUserDTO | null;
          lastLoginNotification?: {
            sent: boolean;
            reason: string | null;
          } | null;
        }>('/api/auth/me').catch(() => null),
      ]);

      if (healthRes) setHealth(healthRes);

      if (authRes?.authenticated && authRes.user) {
        setAuthenticated(true);
        setUser(authRes.user);
        if (justLoggedIn && authRes.lastLoginNotification) {
          setLoginDmState({
            sent: Boolean(authRes.lastLoginNotification.sent),
            reason: authRes.lastLoginNotification.sent
              ? null
              : authRes.lastLoginNotification.reason || 'DISCORD_API_ERROR',
          });
        }
        await loadHostsDashboard();
        if (justLoggedIn && normalizePathname(window.location.pathname) === '/') {
          navigateTo('/dashboard', true);
        }
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
        setSelectedHostId(data.hosts[0].serverId || data.hosts[0].publicId || data.hosts[0].id);
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
    navigateTo('/');
  }

  function handleCopyId(val: string) {
    void navigator.clipboard?.writeText(val);
    setCopiedId(val);
    setTimeout(() => setCopiedId(null), 1600);
  }

  if (initializing) {
    return (
      <div className="min-h-screen bg-[#080911] text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <img
            src="/assets/Logo.png"
            alt="HyperHost"
            referrerPolicy="no-referrer"
            className="w-9 h-9 object-contain animate-pulse"
          />
          <span>{t.initializing}</span>
        </div>
      </div>
    );
  }

  // If the current URL is one of the 7 public pages, OR the user is not authenticated:
  if (isPublicRoutePath(pathname) || !authenticated || !user) {
    const publicPath: PublicRoutePath = isPublicRoutePath(pathname)
      ? pathname
      : '/';
    return (
      <PublicPortal
        currentPath={publicPath}
        onNavigate={(nextPath) => navigateTo(nextPath)}
        user={authenticated ? user : null}
        onOpenDashboard={() => navigateTo('/dashboard')}
      />
    );
  }

  const activeWorkspaceSection: 'dashboard' | 'host-panel' | 'admin' =
    pathname.startsWith('/hosts/')
      ? 'host-panel'
      : pathname === '/admin' && user.role === 'ADMIN'
      ? 'admin'
      : 'dashboard';

  const totalHostsCount = hosts.length;
  const onlineHostsCount = hosts.filter(
    (h) => (h.status === 'RUNNING' || h.status === 'ONLINE') && h.nodeOnline
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
    <div className="min-h-screen bg-[#080911] text-slate-100 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#0C0E1A] border-e border-slate-800/90 justify-between shrink-0">
        <div className="p-5 space-y-6">
          <div className="flex items-center justify-between">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                navigateTo('/');
              }}
              className="focus-visible:outline-2 focus-visible:outline-violet-500 rounded-lg"
            >
              <LogoMark size="md" />
            </a>
          </div>

          <nav className="space-y-1.5">
            <button
              type="button"
              onClick={() => navigateTo('/dashboard')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                activeWorkspaceSection === 'dashboard'
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span>{t.navDashboard}</span>
            </button>

            {selectedHostId && (
              <button
                type="button"
                onClick={() =>
                  navigateTo(`/hosts/${encodeURIComponent(selectedHostId)}`)
                }
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                  activeWorkspaceSection === 'host-panel'
                    ? 'bg-violet-600 text-white'
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
                onClick={() => navigateTo('/admin')}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                  activeWorkspaceSection === 'admin'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Shield className="w-4 h-4 shrink-0" />
                <span>{t.navAdmin}</span>
              </button>
            )}

            <div className="pt-3 mt-3 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => navigateTo('/')}
                className="w-full px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/60 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <Globe className="w-4 h-4 shrink-0 text-violet-400" />
                <span>{t.navHome}</span>
              </button>
            </div>
          </nav>
        </div>

        {/* User / Quota / Public ID Footer */}
        <div className="p-4 border-t border-slate-800/90 space-y-3">
          <div className="p-3 rounded-xl bg-[#111322] border border-slate-800 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-400">
              <span>{t.accountQuota}</span>
              <span className="font-mono tabular-nums text-white" dir="ltr">
                {totalHostsCount} / {MAX_HOSTS_PER_USER} {t.hostsWord}
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500"
                style={{
                  width: `${Math.min(
                    100,
                    (totalHostsCount / MAX_HOSTS_PER_USER) * 100
                  )}%`,
                }}
              />
            </div>
            <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>{t.userIdLabel}:</span>
              <button
                type="button"
                onClick={() => handleCopyId(user.publicId)}
                dir="ltr"
                className="font-mono text-violet-300 hover:text-violet-200 inline-flex items-center gap-1 cursor-pointer"
              >
                <span>{user.publicId}</span>
                {copiedId === user.publicId ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
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
      <header className="lg:hidden sticky top-0 z-[60] h-16 flex items-center justify-between px-4 bg-[#0C0E1A]/95 backdrop-blur-md border-b border-slate-800">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigateTo('/');
          }}
          className="shrink-0"
        >
          <LogoMark size="sm" />
        </a>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? t.closeMenuAria : t.openMenuAria}
            aria-expanded={mobileMenuOpen}
            aria-controls="workspace-mobile-drawer"
            className="relative z-20 shrink-0 pointer-events-auto touch-manipulation min-h-[40px] min-w-[40px] p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 inline-flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5 pointer-events-none" />
            ) : (
              <Menu className="w-5 h-5 pointer-events-none" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile Drawer in Workspace */}
      {mobileMenuOpen && (
        <div
          id="workspace-mobile-drawer"
          className="fixed inset-x-0 top-16 bottom-0 z-50 lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation Menu"
        >
          <div
            className="fixed inset-x-0 top-16 bottom-0 bg-black/75 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 w-80 max-w-[85vw] bg-[#0D0F1B] border-s border-slate-800 h-full flex flex-col justify-between p-5 overflow-y-auto ms-auto">
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <LogoMark size="sm" />
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label={t.closeMenuAria}
                  className="min-h-[40px] min-w-[40px] p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white inline-flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => navigateTo('/dashboard')}
                  className="block w-full text-start px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  {t.navDashboard}
                </button>
                {selectedHostId && (
                  <button
                    type="button"
                    onClick={() =>
                      navigateTo(`/hosts/${encodeURIComponent(selectedHostId)}`)
                    }
                    className="block w-full text-start px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-200 hover:bg-slate-800"
                  >
                    {t.navHostPanel}
                  </button>
                )}
                {user.role === 'ADMIN' && (
                  <button
                    type="button"
                    onClick={() => navigateTo('/admin')}
                    className="block w-full text-start px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-200 hover:bg-slate-800"
                  >
                    {t.navAdmin}
                  </button>
                )}
                <div className="pt-2 mt-2 border-t border-slate-800 space-y-1">
                  <button
                    type="button"
                    onClick={() => navigateTo('/')}
                    className="block w-full text-start px-3.5 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    {t.navHome}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo('/services')}
                    className="block w-full text-start px-3.5 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    {t.navServices}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo('/projects')}
                    className="block w-full text-start px-3.5 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    {t.navProjects}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo('/about')}
                    className="block w-full text-start px-3.5 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    {t.navAbout}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo('/contact')}
                    className="block w-full text-start px-3.5 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    {t.navContact}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo('/privacy')}
                    className="block w-full text-start px-3.5 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    {t.navPrivacy}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo('/terms')}
                    className="block w-full text-start px-3.5 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    {t.navTerms}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{t.languageLabel}</span>
                <LanguageSwitcher dropUp onChanged={() => setMobileMenuOpen(false)} />
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-2.5 px-4 rounded-xl bg-red-950/50 border border-red-800/60 text-xs font-semibold text-red-300 cursor-pointer"
              >
                {t.signOut}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="hidden lg:flex items-center justify-between px-8 py-4 border-b border-slate-800/80 bg-[#080911]">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>{t.controlPlaneHeader}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-violet-300" dir="ltr">
              {user.publicId}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              disabled={totalHostsCount >= MAX_HOSTS_PER_USER}
              className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>
                {t.createHost} ({totalHostsCount}/{MAX_HOSTS_PER_USER})
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-5 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-8">
          {/* In-App Discord Login Notification Banner (Reflects Real Discord API Result) */}
          {showDiscordLoginBanner && (
            <div
              className={`p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                loginDmState.sent
                  ? 'bg-violet-950/40 border border-violet-500/40'
                  : 'bg-amber-950/35 border border-amber-500/40'
              }`}
            >
              <div className="flex items-start sm:items-center gap-3">
                {loginDmState.sent ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                )}
                <div className="text-xs space-y-1">
                  <div className="font-bold text-white">
                    {t.discordLoginSuccessTitle} — {user.displayName} (@{user.username})
                  </div>
                  <div className="text-slate-200">
                    {loginDmState.sent
                      ? t.discordLoginDmSentMsg
                      : loginDmState.reason === 'DISCORD_DM_FORBIDDEN'
                      ? t.discordLoginDmForbiddenMsg
                      : loginDmState.reason === 'DISCORD_DM_NOT_CONFIGURED'
                      ? t.discordLoginDmNotConfiguredMsg
                      : t.discordLoginDmFailedMsg}
                  </div>
                  {!loginDmState.sent && loginDmState.reason && (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <span className="font-mono text-[11px] text-amber-300/90" dir="ltr">
                        {loginDmState.reason}
                      </span>
                      {loginDmState.reason === 'DISCORD_DM_FORBIDDEN' && (
                        <a
                          href="https://discord.gg/b3VwbVhwvU"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-semibold text-violet-300 hover:text-violet-200 underline"
                        >
                          {t.joinHyperSoftDiscordBtn}
                        </a>
                      )}
                    </div>
                  )}
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

          {/* In-App Host Created Discord Notification Banner (Reflects Real Discord API Result) */}
          {hostCreatedDmBanner.visible && (
            <div
              className={`p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                hostCreatedDmBanner.sent
                  ? 'bg-emerald-950/35 border border-emerald-500/40'
                  : 'bg-amber-950/35 border border-amber-500/40'
              }`}
            >
              <div className="flex items-start sm:items-center gap-3">
                {hostCreatedDmBanner.sent ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                )}
                <div className="text-xs space-y-1">
                  <div className="text-slate-200 font-medium">
                    {hostCreatedDmBanner.sent
                      ? t.discordHostCreatedDmSentMsg
                      : hostCreatedDmBanner.reason === 'DISCORD_DM_FORBIDDEN'
                      ? t.discordHostCreatedDmForbiddenMsg
                      : hostCreatedDmBanner.reason === 'DISCORD_DM_NOT_CONFIGURED'
                      ? t.discordHostCreatedDmNotConfiguredMsg
                      : t.discordHostCreatedDmFailedMsg}
                  </div>
                  {!hostCreatedDmBanner.sent && hostCreatedDmBanner.reason && (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <span className="font-mono text-[11px] text-amber-300/90" dir="ltr">
                        {hostCreatedDmBanner.reason}
                      </span>
                      {hostCreatedDmBanner.reason === 'DISCORD_DM_FORBIDDEN' && (
                        <a
                          href="https://discord.gg/b3VwbVhwvU"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-semibold text-violet-300 hover:text-violet-200 underline"
                        >
                          {t.joinHyperSoftDiscordBtn}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setHostCreatedDmBanner((prev) => ({ ...prev, visible: false }))
                }
                className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-900/80 border border-slate-700 rounded-lg self-end sm:self-center cursor-pointer"
              >
                {t.dismiss}
              </button>
            </div>
          )}

          {activeWorkspaceSection === 'dashboard' && (
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
                  className="lg:hidden px-4 py-2.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl inline-flex items-center gap-1.5 self-start cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {t.createHost} ({totalHostsCount}/{MAX_HOSTS_PER_USER})
                  </span>
                </button>
              </div>

              {/* DASHBOARD METRICS GRID */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="p-4 rounded-xl bg-[#101220] border border-slate-800">
                  <div className="text-xs text-slate-400">{t.totalHosts}</div>
                  <div
                    className="text-xl font-bold text-white font-mono tabular-nums mt-1"
                    dir="ltr"
                  >
                    {totalHostsCount} / {MAX_HOSTS_PER_USER}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#101220] border border-slate-800">
                  <div className="text-xs text-slate-400">{t.onlineHosts}</div>
                  <div
                    className="text-xl font-bold text-emerald-400 font-mono tabular-nums mt-1"
                    dir="ltr"
                  >
                    {onlineHostsCount}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#101220] border border-slate-800">
                  <div className="text-xs text-slate-400">{t.offlinePending}</div>
                  <div
                    className="text-xl font-bold text-amber-400 font-mono tabular-nums mt-1"
                    dir="ltr"
                  >
                    {offlineHostsCount}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#101220] border border-slate-800">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span>{t.cpuUsage}</span>
                  </div>
                  <div className="text-sm font-mono text-slate-300 mt-1.5">
                    {health?.runtime.connectedNodes
                      ? '0.0%'
                      : t.noMetricsAvailable}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#101220] border border-slate-800">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span>{t.memoryQuota}</span>
                  </div>
                  <div
                    className="text-sm font-mono tabular-nums text-slate-200 mt-1.5"
                    dir="ltr"
                  >
                    {totalAllocatedMemoryMb} MB
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#101220] border border-slate-800">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5 text-violet-400 shrink-0" />
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
                  <div className="p-10 rounded-2xl bg-[#101220] border border-slate-800 text-center space-y-4">
                    <Server className="w-8 h-8 text-violet-400 mx-auto" />
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
                        className="px-4 py-2.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-xl cursor-pointer"
                      >
                        {t.createHost}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {hosts.map((host) => {
                      const isOnline =
                        (host.status === 'RUNNING' || host.status === 'ONLINE') &&
                        host.nodeOnline;
                      const serverPublicId =
                        host.serverId || host.publicId || host.id;
                      return (
                        <div
                          key={host.id}
                          className="p-5 rounded-2xl bg-[#101220] border border-slate-800 hover:border-violet-500/40 transition-colors flex flex-col justify-between space-y-5"
                        >
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="text-base font-bold text-white truncate">
                                {host.name}
                              </h3>
                              <span
                                className={`text-xs font-medium shrink-0 ${
                                  isOnline
                                    ? 'text-emerald-400'
                                    : [
                                        'ERROR',
                                        'PROVISIONING_FAILED',
                                        'BOOTSTRAP_FAILED',
                                      ].includes(host.status)
                                    ? 'text-red-400'
                                    : [
                                        'PENDING',
                                        'PROVISIONING',
                                        'BOOTSTRAPPING',
                                        'NODE_CONNECTING',
                                        'NODE_ONLINE',
                                        'STARTING',
                                      ].includes(host.status)
                                    ? 'text-amber-400'
                                    : 'text-slate-400'
                                }`}
                              >
                                ● {isOnline ? host.status : host.status}
                              </span>
                            </div>

                            {/* Unique Server ID Badge */}
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-400">
                                {t.serverIdLabel}:
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyId(serverPublicId)}
                                dir="ltr"
                                className="px-2 py-0.5 rounded bg-[#080911] border border-slate-800 hover:border-violet-500/40 font-mono text-violet-300 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <span>{serverPublicId}</span>
                                {copiedId === serverPublicId ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-slate-500" />
                                )}
                              </button>
                            </div>

                            <div className="text-xs text-slate-400" dir="ltr">
                              <span>
                                {host.runtime} v{host.runtimeVersion}
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
                                  : host.provisioningError
                                  ? host.provisioningError
                                  : t.runtimeNodeUnavailable}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedHostId(serverPublicId);
                              navigateTo(
                                `/hosts/${encodeURIComponent(serverPublicId)}`
                              );
                            }}
                            className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition-colors cursor-pointer"
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
                  <div className="p-6 rounded-xl bg-[#101220] border border-slate-800 text-xs text-slate-400 text-center">
                    {t.noRecentActivity}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentActivity.map((act) => (
                      <div
                        key={act.id}
                        className="p-3.5 rounded-xl bg-[#101220] border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <span
                            className="font-mono text-[11px] text-violet-300 me-2"
                            dir="ltr"
                          >
                            {act.activityId || act.id}
                          </span>
                          <span className="font-semibold text-white">
                            {act.action}
                          </span>
                          {act.hostName && (
                            <>
                              <span className="mx-2 text-slate-500">·</span>
                              <span className="text-violet-300">
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

          {activeWorkspaceSection === 'host-panel' && selectedHostId && (
            <HostPanelView
              hostId={selectedHostId}
              onBack={() => navigateTo('/dashboard')}
              onHostDeleted={() => {
                setSelectedHostId(null);
                navigateTo('/dashboard');
                void loadHostsDashboard();
              }}
            />
          )}

          {activeWorkspaceSection === 'admin' && user.role === 'ADMIN' && (
            <AdminControlPlaneView
              onInspectHost={(srvId) => {
                setSelectedHostId(srvId);
                navigateTo(`/hosts/${encodeURIComponent(srvId)}`);
              }}
            />
          )}
        </main>
      </div>

      <CreateHostModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={(newHostId, notification) => {
          if (notification) {
            setHostCreatedDmBanner({
              visible: true,
              sent: Boolean(notification.sent),
              reason: notification.reason ?? null,
            });
          }
          void loadHostsDashboard();
          setSelectedHostId(newHostId);
          navigateTo(`/hosts/${encodeURIComponent(newHostId)}`);
        }}
        currentHostCount={totalHostsCount}
        availableNodes={availableNodes}
        isAdmin={user.role === 'ADMIN'}
      />
    </div>
  );
}
