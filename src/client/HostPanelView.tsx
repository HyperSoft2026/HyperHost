import React, { useEffect, useRef, useState } from 'react';
import {
  Terminal,
  FolderOpen,
  Cpu,
  Network,
  Activity,
  Power,
  Database,
  Clock,
  HardDrive,
  Shield,
  Users,
  Settings,
  History,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  Copy,
  Check,
} from 'lucide-react';
import {
  HOST_PERMISSIONS,
  RUNTIME_CATALOG,
  type HostPermissionScope,
  type HostRuntimeCode,
} from '../shared/types';
import { apiFetch, ClientApiError } from './api';
import { useI18n } from './i18n';

export type HostPanelTab =
  | 'console'
  | 'files'
  | 'startup'
  | 'network'
  | 'metrics'
  | 'management'
  | 'databases'
  | 'schedules'
  | 'backups'
  | 'administration'
  | 'users'
  | 'settings'
  | 'activity';

interface HostPanelViewProps {
  hostId: string;
  onBack: () => void;
  onHostDeleted: () => void;
}

interface ConsoleFrame {
  id: string;
  type: 'stdout' | 'stderr' | 'status' | 'system';
  message: string;
  timestamp: string;
}

export const HostPanelView: React.FC<HostPanelViewProps> = ({
  hostId,
  onBack,
  onHostDeleted,
}) => {
  const { t, isRtl, locale } = useI18n();
  const [activeTab, setActiveTab] = useState<HostPanelTab>('console');
  const [hostData, setHostData] = useState<any | null>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);

  // Console WebSocket State
  const wsRef = useRef<WebSocket | null>(null);
  const [wsState, setWsState] = useState<
    'CONNECTING' | 'CONNECTED' | 'RUNTIME_NODE_UNAVAILABLE' | 'DISCONNECTED'
  >('RUNTIME_NODE_UNAVAILABLE');
  const [consoleFrames, setConsoleFrames] = useState<ConsoleFrame[]>([]);
  const [consoleInput, setConsoleInput] = useState('');

  // Files State
  const [currentPath, setCurrentPath] = useState('/');
  const [fileEntries, setFileEntries] = useState<any[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');

  // Startup State
  const [startupRuntime, setStartupRuntime] = useState<HostRuntimeCode>('NODEJS');
  const [startupVersion, setStartupVersion] = useState('22');
  const [startupCommand, setStartupCommand] = useState('node index.js');
  const [startupArgs, setStartupArgs] = useState('');
  const [workingDir, setWorkingDir] = useState('/home/container');
  const [envVars, setEnvVars] = useState<
    Array<{ key: string; value: string; isSecret: boolean; description?: string | null }>
  >([]);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');
  const [newEnvSecret, setNewEnvSecret] = useState(true);

  // Network State
  const [allocations, setAllocations] = useState<any[]>([]);
  const [availablePool, setAvailablePool] = useState<any[]>([]);

  // Metrics State
  const [metricsState, setMetricsState] = useState<{
    available: boolean;
    message: string;
    metrics: any | null;
  }>({
    available: false,
    message: 'No metrics available',
    metrics: null,
  });

  // Databases State
  const [databases, setDatabases] = useState<any[]>([]);
  const [dbName, setDbName] = useState('');
  const [dbEngine, setDbEngine] = useState<'POSTGRESQL' | 'MYSQL' | 'MONGODB' | 'REDIS'>('POSTGRESQL');

  // Schedules State
  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedName, setSchedName] = useState('');
  const [schedCron, setSchedCron] = useState('0 */24 * * *');
  const [schedTask, setSchedTask] = useState<
    'POWER_RESTART' | 'POWER_START' | 'POWER_STOP' | 'EXECUTE_COMMAND' | 'CREATE_BACKUP'
  >('POWER_RESTART');
  const [schedPayload, setSchedPayload] = useState('');

  // Backups State
  const [backups, setBackups] = useState<any[]>([]);
  const [backupName, setBackupName] = useState('');

  // Users / Permissions State
  const [collaborators, setCollaborators] = useState<any[]>([]);
  const [collabDiscordId, setCollabDiscordId] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<HostPermissionScope[]>([
    'console.read',
    'metrics.read',
    'activity.read',
  ]);

  // Settings State
  const [settingsName, setSettingsName] = useState('');
  const [settingsDesc, setSettingsDesc] = useState('');

  // Activity Log State
  const [activityLogs, setActivityLogs] = useState<any[]>([]);

  useEffect(() => {
    if (hostId) {
      void loadHostDetail();
    }
  }, [hostId]);

  useEffect(() => {
    if (!hostId || !hostData) return;
    if (
      ![
        'PENDING',
        'PROVISIONING',
        'BOOTSTRAPPING',
        'NODE_CONNECTING',
        'NODE_ONLINE',
        'STARTING',
      ].includes(hostData.status)
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadHostDetail();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hostId, hostData?.status]);

  useEffect(() => {
    if (activeTab === 'console') {
      connectConsoleWebSocket();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [activeTab, hostId, locale]);

  useEffect(() => {
    if (!hostId) return;
    void loadTabResource(activeTab);
  }, [activeTab, hostId]);

  async function loadHostDetail() {
    if (!hostId) return;
    setLoading(true);
    setPanelError(null);
    try {
      const res = await apiFetch<{ host: any; access: any }>(`/api/hosts/${hostId}`);
      setHostData(res.host);
      setSettingsName(res.host.name);
      setSettingsDesc(res.host.description || '');
      setStartupRuntime(res.host.runtime);
      setStartupVersion(res.host.runtimeVersion);
      setStartupCommand(res.host.startupCommand);
      setStartupArgs((res.host.startupArgs || []).join(' '));
      setWorkingDir(res.host.workingDirectory);
    } catch (err) {
      if (err instanceof ClientApiError) {
        setPanelError(`[${err.code}] ${err.message}`);
      } else {
        setPanelError('Failed to load Host metadata.');
      }
    } finally {
      setLoading(false);
    }
  }

  function connectConsoleWebSocket() {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (!hostId) {
      setWsState('RUNTIME_NODE_UNAVAILABLE');
      setConsoleFrames([]);
      return;
    }

    setWsState('CONNECTING');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/hosts/${hostId}/console/ws?locale=${encodeURIComponent(locale)}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'status' && msg.state === 'RUNTIME_NODE_UNAVAILABLE') {
          setWsState('RUNTIME_NODE_UNAVAILABLE');
          return;
        }
        if (msg.type === 'status' && msg.state === 'CONNECTED') {
          setWsState('CONNECTED');
        }
        setConsoleFrames((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            type: msg.type || 'stdout',
            message: msg.message || msg.data || '',
            timestamp: msg.timestamp || new Date().toISOString(),
          },
        ]);
      } catch {
        // Ignore malformed frame
      }
    };

    socket.onerror = () => {
      setWsState('RUNTIME_NODE_UNAVAILABLE');
    };

    socket.onclose = () => {
      setWsState((prev) =>
        prev === 'RUNTIME_NODE_UNAVAILABLE' ? 'RUNTIME_NODE_UNAVAILABLE' : 'DISCONNECTED'
      );
    };
  }

  async function loadTabResource(tab: HostPanelTab) {
    if (!hostId) return;
    setPanelError(null);
    try {
      if (tab === 'files') {
        setFileError(null);
        try {
          const data = await apiFetch<{ entries: any[] }>(
            `/api/hosts/${hostId}/files?path=${encodeURIComponent(currentPath)}`
          );
          setFileEntries(data.entries);
        } catch (err) {
          if (err instanceof ClientApiError) {
            setFileError(`[${err.code}] ${err.message}`);
          }
          setFileEntries([]);
        }
      } else if (tab === 'startup') {
        const data = await apiFetch<any>(`/api/hosts/${hostId}/startup`);
        setStartupRuntime(data.runtime);
        setStartupVersion(data.runtimeVersion);
        setStartupCommand(data.startupCommand);
        setStartupArgs((data.startupArgs || []).join(' '));
        setWorkingDir(data.workingDirectory);
        setEnvVars(data.environmentVariables || []);
      } else if (tab === 'network') {
        const data = await apiFetch<any>(`/api/hosts/${hostId}/network`);
        setAllocations(data.allocations || []);
        setAvailablePool(data.availablePool || []);
      } else if (tab === 'metrics') {
        const data = await apiFetch<any>(`/api/hosts/${hostId}/metrics`);
        setMetricsState({
          available: data.available,
          message: data.message || 'No metrics available',
          metrics: data.metrics,
        });
      } else if (tab === 'databases') {
        const data = await apiFetch<any>(`/api/hosts/${hostId}/databases`);
        setDatabases(data.databases || []);
      } else if (tab === 'schedules') {
        const data = await apiFetch<any>(`/api/hosts/${hostId}/schedules`);
        setSchedules(data.schedules || []);
      } else if (tab === 'backups') {
        const data = await apiFetch<any>(`/api/hosts/${hostId}/backups`);
        setBackups(data.backups || []);
      } else if (tab === 'users' || tab === 'administration') {
        const data = await apiFetch<any>(`/api/hosts/${hostId}/users`);
        setCollaborators(data.collaborators || []);
      } else if (tab === 'activity') {
        const data = await apiFetch<any>(`/api/hosts/${hostId}/activity`);
        setActivityLogs(data.items || []);
      }
    } catch (err) {
      if (err instanceof ClientApiError) {
        setPanelError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handlePowerAction(action: 'start' | 'stop' | 'restart' | 'kill' | 'reinstall') {
    setPanelError(null);
    setPanelNotice(null);
    if (!hostId) {
      setPanelError(`[RUNTIME_NODE_UNAVAILABLE] ${t['runtime.node.unavailable']}`);
      return;
    }
    try {
      await apiFetch(`/api/hosts/${hostId}/management`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setPanelNotice(
        isRtl
          ? `تم إرسال إشارة (${action.toUpperCase()}) إلى عقدة التشغيل.`
          : `Dispatched ${action.toUpperCase()} signal to Runtime Node.`
      );
      void loadHostDetail();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setPanelError(`[${err.code}] ${err.message}`);
      } else {
        setPanelError(
          isRtl
            ? 'فشل إرسال أمر إدارة التشغيل.'
            : 'Management command failed.'
        );
      }
    }
  }

  async function handleSaveStartup(e: React.FormEvent) {
    e.preventDefault();
    setPanelError(null);
    setPanelNotice(null);
    if (!hostId) {
      setPanelError('Sign in with Discord OAuth2 and select a live Host to save Startup configuration.');
      return;
    }
    try {
      const argsArray = startupArgs
        .split(' ')
        .map((s) => s.trim())
        .filter(Boolean);

      await apiFetch(`/api/hosts/${hostId}/startup`, {
        method: 'PUT',
        body: JSON.stringify({
          runtime: startupRuntime,
          runtimeVersion: startupVersion,
          startupCommand,
          startupArgs: argsArray,
          workingDirectory: workingDir,
          environmentVariables: envVars,
        }),
      });
      setPanelNotice('Startup configuration and encrypted environment variables saved.');
      void loadTabResource('startup');
    } catch (err) {
      if (err instanceof ClientApiError) {
        setPanelError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleCreateSchedule(e: React.FormEvent) {
    e.preventDefault();
    setPanelError(null);
    if (!hostId) {
      setPanelError('Sign in and select a Host to create a Cron schedule.');
      return;
    }
    try {
      await apiFetch(`/api/hosts/${hostId}/schedules`, {
        method: 'POST',
        body: JSON.stringify({
          name: schedName.trim(),
          cronExpression: schedCron.trim(),
          taskType: schedTask,
          payload: schedPayload.trim() || null,
          isActive: true,
          onlyWhenOnline: false,
        }),
      });
      setSchedName('');
      setSchedPayload('');
      setPanelNotice('Cron schedule registered in Control Plane scheduler.');
      void loadTabResource('schedules');
    } catch (err) {
      if (err instanceof ClientApiError) {
        setPanelError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleCreateDatabase(e: React.FormEvent) {
    e.preventDefault();
    setPanelError(null);
    if (!hostId) {
      setPanelError(`[RUNTIME_NODE_UNAVAILABLE] ${t['runtime.node.unavailable']}`);
      return;
    }
    try {
      await apiFetch(`/api/hosts/${hostId}/databases`, {
        method: 'POST',
        body: JSON.stringify({
          name: dbName.trim(),
          engine: dbEngine,
          remoteHost: '%',
        }),
      });
      setDbName('');
      setPanelNotice(
        isRtl ? 'تم إنشاء قاعدة البيانات بنجاح.' : 'Database provisioned.'
      );
      void loadTabResource('databases');
    } catch (err) {
      if (err instanceof ClientApiError) {
        setPanelError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleCreateBackup(e: React.FormEvent) {
    e.preventDefault();
    setPanelError(null);
    if (!hostId) {
      setPanelError(`[RUNTIME_NODE_UNAVAILABLE] ${t['runtime.node.unavailable']}`);
      return;
    }
    try {
      await apiFetch(`/api/hosts/${hostId}/backups`, {
        method: 'POST',
        body: JSON.stringify({
          name: backupName.trim(),
          isLocked: false,
        }),
      });
      setBackupName('');
      setPanelNotice(
        isRtl ? 'تم إنشاء النسخة الاحتياطية بنجاح.' : 'Backup snapshot completed.'
      );
      void loadTabResource('backups');
    } catch (err) {
      if (err instanceof ClientApiError) {
        setPanelError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleAddCollaborator(e: React.FormEvent) {
    e.preventDefault();
    setPanelError(null);
    if (!hostId) {
      setPanelError('Sign in and select a Host to grant collaborator permissions.');
      return;
    }
    try {
      await apiFetch(`/api/hosts/${hostId}/users`, {
        method: 'POST',
        body: JSON.stringify({
          discordId: collabDiscordId.trim(),
          permissions: selectedPerms,
        }),
      });
      setCollabDiscordId('');
      setPanelNotice('Collaborator permissions updated.');
      void loadTabResource('users');
    } catch (err) {
      if (err instanceof ClientApiError) {
        setPanelError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setPanelError(null);
    if (!hostId) return;
    try {
      await apiFetch(`/api/hosts/${hostId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: settingsName.trim(),
          description: settingsDesc.trim() || null,
        }),
      });
      setPanelNotice('Host settings updated.');
      void loadHostDetail();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setPanelError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleDeleteHost() {
    if (!hostId) return;
    try {
      await apiFetch(`/api/hosts/${hostId}`, { method: 'DELETE' });
      onHostDeleted();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setPanelError(`[${err.code}] ${err.message}`);
      }
    }
  }

  const tabs: Array<{ id: HostPanelTab; label: string; icon: React.ReactNode }> = [
    { id: 'console', label: t.tabConsole, icon: <Terminal className="w-4 h-4" /> },
    { id: 'files', label: t.tabFiles, icon: <FolderOpen className="w-4 h-4" /> },
    { id: 'startup', label: t.tabStartup, icon: <Cpu className="w-4 h-4" /> },
    { id: 'network', label: t.tabNetwork, icon: <Network className="w-4 h-4" /> },
    { id: 'metrics', label: t.tabMetrics, icon: <Activity className="w-4 h-4" /> },
    { id: 'management', label: t.tabManagement, icon: <Power className="w-4 h-4" /> },
    { id: 'databases', label: t.tabDatabases, icon: <Database className="w-4 h-4" /> },
    { id: 'schedules', label: t.tabSchedules, icon: <Clock className="w-4 h-4" /> },
    { id: 'backups', label: t.tabBackups, icon: <HardDrive className="w-4 h-4" /> },
    { id: 'administration', label: t.tabAdministration, icon: <Shield className="w-4 h-4" /> },
    { id: 'users', label: t.tabUsers, icon: <Users className="w-4 h-4" /> },
    { id: 'settings', label: t.tabSettings, icon: <Settings className="w-4 h-4" /> },
    { id: 'activity', label: t.tabActivity, icon: <History className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Host Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
            >
              {isRtl ? (
                <ArrowRight className="w-4 h-4" />
              ) : (
                <ArrowLeft className="w-4 h-4" />
              )}
            </button>
            <h1 className="text-xl font-bold text-white">
              {hostData ? hostData.name : 'Host Workspace'}
            </h1>
            {(hostData?.serverId || hostData?.publicId || hostId) && (
              <button
                type="button"
                onClick={() => {
                  const sid = hostData?.serverId || hostData?.publicId || hostId;
                  void navigator.clipboard?.writeText(sid);
                  setCopiedId(true);
                  setTimeout(() => setCopiedId(false), 1800);
                }}
                title={t.copyId}
                dir="ltr"
                className="px-2.5 py-1 rounded-lg bg-[#121424] hover:bg-[#191C32] border border-violet-500/30 text-[11px] font-mono text-violet-300 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>{hostData?.serverId || hostData?.publicId || hostId}</span>
                {copiedId ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3 text-slate-400" />
                )}
              </button>
            )}
          </div>
          <div className="text-xs text-slate-400 ps-9">
            <span>{t.statusLabel}: {hostData?.status ?? 'PENDING'}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>{t.runtimeLabel}: {hostData?.runtime ?? 'NODEJS'} v{hostData?.runtimeVersion ?? '22'}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums" dir="ltr">
              {t.limitsLabel}: {hostData?.cpuLimitPercent ?? 100}% CPU / {hostData?.memoryLimitMb ?? 512} MB RAM / {hostData?.diskLimitMb ?? 2048} MB Disk
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handlePowerAction('start')}
            className="px-3 py-1.5 text-xs font-medium bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 rounded-lg hover:bg-emerald-900/50 cursor-pointer"
          >
            {t.startBtn}
          </button>
          <button
            type="button"
            onClick={() => handlePowerAction('restart')}
            className="px-3 py-1.5 text-xs font-medium bg-slate-900 border border-slate-700 text-slate-200 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            {t.restartBtn}
          </button>
          <button
            type="button"
            onClick={() => handlePowerAction('stop')}
            className="px-3 py-1.5 text-xs font-medium bg-amber-950/40 border border-amber-800/60 text-amber-300 rounded-lg hover:bg-amber-900/50 cursor-pointer"
          >
            {t.stopBtn}
          </button>
        </div>
      </div>

      {/* Horizontal 13-Item Host Navigation */}
      <div className="flex items-center gap-1 p-1 bg-[#11131F] border border-slate-800 rounded-xl overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setPanelError(null);
              setPanelNotice(null);
              setActiveTab(tab.id);
            }}
            className={`px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Structured Error / Notice Banners */}
      {hostData?.provisioningError && !panelError && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="font-mono" dir="ltr">
            [PROVISIONING_FAILED] {hostData.provisioningError}
          </div>
        </div>
      )}

      {panelError && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="font-mono">{panelError}</div>
        </div>
      )}

      {panelNotice && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-200 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{panelNotice}</span>
        </div>
      )}

      {loading ? (
        <div className="h-64 rounded-xl bg-[#11131F] border border-slate-800 animate-pulse" />
      ) : (
        <>
          {/* 10. CONSOLE */}
          {activeTab === 'console' && (
            <div className="rounded-xl bg-[#07080D] border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 bg-[#11131F] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{t.wsConsoleStream}</span>
                  <span className="text-slate-500">·</span>
                  <span
                    className={`font-mono ${
                      wsState === 'CONNECTED' ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {wsState === 'CONNECTED'
                      ? t['console.connected']
                      : wsState === 'CONNECTING'
                      ? t['console.connecting']
                      : t['console.runtimeUnavailable']}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConsoleFrames([])}
                    className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                  >
                    {t.clearConsole}
                  </button>
                  <button
                    type="button"
                    onClick={connectConsoleWebSocket}
                    className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{t.reconnect}</span>
                  </button>
                </div>
              </div>

              <div className="p-5 h-80 overflow-y-auto font-mono text-xs space-y-2" dir="ltr">
                {wsState !== 'CONNECTED' && consoleFrames.length === 0 ? (
                  <div
                    className="h-full flex flex-col items-center justify-center text-center space-y-2 text-slate-400"
                    dir={isRtl ? 'rtl' : 'ltr'}
                  >
                    <Terminal className="w-7 h-7 text-slate-600" />
                    <div className="text-sm font-semibold text-slate-200 font-sans">
                      {t['console.runtimeUnavailable']}
                    </div>
                    <p className="text-xs text-slate-400 max-w-md font-sans">
                      {t['runtime.node.unavailable']}
                    </p>
                  </div>
                ) : (
                  consoleFrames.map((f) => (
                    <div key={f.id} className="flex items-start gap-3">
                      <span className="text-slate-500 tabular-nums shrink-0">
                        {f.timestamp.slice(11, 19)}
                      </span>
                      <span
                        className={
                          f.type === 'stderr'
                            ? 'text-red-400'
                            : f.type === 'status'
                            ? 'text-amber-400'
                            : 'text-slate-200'
                        }
                      >
                        {f.message}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!consoleInput.trim()) return;
                  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(
                      JSON.stringify({ type: 'command', command: consoleInput.trim() })
                    );
                    setConsoleInput('');
                  } else {
                    setPanelError(`[RUNTIME_NODE_UNAVAILABLE] ${t['runtime.node.unavailable']}`);
                  }
                }}
                className="border-t border-slate-800 bg-[#11131F] px-4 py-2.5 flex items-center gap-3"
                dir="ltr"
              >
                <span className="text-xs font-mono text-indigo-400">stdin &gt;</span>
                <input
                  type="text"
                  value={consoleInput}
                  onChange={(e) => setConsoleInput(e.target.value)}
                  placeholder={
                    wsState === 'CONNECTED'
                      ? t.stdinPlaceholderConnected
                      : t.stdinPlaceholderDisconnected
                  }
                  className="flex-1 bg-transparent text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-3 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded cursor-pointer"
                >
                  {t.sendBtn}
                </button>
              </form>
            </div>
          )}

          {/* 11. FILES */}
          {activeTab === 'files' && (
            <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white">{t.remoteFileManager}</h2>
                  <p className="text-xs text-slate-400 font-mono" dir="ltr">
                    {t.workingPath}: {currentPath}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder={t.newFileOrFolderPlaceholder}
                    className="px-3 py-1.5 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newFileName.trim()) return;
                      if (!hostId) {
                        setFileError(`[RUNTIME_NODE_UNAVAILABLE] ${t['runtime.node.unavailable']}`);
                        return;
                      }
                      try {
                        await apiFetch(`/api/hosts/${hostId}/files`, {
                          method: 'POST',
                          body: JSON.stringify({
                            action: 'create_file',
                            path: `${currentPath.replace(/\/$/, '')}/${newFileName.trim()}`,
                            content: '',
                          }),
                        });
                        setNewFileName('');
                        void loadTabResource('files');
                      } catch (err) {
                        if (err instanceof ClientApiError) {
                          setFileError(`[${err.code}] ${err.message}`);
                        }
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
                  >
                    {t.createFileBtn}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newFileName.trim()) return;
                      if (!hostId) {
                        setFileError(`[RUNTIME_NODE_UNAVAILABLE] ${t['runtime.node.unavailable']}`);
                        return;
                      }
                      try {
                        await apiFetch(`/api/hosts/${hostId}/files`, {
                          method: 'POST',
                          body: JSON.stringify({
                            action: 'create_folder',
                            path: `${currentPath.replace(/\/$/, '')}/${newFileName.trim()}`,
                          }),
                        });
                        setNewFileName('');
                        void loadTabResource('files');
                      } catch (err) {
                        if (err instanceof ClientApiError) {
                          setFileError(`[${err.code}] ${err.message}`);
                        }
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                  >
                    {t.createFolderBtn}
                  </button>
                </div>
              </div>

              {fileError || fileEntries.length === 0 ? (
                <div className="p-8 rounded-lg bg-[#090A10] border border-slate-800 text-center space-y-2">
                  <div className="text-sm font-semibold text-slate-200">
                    {fileError || t.runtimeNodeUnavailable}
                  </div>
                  <p className="text-xs text-slate-500 max-w-lg mx-auto">
                    {t.filesUnavailableDesc}
                  </p>
                </div>
              ) : (
                <table className="w-full text-start text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-3">{t.fileColName}</th>
                      <th className="py-2.5 px-3">{t.fileColType}</th>
                      <th className="py-2.5 px-3 text-end">{t.fileColSize}</th>
                      <th className="py-2.5 px-3 text-end">{t.fileColModified}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {fileEntries.map((item) => (
                      <tr key={item.path}>
                        <td className="py-2.5 px-3 font-mono text-white">{item.name}</td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {item.isDirectory ? t.fileTypeDir : t.fileTypeFile}
                        </td>
                        <td className="py-2.5 px-3 text-end font-mono tabular-nums text-slate-300">
                          {item.sizeBytes} B
                        </td>
                        <td className="py-2.5 px-3 text-end font-mono text-slate-400">
                          {item.modifiedAt}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* 12. STARTUP */}
          {activeTab === 'startup' && (
            <form
              onSubmit={handleSaveStartup}
              className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-6"
            >
              <div>
                <h2 className="text-base font-bold text-white">
                  {t.startupVaultTitle}
                </h2>
                <p className="text-xs text-slate-400">
                  {t.startupVaultDesc}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.runtimeEnvLabel}
                  </label>
                  <select
                    value={startupRuntime}
                    onChange={(e) => setStartupRuntime(e.target.value as HostRuntimeCode)}
                    className="w-full px-3 py-2 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  >
                    {RUNTIME_CATALOG.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.runtimeVersionLabel}
                  </label>
                  <input
                    type="text"
                    value={startupVersion}
                    onChange={(e) => setStartupVersion(e.target.value)}
                    dir="ltr"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.startupCommandLabel}
                  </label>
                  <input
                    type="text"
                    value={startupCommand}
                    onChange={(e) => setStartupCommand(e.target.value)}
                    dir="ltr"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.startupArgsLabel}
                  </label>
                  <input
                    type="text"
                    value={startupArgs}
                    onChange={(e) => setStartupArgs(e.target.value)}
                    placeholder="--enable-source-maps"
                    dir="ltr"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.workingDirLabel}
                  </label>
                  <input
                    type="text"
                    value={workingDir}
                    onChange={(e) => setWorkingDir(e.target.value)}
                    dir="ltr"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  />
                </div>
              </div>

              {/* Environment Variables List */}
              <div className="space-y-3 pt-4 border-t border-slate-800">
                <div className="text-xs font-semibold text-slate-200">
                  {t.envVarsTitle} ({envVars.length})
                </div>

                {envVars.length > 0 && (
                  <div className="space-y-2">
                    {envVars.map((env, idx) => (
                      <div
                        key={env.key}
                        className="flex items-center gap-2 bg-[#090A10] p-2.5 rounded-lg border border-slate-800 text-xs font-mono"
                      >
                        <span className="font-semibold text-indigo-300 w-48 truncate">
                          {env.key}
                        </span>
                        <input
                          type="text"
                          value={env.value}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEnvVars((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, value: val } : item))
                            );
                          }}
                          className="flex-1 bg-transparent text-slate-200 focus:outline-none"
                        />
                        <span className="text-[11px] font-sans text-slate-500">
                          {env.isSecret ? t.secretLabel : t.plainLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setEnvVars((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="p-1 text-slate-400 hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <input
                    type="text"
                    value={newEnvKey}
                    onChange={(e) =>
                      setNewEnvKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
                    }
                    placeholder={t.envKeyPlaceholder}
                    dir="ltr"
                    className="px-3 py-1.5 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  />
                  <input
                    type="password"
                    value={newEnvVal}
                    onChange={(e) => setNewEnvVal(e.target.value)}
                    placeholder={t.envValPlaceholder}
                    dir="ltr"
                    className="flex-1 min-w-[200px] px-3 py-1.5 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEnvSecret}
                      onChange={(e) => setNewEnvSecret(e.target.checked)}
                    />
                    <span>{t.secretLabel}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (!newEnvKey.trim() || !newEnvVal.trim()) return;
                      setEnvVars((prev) => [
                        ...prev.filter((item) => item.key !== newEnvKey.trim()),
                        {
                          key: newEnvKey.trim(),
                          value: newEnvVal.trim(),
                          isSecret: newEnvSecret,
                        },
                      ]);
                      setNewEnvKey('');
                      setNewEnvVal('');
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t.addVariableBtn}</span>
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-800">
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
                >
                  {t.saveStartupBtn}
                </button>
              </div>
            </form>
          )}

          {/* 13. NETWORK */}
          {activeTab === 'network' && (
            <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-5">
              <div>
                <h2 className="text-base font-bold text-white">{t.networkTitle}</h2>
                <p className="text-xs text-slate-400">
                  {t.networkDesc}
                </p>
              </div>

              {allocations.length === 0 ? (
                <div className="p-8 rounded-lg bg-[#090A10] border border-slate-800 text-center text-xs text-slate-400">
                  {t.noAllocations}
                </div>
              ) : (
                <table className="w-full text-start text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-3">{t.netColIp}</th>
                      <th className="py-2.5 px-3">{t.netColPort}</th>
                      <th className="py-2.5 px-3">{t.netColProto}</th>
                      <th className="py-2.5 px-3">{t.netColRole}</th>
                      <th className="py-2.5 px-3">{t.netColStatus}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono">
                    {allocations.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2.5 px-3 text-white">{a.ipAddress}</td>
                        <td className="py-2.5 px-3 tabular-nums text-indigo-300">{a.port}</td>
                        <td className="py-2.5 px-3 text-slate-300">{a.protocol}</td>
                        <td className="py-2.5 px-3 font-sans text-slate-300">
                          {a.isPrimary ? t.netRolePrimary : t.netRoleSecondary}
                        </td>
                        <td className="py-2.5 px-3 font-sans text-emerald-400">{a.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* 14. METRICS */}
          {activeTab === 'metrics' && (
            <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-5">
              <div>
                <h2 className="text-base font-bold text-white">{t.metricsTitle}</h2>
                <p className="text-xs text-slate-400">
                  {t.metricsDesc}
                </p>
              </div>

              {!metricsState.available || !metricsState.metrics ? (
                <div className="p-10 rounded-lg bg-[#090A10] border border-slate-800 text-center space-y-2">
                  <Activity className="w-7 h-7 text-slate-600 mx-auto" />
                  <div className="text-sm font-semibold text-slate-200">
                    {t.noMetricsAvailable}
                  </div>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {t.metricsUnavailableDesc}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-mono text-xs">
                  <div className="p-4 rounded-lg bg-[#090A10] border border-slate-800">
                    <div className="text-slate-400 font-sans">{t.metricsCpuLoad}</div>
                    <div className="text-lg font-bold text-white tabular-nums mt-1" dir="ltr">
                      {metricsState.metrics.cpuPercent}%
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-[#090A10] border border-slate-800">
                    <div className="text-slate-400 font-sans">{t.metricsMemoryUsage}</div>
                    <div className="text-lg font-bold text-white tabular-nums mt-1" dir="ltr">
                      {Math.round(metricsState.metrics.memoryBytes / 1048576)} MB
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-[#090A10] border border-slate-800">
                    <div className="text-slate-400 font-sans">{t.metricsUptime}</div>
                    <div className="text-lg font-bold text-white tabular-nums mt-1" dir="ltr">
                      {metricsState.metrics.uptimeSeconds}s
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 15. MANAGEMENT */}
          {activeTab === 'management' && (
            <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">{t.managementTitle}</h2>
                <p className="text-xs text-slate-400">
                  {t.managementDesc}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {(
                  [
                    { action: 'start', label: t.mgmtStartTitle, desc: t.mgmtStartDesc },
                    { action: 'stop', label: t.mgmtStopTitle, desc: t.mgmtStopDesc },
                    { action: 'restart', label: t.mgmtRestartTitle, desc: t.mgmtRestartDesc },
                    { action: 'kill', label: t.mgmtKillTitle, desc: t.mgmtKillDesc },
                    { action: 'reinstall', label: t.mgmtReinstallTitle, desc: t.mgmtReinstallDesc },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.action}
                    type="button"
                    onClick={() => handlePowerAction(item.action)}
                    className="p-4 rounded-xl bg-[#090A10] hover:bg-slate-900 border border-slate-800 text-start space-y-1 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-bold text-white">{item.label}</div>
                    <div className="text-[11px] text-slate-400">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 16. DATABASES */}
          {activeTab === 'databases' && (
            <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">{t.databasesTitle}</h2>
                <p className="text-xs text-slate-400">
                  {t.databasesDesc}
                </p>
              </div>

              <form onSubmit={handleCreateDatabase} className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  required
                  value={dbName}
                  onChange={(e) => setDbName(e.target.value)}
                  placeholder="database_name"
                  dir="ltr"
                  className="px-3 py-2 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
                />
                <select
                  value={dbEngine}
                  onChange={(e) => setDbEngine(e.target.value as any)}
                  className="px-3 py-2 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
                >
                  <option value="POSTGRESQL">PostgreSQL</option>
                  <option value="MYSQL">MySQL</option>
                  <option value="MONGODB">MongoDB</option>
                  <option value="REDIS">Redis</option>
                </select>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
                >
                  {t.provisionDatabaseBtn}
                </button>
              </form>

              {databases.length === 0 ? (
                <div className="p-6 rounded-lg bg-[#090A10] border border-slate-800 text-center text-xs text-slate-400">
                  {t.noDatabases}
                </div>
              ) : (
                <div className="space-y-2">
                  {databases.map((db) => (
                    <div
                      key={db.id}
                      className="p-3.5 rounded-lg bg-[#090A10] border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-mono text-[11px] text-violet-300 me-2" dir="ltr">
                          {db.databaseId || db.id}
                        </span>
                        <span className="font-mono font-semibold text-white">{db.name}</span>
                        <span className="mx-2 text-slate-500">·</span>
                        <span className="text-indigo-300">{db.engine}</span>
                        <span className="mx-2 text-slate-500">·</span>
                        <span className="font-mono text-slate-400" dir="ltr">
                          {db.hostAddress}:{db.port}
                        </span>
                      </div>
                      <span className="text-emerald-400 font-mono">{db.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 17. SCHEDULES */}
          {activeTab === 'schedules' && (
            <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">{t.schedulesTitle}</h2>
                <p className="text-xs text-slate-400">
                  {t.schedulesDesc}
                </p>
              </div>

              <form onSubmit={handleCreateSchedule} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <input
                  type="text"
                  required
                  value={schedName}
                  onChange={(e) => setSchedName(e.target.value)}
                  placeholder={t.schedNamePlaceholder}
                  className="px-3 py-2 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
                />
                <input
                  type="text"
                  required
                  value={schedCron}
                  onChange={(e) => setSchedCron(e.target.value)}
                  placeholder="0 */24 * * *"
                  dir="ltr"
                  className="px-3 py-2 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
                />
                <select
                  value={schedTask}
                  onChange={(e) => setSchedTask(e.target.value as any)}
                  className="px-3 py-2 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
                >
                  <option value="POWER_RESTART">{t.schedTaskRestart}</option>
                  <option value="POWER_START">{t.schedTaskStart}</option>
                  <option value="POWER_STOP">{t.schedTaskStop}</option>
                  <option value="EXECUTE_COMMAND">{t.schedTaskCommand}</option>
                  <option value="CREATE_BACKUP">{t.schedTaskBackup}</option>
                </select>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
                >
                  {t.addScheduleBtn}
                </button>
              </form>

              {schedules.length === 0 ? (
                <div className="p-6 rounded-lg bg-[#090A10] border border-slate-800 text-center text-xs text-slate-400">
                  {t.noSchedules}
                </div>
              ) : (
                <div className="space-y-2">
                  {schedules.map((s) => (
                    <div
                      key={s.id}
                      className="p-3.5 rounded-lg bg-[#090A10] border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-mono text-[11px] text-violet-300 me-2" dir="ltr">
                          {s.scheduleId || s.id}
                        </span>
                        <span className="font-semibold text-white">{s.name}</span>
                        <span className="mx-2 text-slate-500">·</span>
                        <span className="font-mono text-indigo-300" dir="ltr">{s.cronExpression}</span>
                        <span className="mx-2 text-slate-500">·</span>
                        <span className="text-slate-400">{s.taskType}</span>
                      </div>
                      <span className="text-slate-400 font-mono">
                        {s.lastStatus || t.schedStatusScheduled}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 18. BACKUPS */}
          {activeTab === 'backups' && (
            <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">{t.backupsTitle}</h2>
                <p className="text-xs text-slate-400">
                  {t.backupsDesc}
                </p>
              </div>

              <form onSubmit={handleCreateBackup} className="flex items-center gap-3">
                <input
                  type="text"
                  required
                  value={backupName}
                  onChange={(e) => setBackupName(e.target.value)}
                  placeholder={t.backupNamePlaceholder}
                  className="px-3 py-2 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
                />
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
                >
                  {t.createBackupBtn}
                </button>
              </form>

              {backups.length === 0 ? (
                <div className="p-6 rounded-lg bg-[#090A10] border border-slate-800 text-center text-xs text-slate-400">
                  {t.noBackups}
                </div>
              ) : (
                <div className="space-y-2">
                  {backups.map((b) => (
                    <div
                      key={b.id}
                      className="p-3.5 rounded-lg bg-[#090A10] border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-mono text-[11px] text-violet-300 me-2" dir="ltr">
                          {b.backupId || b.id}
                        </span>
                        <span className="font-semibold text-white">{b.name}</span>
                        <span className="mx-2 text-slate-500">·</span>
                        <span className="font-mono tabular-nums text-slate-400" dir="ltr">
                          {b.sizeBytes} Bytes
                        </span>
                      </div>
                      <span className="text-emerald-400 font-mono">{b.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 19. ADMINISTRATION & USERS */}
          {(activeTab === 'users' || activeTab === 'administration') && (
            <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">
                  {t.collaboratorsTitle} ({HOST_PERMISSIONS.length})
                </h2>
                <p className="text-xs text-slate-400">
                  {t.collaboratorsDesc}
                </p>
              </div>

              <form onSubmit={handleAddCollaborator} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.collaboratorDiscordIdLabel}
                  </label>
                  <input
                    type="text"
                    required
                    value={collabDiscordId}
                    onChange={(e) => setCollabDiscordId(e.target.value)}
                    placeholder="e.g. 108492019482710293"
                    dir="ltr"
                    className="w-full max-w-sm px-3 py-2 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  />
                </div>

                <div>
                  <div className="text-xs font-medium text-slate-300 mb-2">
                    {t.selectPermissionsLabel}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" dir="ltr">
                    {HOST_PERMISSIONS.map((perm) => {
                      const checked = selectedPerms.includes(perm);
                      return (
                        <label
                          key={perm}
                          className="flex items-center gap-2 p-2 rounded-lg bg-[#090A10] border border-slate-800 text-xs font-mono text-slate-300 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPerms((prev) => [...prev, perm]);
                              } else {
                                setSelectedPerms((prev) => prev.filter((p) => p !== perm));
                              }
                            }}
                          />
                          <span>{perm}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
                >
                  {t.grantPermissionsBtn}
                </button>
              </form>

              {collaborators.length > 0 && (
                <div className="space-y-2 pt-4 border-t border-slate-800">
                  {collaborators.map((c) => (
                    <div
                      key={c.id}
                      className="p-3.5 rounded-lg bg-[#090A10] border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-white">
                          {c.user?.displayName || c.user?.username}
                        </span>
                        <span className="mx-2 text-slate-500">·</span>
                        <span className="font-mono text-slate-400">
                          {c.permissions.join(', ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SETTINGS */}
          {activeTab === 'settings' && (
            <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-6">
              <form onSubmit={handleSaveSettings} className="space-y-4 max-w-xl">
                <h2 className="text-base font-bold text-white">{t.hostSettingsTitle}</h2>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.hostNameLabel}
                  </label>
                  <input
                    type="text"
                    required
                    value={settingsName}
                    onChange={(e) => setSettingsName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t.descriptionOptionalLabel}
                  </label>
                  <input
                    type="text"
                    value={settingsDesc}
                    onChange={(e) => setSettingsDesc(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer"
                >
                  {t.saveSettingsBtn}
                </button>
              </form>

              {hostId && (
                <div className="pt-6 border-t border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-red-400">{t.deleteHostTitle}</div>
                    <div className="text-xs text-slate-400">
                      {t.deleteHostDesc}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDeleteHost}
                    className="px-4 py-2 text-xs font-semibold bg-red-950/60 hover:bg-red-900 border border-red-800 text-red-200 rounded-lg cursor-pointer"
                  >
                    {t.deleteHostTitle}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 20. ACTIVITY LOG */}
          {activeTab === 'activity' && (
            <div className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-4">
              <div>
                <h2 className="text-base font-bold text-white">{t.activityLogTitle}</h2>
                <p className="text-xs text-slate-400">
                  {t.activityLogDesc}
                </p>
              </div>

              {activityLogs.length === 0 ? (
                <div className="p-6 rounded-lg bg-[#090A10] border border-slate-800 text-center text-xs text-slate-400">
                  {t.noActivityEvents}
                </div>
              ) : (
                <div className="space-y-2">
                  {activityLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3.5 rounded-lg bg-[#090A10] border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-mono text-[11px] text-violet-300 me-2" dir="ltr">
                          {log.activityId || log.id}
                        </span>
                        <span className="font-semibold text-white">{log.action}</span>
                        <span className="mx-2 text-slate-500">·</span>
                        <span className="text-slate-400">
                          {t.actorLabel}: {log.actor?.displayName || t.systemActor}
                        </span>
                        {log.ipAddress && (
                          <>
                            <span className="mx-2 text-slate-500">·</span>
                            <span className="font-mono text-slate-500" dir="ltr">{log.ipAddress}</span>
                          </>
                        )}
                      </div>
                      <span className="font-mono text-slate-500 tabular-nums" dir="ltr">
                        {log.createdAt}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
