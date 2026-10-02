import React, { useEffect, useState } from 'react';
import {
  Menu,
  X,
  Shield,
  Lock,
  Terminal,
  Database,
  Clock,
  HardDrive,
  Users,
  Code2,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Mail,
  MessageSquare,
  FileText,
  Scale,
  Layers,
} from 'lucide-react';
import { RUNTIME_CATALOG, type AuthenticatedUserDTO } from '../shared/types';
import { apiFetch, ClientApiError } from './api';
import { LanguageSwitcher, useI18n } from './i18n';

export type PublicRoutePath =
  | '/'
  | '/services'
  | '/projects'
  | '/about'
  | '/contact'
  | '/terms'
  | '/privacy';

export function isPublicRoutePath(pathname: string): pathname is PublicRoutePath {
  return (
    pathname === '/' ||
    pathname === '/services' ||
    pathname === '/projects' ||
    pathname === '/about' ||
    pathname === '/contact' ||
    pathname === '/terms' ||
    pathname === '/privacy'
  );
}

export const DiscordIcon: React.FC<{ className?: string }> = ({
  className = 'w-4 h-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
  </svg>
);

interface PublicPortalProps {
  currentPath: PublicRoutePath;
  onNavigate: (path: string) => void;
  user: AuthenticatedUserDTO | null;
  onOpenDashboard: () => void;
}

export const PublicPortal: React.FC<PublicPortalProps> = ({
  currentPath,
  onNavigate,
  user,
  onOpenDashboard,
}) => {
  const { t, locale, isRtl } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Close drawer automatically when route changes
  useEffect(() => {
    setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPath]);

  // Prevent body scroll and handle Escape / desktop resize when mobile drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
      }
    };
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [drawerOpen]);

  const handleDiscordLogin = async () => {
    setAuthError(null);
    setConnecting(true);
    try {
      const data = await apiFetch<{ url: string }>(
        `/api/auth/url?locale=${encodeURIComponent(locale)}`
      );

      let isEmbeddedFrame = false;
      try {
        isEmbeddedFrame = window.self !== window.top;
      } catch {
        isEmbeddedFrame = true;
      }

      if (isEmbeddedFrame) {
        const popup = window.open(
          data.url,
          'hyperhost_discord_oauth',
          'width=580,height=720'
        );
        if (!popup) {
          window.location.href = data.url;
        }
      } else {
        window.location.href = data.url;
      }
    } catch (err) {
      if (err instanceof ClientApiError) {
        setAuthError(`[${err.code}] ${err.message}`);
      } else {
        setAuthError(
          isRtl
            ? 'تعذّر بدء عملية المصادقة عبر Discord OAuth2.'
            : 'Unable to initiate Discord OAuth2 authentication.'
        );
      }
    } finally {
      setConnecting(false);
    }
  };

  const desktopNavItems: Array<{ path: PublicRoutePath; label: string }> = [
    { path: '/', label: t.navHome },
    { path: '/services', label: t.navServices },
    { path: '/projects', label: t.navProjects },
    { path: '/about', label: t.navAbout },
    { path: '/contact', label: t.navContact },
  ];

  const mobileNavItems: Array<{ path: PublicRoutePath; label: string }> = [
    { path: '/', label: t.navHome },
    { path: '/services', label: t.navServices },
    { path: '/projects', label: t.navProjects },
    { path: '/about', label: t.navAbout },
    { path: '/contact', label: t.navContact },
    { path: '/privacy', label: t.navPrivacy },
    { path: '/terms', label: t.navTerms },
  ];

  const handleLinkClick = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setDrawerOpen(false);
    onNavigate(path);
  };

  return (
    <div className="min-h-screen bg-[#080911] text-slate-100 flex flex-col selection:bg-violet-500/30 selection:text-violet-200">
      {/* RESPONSIVE HEADER */}
      <header className="sticky top-0 z-[60] bg-[#080911]/95 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-3">
          {/* Zone 1: Official Logo + HyperHost */}
          <a
            href="/"
            onClick={(e) => handleLinkClick(e, '/')}
            className="flex items-center gap-2.5 shrink-0 focus-visible:outline-2 focus-visible:outline-violet-500 rounded-lg"
          >
            <img
              src="/assets/Logo.png"
              alt="HyperHost"
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-xl bg-[#131629] border border-violet-500/30 p-1 object-contain shrink-0"
            />
            <span className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap">
              HyperHost
            </span>
          </a>

          {/* Zone 2: Desktop Navigation (No Hamburger on Desktop) */}
          <nav
            aria-label="Primary Navigation"
            className="hidden lg:flex items-center gap-7 text-sm font-medium"
          >
            {desktopNavItems.map((item) => {
              const active = currentPath === item.path;
              return (
                <a
                  key={item.path}
                  href={item.path}
                  onClick={(e) => handleLinkClick(e, item.path)}
                  aria-current={active ? 'page' : undefined}
                  className={`py-1 transition-colors whitespace-nowrap border-b-2 ${
                    active
                      ? 'text-white border-violet-500 font-semibold'
                      : 'text-slate-300 hover:text-white border-transparent'
                  }`}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          {/* Zone 3: Desktop Language Switcher + Desktop Login/Dashboard Button + Mobile Hamburger */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="hidden lg:flex items-center gap-3">
              <LanguageSwitcher />

              {user ? (
                <button
                  type="button"
                  onClick={onOpenDashboard}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-violet-400"
                >
                  <span>{t.openDashboard}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDiscordLogin}
                  disabled={connecting}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 text-white text-sm font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-violet-400"
                >
                  <DiscordIcon className="w-4 h-4 shrink-0" />
                  <span>
                    {connecting ? t.connectingDiscord : t.loginWithDiscord}
                  </span>
                </button>
              )}
            </div>

            {/* Mobile Hamburger Button (Hidden on Desktop lg+) */}
            <button
              type="button"
              onClick={() => setDrawerOpen((prev) => !prev)}
              aria-label={drawerOpen ? t.closeMenuAria : t.openMenuAria}
              aria-expanded={drawerOpen}
              aria-controls="public-mobile-drawer"
              className="lg:hidden relative z-20 shrink-0 pointer-events-auto touch-manipulation min-h-[40px] min-w-[40px] p-2 rounded-xl bg-[#121424] hover:bg-[#191C32] border border-slate-800 text-slate-200 inline-flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-violet-500"
            >
              {drawerOpen ? (
                <X className="w-5 h-5 pointer-events-none" />
              ) : (
                <Menu className="w-5 h-5 pointer-events-none" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* MOBILE NAVIGATION DRAWER */}
      {drawerOpen && (
        <div
          id="public-mobile-drawer"
          className="fixed inset-x-0 top-16 bottom-0 z-50 lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation Menu"
        >
          {/* Backdrop — closes menu when clicking outside */}
          <div
            className="fixed inset-x-0 top-16 bottom-0 bg-black/75 backdrop-blur-xs"
            onClick={() => setDrawerOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="relative z-10 w-80 max-w-[85vw] bg-[#0D0F1B] border-s border-slate-800 h-full flex flex-col justify-between p-5 overflow-y-auto ms-auto">
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <img
                    src="/assets/Logo.png"
                    alt="HyperHost"
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-lg bg-[#131629] border border-violet-500/30 p-1 object-contain"
                  />
                  <div>
                    <div className="text-sm font-bold text-white">HyperHost</div>
                    <div className="text-[11px] text-violet-300/80">
                      Powered by HyperSoft
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label={t.closeMenuAria}
                  className="min-h-[40px] min-w-[40px] p-2 rounded-lg bg-[#141728] border border-slate-800 text-slate-300 hover:text-white inline-flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <nav aria-label="Mobile Navigation" className="space-y-1.5">
                {mobileNavItems.map((item) => {
                  const active = currentPath === item.path;
                  return (
                    <a
                      key={item.path}
                      href={item.path}
                      onClick={(e) => handleLinkClick(e, item.path)}
                      className={`block px-3.5 py-3 rounded-xl text-sm font-medium transition-colors ${
                        active
                          ? 'bg-violet-600/20 text-white border border-violet-500/40'
                          : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </a>
                  );
                })}
              </nav>
            </div>

            <div className="pt-6 border-t border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{t.languageLabel}</span>
                <LanguageSwitcher dropUp onChanged={() => setDrawerOpen(false)} />
              </div>

              {user ? (
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    onOpenDashboard();
                  }}
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>{t.openDashboard}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    void handleDiscordLogin();
                  }}
                  disabled={connecting}
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
                >
                  <DiscordIcon className="w-4 h-4 shrink-0" />
                  <span>
                    {connecting ? t.connectingDiscord : t.loginWithDiscord}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* OAuth Error Banner */}
      {authError && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4">
          <div className="p-4 rounded-xl bg-red-950/50 border border-red-800/70 text-xs text-red-200 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span dir="ltr" className="font-mono">
                {authError}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="text-red-300 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* MAIN PAGE CONTENT */}
      <main className="flex-1 overflow-x-hidden">
        {currentPath === '/' && (
          <HomePageContent
            onLogin={handleDiscordLogin}
            connecting={connecting}
            user={user}
            onOpenDashboard={onOpenDashboard}
            onNavigate={onNavigate}
          />
        )}
        {currentPath === '/services' && (
          <ServicesPageContent
            onLogin={handleDiscordLogin}
            user={user}
            onOpenDashboard={onOpenDashboard}
          />
        )}
        {currentPath === '/projects' && (
          <ProjectsPageContent
            onLogin={handleDiscordLogin}
            user={user}
            onOpenDashboard={onOpenDashboard}
          />
        )}
        {currentPath === '/about' && (
          <AboutPageContent onNavigate={onNavigate} />
        )}
        {currentPath === '/contact' && <ContactPageContent />}
        {currentPath === '/terms' && <TermsPageContent />}
        {currentPath === '/privacy' && <PrivacyPageContent />}
      </main>

      {/* PUBLIC FOOTER */}
      <footer className="border-t border-slate-800/80 bg-[#06070D] mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 justify-between">
            <div className="md:col-span-5 space-y-3">
              <div className="flex items-center gap-3">
                <img
                  src="/assets/Logo.png"
                  alt="HyperHost"
                  referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-xl bg-[#131629] border border-violet-500/30 p-1 object-contain"
                />
                <div>
                  <div className="text-base font-bold text-white">HyperHost</div>
                  <div className="text-xs text-violet-300/80">
                    Powered by HyperSoft
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-md">
                {t.heroDescription}
              </p>
            </div>

            <div className="md:col-span-4 grid grid-cols-2 gap-6 text-xs">
              <div className="space-y-2.5">
                <div className="font-semibold text-white">
                  {isRtl ? 'روابط المنصة' : 'Platform'}
                </div>
                <ul className="space-y-2 text-slate-400">
                  <li>
                    <a
                      href="/"
                      onClick={(e) => handleLinkClick(e, '/')}
                      className="hover:text-white transition-colors"
                    >
                      {t.navHome}
                    </a>
                  </li>
                  <li>
                    <a
                      href="/services"
                      onClick={(e) => handleLinkClick(e, '/services')}
                      className="hover:text-white transition-colors"
                    >
                      {t.navServices}
                    </a>
                  </li>
                  <li>
                    <a
                      href="/projects"
                      onClick={(e) => handleLinkClick(e, '/projects')}
                      className="hover:text-white transition-colors"
                    >
                      {t.navProjects}
                    </a>
                  </li>
                  <li>
                    <a
                      href="/about"
                      onClick={(e) => handleLinkClick(e, '/about')}
                      className="hover:text-white transition-colors"
                    >
                      {t.navAbout}
                    </a>
                  </li>
                </ul>
              </div>

              <div className="space-y-2.5">
                <div className="font-semibold text-white">
                  {isRtl ? 'السياسات والدعم' : 'Legal & Support'}
                </div>
                <ul className="space-y-2 text-slate-400">
                  <li>
                    <a
                      href="/contact"
                      onClick={(e) => handleLinkClick(e, '/contact')}
                      className="hover:text-white transition-colors"
                    >
                      {t.navContact}
                    </a>
                  </li>
                  <li>
                    <a
                      href="/terms"
                      onClick={(e) => handleLinkClick(e, '/terms')}
                      className="hover:text-white transition-colors"
                    >
                      {t.navTerms}
                    </a>
                  </li>
                  <li>
                    <a
                      href="/privacy"
                      onClick={(e) => handleLinkClick(e, '/privacy')}
                      className="hover:text-white transition-colors"
                    >
                      {t.navPrivacy}
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://discord.gg/b3VwbVhwvU"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-violet-300 transition-colors inline-flex items-center gap-1"
                    >
                      <span>HyperSoft Discord</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </li>
                </ul>
              </div>
            </div>

            <div className="md:col-span-3 space-y-3 text-xs">
              <div className="font-semibold text-white">
                {isRtl ? 'الوصول السريع' : 'Account Access'}
              </div>
              <p className="text-slate-400 leading-relaxed">
                {isRtl
                  ? 'سجّل الدخول باستخدام حسابك في Discord لإدارة استضافاتك بحد أقصى 10 استضافات لكل حساب.'
                  : 'Authenticate with your Discord account to manage up to 10 isolated Hosts per account.'}
              </p>
              {user ? (
                <button
                  type="button"
                  onClick={onOpenDashboard}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  {t.openDashboard}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDiscordLogin}
                  className="px-4 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <DiscordIcon className="w-3.5 h-3.5" />
                  <span>{t.loginWithDiscord}</span>
                </button>
              )}
            </div>
          </div>

          <div className="pt-6 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div>
              © {new Date().getFullYear()} HyperHost — Powered by HyperSoft. All rights reserved.
            </div>
            <div className="flex items-center gap-4">
              <a
                href="/terms"
                onClick={(e) => handleLinkClick(e, '/terms')}
                className="hover:text-slate-300"
              >
                {t.navTerms}
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="/privacy"
                onClick={(e) => handleLinkClick(e, '/privacy')}
                className="hover:text-slate-300"
              >
                {t.navPrivacy}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

/* ============================================================================
 * 1. HOMEPAGE (/)
 * ========================================================================== */
const HomePageContent: React.FC<{
  onLogin: () => void;
  connecting: boolean;
  user: AuthenticatedUserDTO | null;
  onOpenDashboard: () => void;
  onNavigate: (path: string) => void;
}> = ({ onLogin, connecting, user, onOpenDashboard, onNavigate }) => {
  const { t, isRtl } = useI18n();
  const supportedRuntimes = RUNTIME_CATALOG.filter((r) => r.supportedNow);

  return (
    <div className="space-y-20 py-12 sm:py-16 lg:py-20">
      {/* HERO SECTION */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative rounded-3xl bg-gradient-to-b from-[#131528] to-[#0C0E1A] border border-violet-500/20 p-6 sm:p-10 lg:p-14 overflow-hidden">
          <div className="max-w-3xl space-y-6">
            <div className="flex items-center gap-3 text-xs font-medium text-violet-300">
              <img
                src="/assets/Logo.png"
                alt="HyperHost"
                referrerPolicy="no-referrer"
                className="w-6 h-6 object-contain"
              />
              <span>HyperHost</span>
              <span aria-hidden="true">·</span>
              <span>Powered by HyperSoft</span>
            </div>

            <h1
              className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-tight"
              style={{ textWrap: 'balance' }}
            >
              {t.heroTitle}
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
              {t.heroDescription}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {user ? (
                <button
                  type="button"
                  onClick={onOpenDashboard}
                  className="min-h-[44px] px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold inline-flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <span>{t.openDashboard}</span>
                  {isRtl ? (
                    <ArrowLeft className="w-4 h-4" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onLogin}
                  disabled={connecting}
                  className="min-h-[44px] px-6 py-3 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <DiscordIcon className="w-4 h-4 shrink-0" />
                  <span>
                    {connecting ? t.connectingDiscord : t.loginWithDiscord}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onNavigate('/services')}
                className="min-h-[44px] px-5 py-3 rounded-xl bg-[#16192E] hover:bg-[#1D213B] border border-slate-700/80 text-slate-200 text-sm font-medium transition-colors cursor-pointer"
              >
                {t.exploreServicesBtn}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* BOT HOSTING & SUPPORTED RUNTIMES */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            {t.supportedWorkloadsTitle}
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
            {t.supportedWorkloadsDesc}
          </p>
        </div>

        {/* Primary Bot Hosting Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 sm:p-7 rounded-2xl bg-[#101220] border border-slate-800 space-y-3">
            <div className="text-xs font-semibold text-violet-400">
              01 · Discord Ecosystem
            </div>
            <h3 className="text-lg font-bold text-white">
              {t.discordBotHostingTitle}
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {t.discordBotHostingDesc}
            </p>
            <div className="pt-2 text-xs text-slate-400 font-mono" dir="ltr">
              Discord.js · Eris · Pycord · JDA · Serenity
            </div>
          </div>

          <div className="p-6 sm:p-7 rounded-2xl bg-[#101220] border border-slate-800 space-y-3">
            <div className="text-xs font-semibold text-violet-400">
              02 · Telegram Ecosystem
            </div>
            <h3 className="text-lg font-bold text-white">
              {t.telegramBotHostingTitle}
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {t.telegramBotHostingDesc}
            </p>
            <div className="pt-2 text-xs text-slate-400 font-mono" dir="ltr">
              Telegraf · Grammy · Aiogram · python-telegram-bot
            </div>
          </div>
        </div>

        {/* 5 Core Language Runtimes: Node.js, Python, Java, Go, Rust */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {supportedRuntimes.map((rt) => (
            <div
              key={rt.code}
              className="p-5 rounded-2xl bg-[#101220] border border-slate-800/90 space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-1.5">
                <div className="text-base font-bold text-white">{rt.label}</div>
                <div className="text-xs text-slate-400 font-mono" dir="ltr">
                  Versions: {rt.availableVersions.map((v) => `v${v}`).join(' · ')}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-800/80 text-[11px] font-mono text-violet-300 truncate" dir="ltr">
                $ {rt.defaultStartupCommand}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 rounded-xl bg-[#0E101D] border border-slate-800/90 text-xs text-slate-400">
          {t.runtimeAvailabilityNote}
        </div>
      </section>

      {/* SECURITY & ARCHITECTURE PILLARS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white">
          {t.architecturePillarsTitle}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl bg-[#101220] border border-slate-800 space-y-2.5">
            <div className="flex items-center gap-2.5 text-sm font-bold text-white">
              <Layers className="w-4 h-4 text-violet-400 shrink-0" />
              <span>{t.pillarControlRuntimeTitle}</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {t.pillarControlRuntimeDesc}
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#101220] border border-slate-800 space-y-2.5">
            <div className="flex items-center gap-2.5 text-sm font-bold text-white">
              <Lock className="w-4 h-4 text-violet-400 shrink-0" />
              <span>{t.pillarEncryptionTitle}</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {t.pillarEncryptionDesc}
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#101220] border border-slate-800 space-y-2.5">
            <div className="flex items-center gap-2.5 text-sm font-bold text-white">
              <Users className="w-4 h-4 text-violet-400 shrink-0" />
              <span>{t.pillarRbacTitle}</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {t.pillarRbacDesc}
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#101220] border border-slate-800 space-y-2.5">
            <div className="flex items-center gap-2.5 text-sm font-bold text-white">
              <Shield className="w-4 h-4 text-violet-400 shrink-0" />
              <span>{t.pillarIdentityTitle}</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {t.pillarIdentityDesc}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

/* ============================================================================
 * 2. SERVICES PAGE (/services)
 * ========================================================================== */
const ServicesPageContent: React.FC<{
  onLogin: () => void;
  user: AuthenticatedUserDTO | null;
  onOpenDashboard: () => void;
}> = ({ onLogin, user, onOpenDashboard }) => {
  const { t, isRtl } = useI18n();

  const services = isRtl
    ? [
        {
          num: '01',
          title: 'استضافة بوتات Discord وTelegram',
          desc: 'إدارة كاملة لدورة حياة البوتات (بدء، إيقاف، إعادة تشغيل، إيقاف فوري، وإعادة بناء الحاوية) مع تخصيص دقيق للمعالج والذاكرة.',
          icon: <Terminal className="w-5 h-5 text-violet-400" />,
        },
        {
          num: '02',
          title: 'بيئات تشغيل متعددة اللغات (Polyglot Runtimes)',
          desc: 'دعم أصلي لـ Node.js وPython وJava وGo وRust مع إمكانية تحديد إصدار البيئة وأمر الإقلاع ومسار العمل.',
          icon: <Code2 className="w-5 h-5 text-violet-400" />,
        },
        {
          num: '03',
          title: 'خزنة متغيرات البيئة المشفرة (AES-256-GCM)',
          desc: 'تشفير جميع مفاتيح API وتوكنات البوتات قبل تخزينها في PostgreSQL، مع إخفاء القيم السرية تلقائياً في واجهة العرض وسجلات التدقيق.',
          icon: <Lock className="w-5 h-5 text-violet-400" />,
        },
        {
          num: '04',
          title: 'قواعد البيانات المخصصة للاستضافة',
          desc: 'توفير وإدارة قواعد بيانات PostgreSQL وMySQL وMongoDB وRedis المرتبطة بالاستضافة عبر عقد التشغيل.',
          icon: <Database className="w-5 h-5 text-violet-400" />,
        },
        {
          num: '05',
          title: 'المهام المجدولة (Cron Schedules)',
          desc: 'جدولة مهام دورية مثل إعادة التشغيل التلقائي أو تنفيذ الأوامر أو أخذ النسخ الاحتياطية عبر مجدول لوحة التحكم.',
          icon: <Clock className="w-5 h-5 text-violet-400" />,
        },
        {
          num: '06',
          title: 'النسخ الاحتياطي والصلاحيات الدقيقة (21 Scope)',
          desc: 'إدارة لقطات النسخ الاحتياطي وتفويض أعضاء الفريق بصلاحيات محددة لكل قسم من أقسام لوحة الاستضافة الـ 13.',
          icon: <HardDrive className="w-5 h-5 text-violet-400" />,
        },
      ]
    : [
        {
          num: '01',
          title: 'Discord & Telegram Bot Hosting',
          desc: 'Complete container lifecycle management (Start, Stop, Restart, Kill, Reinstall) with dedicated CPU, RAM, and NVMe quotas.',
          icon: <Terminal className="w-5 h-5 text-violet-400" />,
        },
        {
          num: '02',
          title: 'Polyglot Runtime Containers',
          desc: 'Native support for Node.js, Python, Java, Go, and Rust with customizable runtime versions, entrypoints, and working directories.',
          icon: <Code2 className="w-5 h-5 text-violet-400" />,
        },
        {
          num: '03',
          title: 'AES-256-GCM Encrypted Environment Vault',
          desc: 'All bot tokens and API secrets are encrypted at rest in PostgreSQL and automatically masked across UI views and audit logs.',
          icon: <Lock className="w-5 h-5 text-violet-400" />,
        },
        {
          num: '04',
          title: 'Host Database Provisioning',
          desc: 'Provision and manage PostgreSQL, MySQL, MongoDB, and Redis instances bound to your Host via the Runtime Plane.',
          icon: <Database className="w-5 h-5 text-violet-400" />,
        },
        {
          num: '05',
          title: 'Automated Cron Schedules',
          desc: 'Configure recurring tasks for automated restarts, command execution, and backup creation handled by the Control Plane Scheduler.',
          icon: <Clock className="w-5 h-5 text-violet-400" />,
        },
        {
          num: '06',
          title: 'S3 Backups & 21-Scope Team RBAC',
          desc: 'Create off-node archive snapshots and delegate fine-grained access across all 13 Host Panel sections using Discord IDs.',
          icon: <HardDrive className="w-5 h-5 text-violet-400" />,
        },
      ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-12">
      <div className="max-w-3xl space-y-3">
        <div className="text-xs font-semibold text-violet-400">
          HyperHost — Powered by HyperSoft
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-white">
          {t.navServices}
        </h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          {isRtl
            ? 'منظومة متكاملة لإدارة واستضافة البوتات والتطبيقات السحابية مع فصل صارم بين طبقة التحكم وطبقة التشغيل.'
            : 'End-to-end cloud hosting control plane engineered for Discord bots, Telegram bots, and polyglot backend services.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map((srv) => (
          <div
            key={srv.num}
            className="p-6 rounded-2xl bg-[#101220] border border-slate-800 space-y-3 flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-violet-400">
                  {srv.num}
                </span>
                {srv.icon}
              </div>
              <h2 className="text-base font-bold text-white">{srv.title}</h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                {srv.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="p-6 sm:p-8 rounded-2xl bg-[#111426] border border-violet-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-white">
            {isRtl
              ? 'حصة الحساب: حتى 10 استضافات لكل مستخدم'
              : 'Account Quota: Up to 10 Hosts per User'}
          </h3>
          <p className="text-xs text-slate-400">
            {isRtl
              ? 'سجّل الدخول عبر Discord للبدء بإنشاء وإدارة استضافاتك مباشرة.'
              : 'Sign in with Discord to provision and configure your Hosts immediately.'}
          </p>
        </div>
        {user ? (
          <button
            type="button"
            onClick={onOpenDashboard}
            className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer shrink-0"
          >
            {t.openDashboard}
          </button>
        ) : (
          <button
            type="button"
            onClick={onLogin}
            className="px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shrink-0"
          >
            <DiscordIcon className="w-4 h-4" />
            <span>{t.loginWithDiscord}</span>
          </button>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * 3. PROJECTS & ARCHITECTURES PAGE (/projects)
 * ========================================================================== */
const ProjectsPageContent: React.FC<{
  onLogin: () => void;
  user: AuthenticatedUserDTO | null;
  onOpenDashboard: () => void;
}> = ({ onLogin, user, onOpenDashboard }) => {
  const { t, isRtl } = useI18n();

  const blueprints = [
    {
      code: 'DISCORD_BOT',
      title: isRtl
        ? 'معمارية بوت Discord متعدد السيرفرات (Node.js 22)'
        : 'Multi-Guild Discord Bot Architecture (Node.js 22)',
      runtime: 'NODEJS v22',
      entrypoint: 'node index.js',
      envKeys: ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DATABASE_URL'],
      desc: isRtl
        ? 'قالب تشغيل معزول لبوتات Discord.js v14 مع خزنة متغيرات مشفرة وإعادة تشغيل مجدولة.'
        : 'Isolated runtime blueprint for Discord.js v14 bots with AES-256-GCM encrypted token storage and cron health restarts.',
    },
    {
      code: 'TELEGRAM_BOT',
      title: isRtl
        ? 'معمارية بوت Telegram التفاعلي (Python 3.12)'
        : 'Async Telegram Bot Architecture (Python 3.12)',
      runtime: 'PYTHON v3.12',
      entrypoint: 'python main.py',
      envKeys: ['TELEGRAM_BOT_TOKEN', 'WEBHOOK_SECRET', 'REDIS_URL'],
      desc: isRtl
        ? 'بيئة مهيأة لبوتات Aiogram وpython-telegram-bot مع طرفية WebSocket مباشرة لفحص السجلات.'
        : 'Pre-configured Python 3.12 runtime for Aiogram and Telebot workloads with live stdout/stderr streaming.',
    },
    {
      code: 'JAVA_APP',
      title: isRtl
        ? 'معمارية بوتات JDA والخدمات الخلفية (Java 21)'
        : 'JDA Sharded Bot & JVM Service (Java 21)',
      runtime: 'JAVA v21',
      entrypoint: 'java -Xms128M -Xmx512M -jar app.jar',
      envKeys: ['BOT_TOKEN', 'JVM_OPTS'],
      desc: isRtl
        ? 'حاوية JVM مضبوطة الذاكرة لتشغيل تطبيقات Java 21 وبوتات JDA عالية الأداء.'
        : 'Memory-bounded JVM container specification for Java 21 JAR workloads and JDA bots.',
    },
    {
      code: 'RUST_GO',
      title: isRtl
        ? 'معمارية الخدمات عالية الأداء (Go 1.23 & Rust 1.82)'
        : 'Low-Latency Bot Workers (Go 1.23 & Rust 1.82)',
      runtime: 'GO v1.23 / RUST v1.82',
      entrypoint: './target/release/bot',
      envKeys: ['DISCORD_TOKEN', 'RUST_LOG'],
      desc: isRtl
        ? 'تشغيل الملفات التنفيذية المترجمة بلغات Go وRust بأقل استهلاك ممكن للذاكرة والمعالج.'
        : 'Native binary execution blueprint for Serenity/Twilight (Rust) and DiscordGo workloads.',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-12">
      <div className="max-w-3xl space-y-3">
        <div className="text-xs font-semibold text-violet-400">
          HyperHost — Powered by HyperSoft
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-white">
          {t.navProjects}
        </h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          {isRtl
            ? 'نماذج ومعماريات المشاريع المدعومة فعلياً داخل منصة HyperHost مع أوامر التشغيل ومتغيرات البيئة القياسية.'
            : 'Production workload blueprints supported by the HyperHost Runtime Catalog, including standard entrypoints and secret vault schemas.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {blueprints.map((bp) => (
          <div
            key={bp.code}
            className="p-6 rounded-2xl bg-[#101220] border border-slate-800 space-y-4 flex flex-col justify-between"
          >
            <div className="space-y-2.5">
              <div className="text-xs font-mono text-violet-400" dir="ltr">
                {bp.runtime}
              </div>
              <h2 className="text-lg font-bold text-white">{bp.title}</h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                {bp.desc}
              </p>
            </div>

            <div className="pt-4 border-t border-slate-800/80 space-y-2 text-xs font-mono" dir="ltr">
              <div className="text-slate-300">
                <span className="text-slate-500">Entrypoint:</span> {bp.entrypoint}
              </div>
              <div className="text-slate-400">
                <span className="text-slate-500">Vault Keys:</span>{' '}
                {bp.envKeys.join(', ')}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-start">
        {user ? (
          <button
            type="button"
            onClick={onOpenDashboard}
            className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
          >
            {t.openDashboard}
          </button>
        ) : (
          <button
            type="button"
            onClick={onLogin}
            className="px-5 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            <DiscordIcon className="w-4 h-4" />
            <span>{t.loginWithDiscord}</span>
          </button>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * 4. ABOUT PAGE (/about)
 * ========================================================================== */
const AboutPageContent: React.FC<{
  onNavigate: (path: string) => void;
}> = ({ onNavigate }) => {
  const { t, isRtl } = useI18n();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-10">
      <div className="flex items-center gap-4">
        <img
          src="/assets/Logo.png"
          alt="HyperHost"
          referrerPolicy="no-referrer"
          className="w-14 h-14 rounded-2xl bg-[#131629] border border-violet-500/30 p-2 object-contain"
        />
        <div>
          <h1 className="text-3xl font-bold text-white">{t.navAbout}</h1>
          <p className="text-xs text-violet-300">
            HyperHost — Powered by HyperSoft
          </p>
        </div>
      </div>

      <div className="p-6 sm:p-8 rounded-2xl bg-[#101220] border border-slate-800 space-y-5 text-sm text-slate-300 leading-relaxed">
        <p>
          {isRtl
            ? 'تم تطوير منصة HyperHost بواسطة فريق HyperSoft لتقديم بيئة سحابية احترافية ومؤمّنة لاستضافة وإدارة بوتات Discord وTelegram والتطبيقات الخلفية بلغات Node.js وPython وJava وGo وRust.'
            : 'HyperHost is engineered by HyperSoft to provide a secure, transparent cloud control plane for hosting and operating Discord bots, Telegram bots, and polyglot backend applications in Node.js, Python, Java, Go, and Rust.'}
        </p>
        <p>
          {isRtl
            ? 'تعتمد المنصة على مبدأ الفصل الهندسي الصارم بين طبقة التحكم (Control Plane) المبنية على Fastify وTypeScript وPrisma وPostgreSQL، وطبقة التشغيل (Runtime Plane) المسؤولة عن تشغيل الحاويات المعزولة. يضمن هذا التصميم عدم تشغيل أي كود غير موثوق داخل خادم الويب الأساسي.'
            : 'Our architecture enforces strict isolation between the Control Plane (Fastify, TypeScript, Prisma, PostgreSQL) and the Runtime Plane (isolated container execution nodes). Untrusted user code is never executed on the Control Plane host.'}
        </p>
        <p>
          {isRtl
            ? 'نلتزم بالشفافية الكاملة في عرض حالة الخدمة: لا تعرض المنصة أي أرقام أو إحصائيات وهمية، وتُشفّر جميع الأسرار وتوكنات البوتات بمعيار AES-256-GCM قبل حفظها في قاعدة البيانات.'
            : 'We adhere to strict engineering transparency: HyperHost never fabricates uptime metrics or fake server telemetry, and encrypts all environment secrets at rest using AES-256-GCM.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => onNavigate('/terms')}
          className="px-4 py-2.5 rounded-xl bg-[#121424] hover:bg-[#191C32] border border-slate-800 text-slate-200 cursor-pointer"
        >
          {t.navTerms}
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/privacy')}
          className="px-4 py-2.5 rounded-xl bg-[#121424] hover:bg-[#191C32] border border-slate-800 text-slate-200 cursor-pointer"
        >
          {t.navPrivacy}
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/contact')}
          className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold cursor-pointer"
        >
          {t.navContact}
        </button>
      </div>
    </div>
  );
};

/* ============================================================================
 * 5. CONTACT PAGE (/contact)
 * ========================================================================== */
const ContactPageContent: React.FC = () => {
  const { t, isRtl } = useI18n();
  const [subject, setSubject] = useState('');
  const [discordHandle, setDiscordHandle] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setSubmitted(true);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-10">
      <div className="space-y-2">
        <div className="text-xs font-semibold text-violet-400">
          HyperHost — Powered by HyperSoft
        </div>
        <h1 className="text-3xl font-bold text-white">{t.navContact}</h1>
        <p className="text-sm text-slate-400">
          {isRtl
            ? 'تواصل مع فريق HyperSoft للدعم الفني، أو الاستفسارات الأمنية، أو إدارة الحسابات.'
            : 'Connect with the HyperSoft team for technical support, security reporting, or account inquiries.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <div className="md:col-span-5 space-y-4">
          <div className="p-6 rounded-2xl bg-[#101220] border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <MessageSquare className="w-4 h-4 text-violet-400" />
              <span>
                {isRtl ? 'مجتمع ودعم HyperSoft الرسمي' : 'Official HyperSoft Discord'}
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isRtl
                ? 'القناة الرسمية الأسرع للحصول على المساعدة التقنية والتحديثات المباشرة لمنصة HyperHost.'
                : 'Join our official Discord server for direct technical assistance and platform announcements.'}
            </p>
            <a
              href="https://discord.gg/b3VwbVhwvU"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold transition-colors"
            >
              <DiscordIcon className="w-4 h-4" />
              <span>https://discord.gg/b3VwbVhwvU</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="p-6 rounded-2xl bg-[#101220] border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Mail className="w-4 h-4 text-violet-400" />
              <span>
                {isRtl ? 'البلاغات الأمنية والخصوصية' : 'Security & Privacy Inquiries'}
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isRtl
                ? 'للبلاغات الأمنية أو طلبات مراجعة بيانات الحساب، يرجى فتح تذكرة رسمية داخل سيرفر HyperSoft مع تزويد معرّف المستخدم العام (usr_...).'
                : 'For security disclosures or account data requests, open an official support ticket in the HyperSoft Discord server referencing your Public User ID (usr_...).'}
            </p>
          </div>
        </div>

        <div className="md:col-span-7">
          <div className="p-6 sm:p-8 rounded-2xl bg-[#101220] border border-slate-800 space-y-5">
            <h2 className="text-base font-bold text-white">
              {isRtl ? 'إرسال رسالة أو استفسار' : 'Prepare Support Inquiry'}
            </h2>

            {submitted ? (
              <div className="p-5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 space-y-3 text-xs text-emerald-200">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>
                    {isRtl
                      ? 'تم تجهيز تفاصيل طلبك بنجاح'
                      : 'Your inquiry details are ready'}
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {isRtl
                    ? 'يرجى الانضمام إلى سيرفر HyperSoft الرسمي على Discord ومشاركة هذا الملخص مع فريق الدعم للمتابعة الفورية.'
                    : 'Please join the official HyperSoft Discord server to submit this ticket directly to our support engineers.'}
                </p>
                <div className="flex items-center gap-3 pt-1">
                  <a
                    href="https://discord.gg/b3VwbVhwvU"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-lg bg-[#5865F2] text-white font-semibold inline-flex items-center gap-1.5"
                  >
                    <span>
                      {isRtl ? 'فتح سيرفر HyperSoft' : 'Open HyperSoft Discord'}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setSubmitted(false);
                      setSubject('');
                      setMessage('');
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 cursor-pointer"
                  >
                    {isRtl ? 'رسالة جديدة' : 'New Inquiry'}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    {isRtl ? 'حساب Discord أو المعرّف العام (usr_...)' : 'Discord Username or Public User ID (usr_...)'}
                  </label>
                  <input
                    type="text"
                    required
                    value={discordHandle}
                    onChange={(e) => setDiscordHandle(e.target.value)}
                    placeholder="username / usr_..."
                    dir="ltr"
                    className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#080911] border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    {isRtl ? 'موضوع الرسالة' : 'Subject'}
                  </label>
                  <input
                    type="text"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={
                      isRtl
                        ? 'مثال: استفسار حول إعدادات الاستضافة'
                        : 'e.g. Host runtime configuration inquiry'
                    }
                    className="w-full px-3.5 py-2.5 text-xs bg-[#080911] border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    {isRtl ? 'تفاصيل الاستفسار' : 'Message'}
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={
                      isRtl
                        ? 'اكتب تفاصيل استفسارك هنا (لا تشارك أي كلمات مرور أو توكنات سرية)...'
                        : 'Describe your request (never include secret tokens or passwords)...'
                    }
                    className="w-full px-3.5 py-2.5 text-xs bg-[#080911] border border-slate-800 rounded-xl text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
                >
                  {isRtl ? 'متابعة التواصل' : 'Continue'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 6. TERMS OF SERVICE (/terms) — All 17 Required Sections
 * ========================================================================== */
const TermsPageContent: React.FC = () => {
  const { isRtl } = useI18n();

  const sections = isRtl
    ? [
        {
          title: '1. قبول الشروط',
          body: 'بمجرد الوصول إلى منصة HyperHost (Powered by HyperSoft) أو تسجيل الدخول إليها واستخدام خدماتها، فإنك توافق على الالتزام الكامل بشروط الاستخدام هذه. إذا كنت لا توافق على أي جزء من هذه الشروط، يرجى التوقف عن استخدام المنصة فوراً.',
        },
        {
          title: '2. وصف الخدمة',
          body: 'توفر HyperHost لوحة تحكم سحابية (Control Plane) لإدارة وتكوين استضافات البوتات والتطبيقات البرمجية (Discord Bots, Telegram Bots, Node.js, Python, Java, Go, Rust) المرتبطة بطبقة التشغيل المعزولة (Runtime Plane).',
        },
        {
          title: '3. حسابات المستخدمين',
          body: 'يُمنح كل مستخدم معرّفاً عاماً فريداً وغير تسلسلي (usr_...) ويحق له إنشاء وإدارة ما يصل إلى 10 استضافات كحد أقصى لكل حساب، ما لم تقرر إدارة المنصة خلاف ذلك.',
        },
        {
          title: '4. تسجيل الدخول عبر Discord',
          body: 'تعتمد المنصة على بروتوكول Discord OAuth2 الرسمي للمصادقة. أنت مسؤول عن الحفاظ على أمان حساب Discord الخاص بك وأي جلسات نشطة مرتبطة به.',
        },
        {
          title: '5. مسؤولية المستخدم عن المحتوى والبرامج التي يرفعها',
          body: 'يتحمل المستخدم المسؤولية الكاملة والحصرية عن جميع الأكواد البرمجية، والملفات، ومتغيرات البيئة، والتوكنات، والبيانات التي يقوم بإدخالها أو تشغيلها عبر استضافاته.',
        },
        {
          title: '6. الاستخدامات المحظورة',
          body: 'يُحظر تماماً استخدام المنصة لتشغيل أي برمجيات خبيثة، أو هجمات حجب الخدمة (DDoS)، أو التعدين غير المصرح به، أو البريد العشوائي (Spam)، أو انتهاك شروط خدمة Discord أو Telegram، أو أي نشاط غير مشروع.',
        },
        {
          title: '7. إساءة استخدام الموارد',
          body: 'يُمنع التحايل على حدود المعالج (CPU) أو الذاكرة (RAM) أو مساحة التخزين (Disk) أو منافذ الشبكة المخصصة للاستضافة، أو محاولة التأثير على استقرار العقد أو المستخدمين الآخرين.',
        },
        {
          title: '8. الأمن والحماية',
          body: 'يُحظر إجراء أي محاولات اختراق، أو فحص ثغرات غير مصرح به، أو محاولة الوصول إلى استضافات أو بيانات مستخدمين آخرين، أو التلاعب بآليات حماية الجلسات ورموز CSRF.',
        },
        {
          title: '9. الاستضافة والموارد',
          body: 'تخضع كل استضافة للحدود التقنية المحددة لها عند الإنشاء. يعتمد التنفيذ الفعلي للحاويات على اتصال عقدة التشغيل (Runtime Node) المرتبطة بالاستضافة.',
        },
        {
          title: '10. الإيقاف أو التعليق',
          body: 'تحتفظ إدارة HyperHost بالحق في تعليق أو إيقاف أو حذف أي استضافة أو حساب مستخدم يخالف هذه الشروط أو يشكل خطراً أمنياً أو تشغيلياً على المنصة دون إشعار مسبق.',
        },
        {
          title: '11. النسخ الاحتياطية والبيانات',
          body: 'رغم توفير أدوات لإدارة النسخ الاحتياطية، يظل المستخدم مسؤولاً عن الاحتفاظ بنسخ احتياطية خارجية لأكواده البرمجية وبياناته المهمة.',
        },
        {
          title: '12. توفر الخدمة',
          body: 'تُقدم خدمات HyperHost "كما هي" وحسب التوفر الفعلي للبنية التحتية وعقد التشغيل، دون تقديم أي وعود أو ضمانات بنسبة توافر مطلقة (No Guaranteed SLA) أو خلو الخدمة من الانقطاعات الطارئة أو أعمال الصيانة.',
        },
        {
          title: '13. الملكية الفكرية',
          body: 'جميع حقوق العلامة التجارية HyperHost وHyperSoft والشعار الرسمي (Logo.png) وتصميم لوحة التحكم والأنظمة البرمجية الخاصة بالمنصة محفوظة لصالح HyperSoft. يحتفظ المستخدم بملكية الأكواد الخاصة بمشاريعه.',
        },
        {
          title: '14. تحديد المسؤولية',
          body: 'لا تتحمل HyperHost أو HyperSoft أي مسؤولية عن أي أضرار مباشرة أو غير مباشرة، أو فقدان للبيانات، أو توقف للبوتات أو الأعمال ناتج عن استخدام المنصة أو توقفها.',
        },
        {
          title: '15. التعديلات على الخدمة',
          body: 'يحق لـ HyperSoft تحديث أو تعديل ميزات المنصة أو حدود الاستخدام أو شروط الاستخدام هذه في أي وقت، ويُعد استمرارك في استخدام المنصة بعد التحديث موافقة على الشروط المعدلة.',
        },
        {
          title: '16. التواصل',
          body: 'لأي استفسارات متعلقة بشروط الاستخدام، يمكن التواصل مباشرة مع فريق HyperSoft عبر صفحة "تواصل معنا" أو عبر سيرفر Discord الرسمي: https://discord.gg/b3VwbVhwvU.',
        },
        {
          title: '17. القانون والسياسات المطبقة',
          body: 'تخضع هذه الشروط للسياسات التشغيلية والأمنية المعتمدة لدى HyperSoft ولمعايير الاستخدام الآمن للخدمات السحابية ومنصات Discord وTelegram.',
        },
      ]
    : [
        {
          title: '1. Acceptance of Terms',
          body: 'By accessing, authenticating with, or using HyperHost (Powered by HyperSoft), you agree to be bound by these Terms of Service. If you do not agree with any provision, you must discontinue use of the platform immediately.',
        },
        {
          title: '2. Service Description',
          body: 'HyperHost provides a cloud Control Plane for configuring and managing application and bot Hosts (Discord Bots, Telegram Bots, Node.js, Python, Java, Go, Rust) that interface with isolated Runtime Plane nodes.',
        },
        {
          title: '3. User Accounts',
          body: 'Each authenticated user is assigned a unique, non-sequential Public User ID (usr_...) and may provision up to a maximum quota of 10 Hosts per account unless otherwise adjusted by platform administrators.',
        },
        {
          title: '4. Discord Authentication',
          body: 'Authentication is performed exclusively through the official Discord OAuth2 authorization flow. You are responsible for maintaining the security of your Discord account and active sessions.',
        },
        {
          title: '5. User Responsibility for Uploaded Content & Code',
          body: 'You retain sole responsibility for all source code, binaries, files, bot tokens, environment variables, and content deployed or stored within your Hosts.',
        },
        {
          title: '6. Prohibited Uses',
          body: 'You may not use HyperHost to distribute malware, conduct denial-of-service (DDoS) attacks, perform unauthorized cryptocurrency mining, send spam, violate Discord or Telegram terms of service, or engage in unlawful activities.',
        },
        {
          title: '7. Resource Abuse',
          body: 'Circumventing allocated CPU, memory, disk, or network port limits, or attempting to degrade the stability of Runtime Nodes or other tenants, is strictly prohibited.',
        },
        {
          title: '8. Security & Protection',
          body: 'Unauthorized vulnerability scanning, path traversal attempts, privilege escalation, or interference with session cookies, CSRF tokens, or API endpoints is strictly forbidden.',
        },
        {
          title: '9. Hosting & Resource Quotas',
          body: 'Each Host operates within its configured CPU, RAM, and NVMe disk allocations. Live container execution depends on the availability and connection of an assigned Runtime Node.',
        },
        {
          title: '10. Suspension or Termination',
          body: 'HyperHost administrators reserve the right to suspend, restrict, or terminate any Host or user account that violates these Terms or poses an operational or security risk.',
        },
        {
          title: '11. Backups & Data',
          body: 'While HyperHost provides backup management abstractions, users remain responsible for maintaining independent off-platform copies of their critical code and configuration data.',
        },
        {
          title: '12. Service Availability',
          body: 'HyperHost is provided on an "AS IS" and "AS AVAILABLE" basis without any guaranteed uptime percentage or formal SLA. Maintenance windows or runtime node disconnections may occur.',
        },
        {
          title: '13. Intellectual Property',
          body: 'The HyperHost and HyperSoft names, official logo (Logo.png), control plane software, and interface design are the property of HyperSoft. Users retain ownership of their deployed bot code.',
        },
        {
          title: '14. Limitation of Liability',
          body: 'To the maximum extent permitted, HyperHost and HyperSoft shall not be liable for any indirect, incidental, or consequential damages, data loss, or bot downtime arising from platform use.',
        },
        {
          title: '15. Modifications to the Service',
          body: 'HyperSoft may update platform features, account quotas, or these Terms of Service at any time. Continued use of HyperHost constitutes acceptance of the updated Terms.',
        },
        {
          title: '16. Contact Information',
          body: 'For questions regarding these Terms, contact HyperSoft via the Contact page or our official Discord server at https://discord.gg/b3VwbVhwvU.',
        },
        {
          title: '17. Applicable Policies & Governance',
          body: 'Use of HyperHost is governed by HyperSoft operational security policies, acceptable cloud usage standards, and the developer terms of the platforms your bots connect to.',
        },
      ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-8">
      <div className="space-y-2 border-b border-slate-800 pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-400">
          <Scale className="w-4 h-4" />
          <span>HyperHost — Powered by HyperSoft</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-white">
          {isRtl ? 'شروط الاستخدام' : 'Terms of Service'}
        </h1>
        <p className="text-xs text-slate-400">
          {isRtl
            ? 'آخر تحديث: 2 تشرين الأول (أكتوبر) 2026'
            : 'Last Updated: October 2, 2026'}
        </p>
      </div>

      <div className="space-y-4">
        {sections.map((sec) => (
          <section
            key={sec.title}
            className="p-6 rounded-2xl bg-[#101220] border border-slate-800 space-y-2"
          >
            <h2 className="text-base font-bold text-white">{sec.title}</h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {sec.body}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
};

/* ============================================================================
 * 7. PRIVACY POLICY (/privacy) — Transparent & Exact Data Processing Disclosure
 * ========================================================================== */
const PrivacyPageContent: React.FC = () => {
  const { isRtl } = useI18n();

  const sections = isRtl
    ? [
        {
          title: '1. نظرة عامة والشفافية',
          body: 'تلتزم منصة HyperHost (Powered by HyperSoft) بحماية خصوصية المستخدمين وبياناتهم. توضح سياسة الخصوصية هذه بدقة البيانات الفعلية التي يعالجها النظام ويخزنها في قاعدة بيانات PostgreSQL، دون جمع أي بيانات خفية غير مذكورة.',
        },
        {
          title: '2. البيانات التي تتم معالجتها وتخزينها فعلياً',
          body: 'عند استخدامك لمنصة HyperHost، يعالج النظام الفئات التالية من البيانات فقط:\n• معرّف مستخدم Discord (Discord User ID) والمعرّف العام غير التسلسلي في المنصة (usr_...).\n• اسم مستخدم Discord (username)، والاسم المعروض (displayName / global_name)، وصورة الحساب (avatar URL)، والبريد الإلكتروني (email) في حال وفّره نطاق OAuth2.\n• رموز مصادقة Discord OAuth2 (Access Token / Refresh Token) وتُحفظ مشفّرة بالكامل بمعيار AES-256-GCM.\n• بيانات الجلسات (Session Information): تشمل تجزئة رمز الجلسة (HMAC-SHA256 tokenHash)، ورمز الحماية CSRF، وتاريخ الإنشاء والانتهاء.\n• عنوان البروتوكول (IP Address) ومعلومات المتصفح (Browser / User-Agent): يتم تسجيلها فعلياً عند إنشاء الجلسة وفي سجلات النشاط والتدقيق الأمني (ActivityLog).\n• بيانات الاستضافات (Host Metadata): تشمل اسم الاستضافة، والمعرّف العام (srv_...)، ونوع البيئة، وحدود الموارد، ومتغيرات البيئة المشفرة بمعيار AES-256-GCM.\n• سجلات النشاط والأمان (Activity & Security Logs): توثق العمليات المنفذة (مثل تسجيل الدخول، إنشاء استضافة، تعديل الإعدادات) بعد تنقيتها تلقائياً من أي كلمات مرور أو مفاتيح سرية.',
        },
        {
          title: '3. لماذا يتم جمع هذه البيانات وكيف يتم استخدامها',
          body: 'تُستخدم هذه البيانات حصرياً لـ:\n• التحقق من هوية المستخدم عبر Discord OAuth2 وإدارة الجلسات الآمنة.\n• إرسال إشعارات الأمان عبر الرسائل الخاصة في Discord (مثل إشعار تسجيل الدخول وإشعار إنشاء الاستضافة).\n• تشغيل وإدارة الاستضافات والصلاحيات المشتركة بين المتعاونين.\n• حماية المنصة من الاستخدام غير المصرح به وهجمات تزوير الطلبات (CSRF) ومراجعة سجلات التدقيق.',
        },
        {
          title: '4. كيف يتم حماية البيانات والتشفير',
          body: 'يطبق النظام معايير حماية صارمة:\n• تشفير جميع الأسرار ومتغيرات البيئة وتوكنات OAuth في حالة السكون (Encryption at Rest) باستخدام خوارزمية AES-256-GCM.\n• تخزين رموز الجلسات وعقد التشغيل كقيم مجزأة غير قابلة للعكس (HMAC-SHA256) وليس كنص صريح.\n• استخدام كوكيز محمية بخصائص HttpOnly وSameSite وSecure في بيئة الإنتاج.\n• تنقية سجلات النشاط والـ Logs تلقائياً لمنع تسجيل أي كلمات مرور أو توكنات أو روابط قواعد بيانات.',
        },
        {
          title: '5. مدة الاحتفاظ بالبيانات',
          body: 'تنتهي صلاحية جلسات تسجيل الدخول تلقائياً بعد 14 يوماً ما لم يتم تسجيل الخروج أو إلغاء الجلسة مبكراً. وتبقى بيانات الحساب والاستضافات محفوظة طالما كان الحساب نشطاً أو حتى يقوم المستخدم بحذف الاستضافة أو طلب إزالة حسابه.',
        },
        {
          title: '6. حقوق المستخدم',
          body: 'يحق للمستخدم في أي وقت:\n• عرض بيانات حسابه ومعرّفه العام (usr_...) وسجل نشاطاته.\n• تعديل أو حذف أي استضافة يملكها أو حذف متغيرات البيئة المرتبطة بها.\n• إنهاء الجلسة النشطة عبر تسجيل الخروج.\n• التواصل مع إدارة HyperSoft لطلب مراجعة أو حذف بيانات حسابه.',
        },
        {
          title: '7. التواصل بخصوص الخصوصية',
          body: 'لأي استفسار أو طلب يتعلق بسياسة الخصوصية وحماية البيانات، يرجى التواصل عبر صفحة "تواصل معنا" أو عبر سيرفر HyperSoft الرسمي على Discord: https://discord.gg/b3VwbVhwvU.',
        },
      ]
    : [
        {
          title: '1. Overview & Transparency Commitment',
          body: 'HyperHost (Powered by HyperSoft) is committed to transparent data handling. This Privacy Policy documents the exact categories of data processed and stored by our PostgreSQL database—we never claim or collect hidden telemetry.',
        },
        {
          title: '2. Data Processed by HyperHost',
          body: 'When you authenticate and use HyperHost, our backend processes the following specific data:\n• Discord User ID (discordId) and your non-sequential HyperHost Public User ID (usr_...).\n• Discord username, display name (global_name), avatar URL, and email address (when provided by the Discord OAuth2 identify/email scopes).\n• Discord OAuth2 tokens (access/refresh tokens), which are encrypted at rest using AES-256-GCM.\n• Session Information: HMAC-SHA256 hashed session token (tokenHash), CSRF protection token, creation time, expiration timestamp, and revocation timestamp.\n• IP Address and Browser / User-Agent: Recorded on active Session records and ActivityLog security audit entries.\n• Host Metadata: Host name, non-sequential Server ID (srv_...), runtime configuration, resource limits, and AES-256-GCM encrypted environment variables.\n• Activity & Security Logs: Timestamped audit records of account and Host actions, automatically sanitized to strip secrets, tokens, and passwords.',
        },
        {
          title: '3. Why We Collect Data & How It Is Used',
          body: 'This information is used strictly to:\n• Authenticate your identity via Discord OAuth2 and maintain secure sessions.\n• Deliver optional security notifications via Discord DM (login confirmation and Host creation notifications).\n• Provision, configure, and authorize access to your Hosts and collaborator permissions.\n• Protect the platform against CSRF, unauthorized access, and abuse.',
        },
        {
          title: '4. Data Protection & Encryption Architecture',
          body: 'HyperHost enforces defense-in-depth security controls:\n• AES-256-GCM encryption at rest for all Host environment variables, database user passwords, and OAuth tokens.\n• HMAC-SHA256 hashing for session tokens and Runtime Node daemon tokens.\n• HttpOnly, SameSite, and Secure cookie attributes in production.\n• Automated log and metadata redaction ensuring secrets are never written to ActivityLog or stdout logs.',
        },
        {
          title: '5. Data Retention',
          body: 'Authenticated sessions automatically expire after 14 days unless signed out or revoked earlier. Host records and encrypted environment variables remain stored until deleted by the Host owner or upon account deletion request.',
        },
        {
          title: '6. Your Rights',
          body: 'You have the right to inspect your account profile, Public User ID, and activity logs; modify or permanently delete your Hosts and environment secrets; sign out to revoke your active session; and request account data removal through HyperSoft support.',
        },
        {
          title: '7. Contact Information',
          body: 'For privacy inquiries or data requests, contact HyperSoft via the Contact page or our official Discord community at https://discord.gg/b3VwbVhwvU.',
        },
      ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-8">
      <div className="space-y-2 border-b border-slate-800 pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-400">
          <FileText className="w-4 h-4" />
          <span>HyperHost — Powered by HyperSoft</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-white">
          {isRtl ? 'سياسة الخصوصية' : 'Privacy Policy'}
        </h1>
        <p className="text-xs text-slate-400">
          {isRtl
            ? 'آخر تحديث: 2 تشرين الأول (أكتوبر) 2026'
            : 'Last Updated: October 2, 2026'}
        </p>
      </div>

      <div className="space-y-4">
        {sections.map((sec) => (
          <section
            key={sec.title}
            className="p-6 rounded-2xl bg-[#101220] border border-slate-800 space-y-2"
          >
            <h2 className="text-base font-bold text-white">{sec.title}</h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed whitespace-pre-line">
              {sec.body}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
};
