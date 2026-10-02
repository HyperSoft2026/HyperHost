import React, { useEffect, useState } from 'react';
import {
  Server,
  Plus,
  AlertCircle,
  CheckCircle2,
  Search,
  RefreshCw,
  Users,
  Terminal,
  History,
  KeyRound,
  Database,
  Clock,
  HardDrive,
  Eye,
  X,
  Copy,
  Check,
  Trash2,
  ShieldAlert,
} from 'lucide-react';
import { apiFetch, ClientApiError } from './api';
import { useI18n } from './i18n';

type AdminEntityTab =
  | 'users'
  | 'hosts'
  | 'activity'
  | 'sessions'
  | 'nodes'
  | 'databases'
  | 'schedules'
  | 'backups';

export const AdminControlPlaneView: React.FC<{
  onInspectHost?: (serverId: string) => void;
}> = ({ onInspectHost }) => {
  const { t, isRtl } = useI18n();
  const [overview, setOverview] = useState<any | null>(null);
  const [activeEntity, setActiveEntity] = useState<AdminEntityTab>('users');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<any[]>([]);
  const [pagination, setPagination] = useState<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }>({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [loadingRecords, setLoadingRecords] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Register Runtime Node Form
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [nodeName, setNodeName] = useState('');
  const [nodeLocation, setNodeLocation] = useState('');
  const [nodeFqdn, setNodeFqdn] = useState('');
  const [nodeIp, setNodeIp] = useState('');
  const [nodePort, setNodePort] = useState(8080);
  const [nodeMemoryMb, setNodeMemoryMb] = useState(16384);
  const [nodeDiskMb, setNodeDiskMb] = useState(102400);

  useEffect(() => {
    void loadAdminOverview();
  }, []);

  useEffect(() => {
    void loadEntityRecords();
  }, [activeEntity, statusFilter, sortOrder, page]);

  async function loadAdminOverview() {
    try {
      const data = await apiFetch<any>('/api/admin/overview');
      setOverview(data);
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError('Unable to load Control Plane administration telemetry.');
      }
    }
  }

  async function loadEntityRecords(overridePage?: number) {
    setLoadingRecords(true);
    setError(null);
    const targetPage = overridePage ?? page;
    try {
      const params = new URLSearchParams({
        entity: activeEntity,
        search: search.trim(),
        status: statusFilter,
        sort: sortOrder,
        page: String(targetPage),
        limit: '15',
      });
      const data = await apiFetch<{
        entity: string;
        items: any[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      }>(`/api/admin/records?${params.toString()}`);
      setRecords(data.items || []);
      setPagination(
        data.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 }
      );
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      }
      setRecords([]);
    } finally {
      setLoadingRecords(false);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    void loadEntityRecords(1);
  }

  function handleCopy(idValue: string) {
    void navigator.clipboard?.writeText(idValue);
    setCopiedId(idValue);
    setTimeout(() => setCopiedId(null), 1600);
  }

  async function handleUpdateUserRole(userId: string, nextRole: 'USER' | 'ADMIN') {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      setNotice(
        isRtl
          ? `تم تحديث صلاحية المستخدم إلى ${nextRole}.`
          : `Updated user role to ${nextRole}.`
      );
      void loadEntityRecords();
      void loadAdminOverview();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleRevokeSession(sessionId: string) {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/revoke`, {
        method: 'POST',
      });
      setNotice(
        isRtl
          ? 'تم إبطال الجلسة بنجاح.'
          : 'Session revoked successfully.'
      );
      void loadEntityRecords();
      void loadAdminOverview();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleHostStatusChange(
    hostId: string,
    status: 'SUSPENDED' | 'OFFLINE' | 'PENDING'
  ) {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/hosts/${encodeURIComponent(hostId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setNotice(
        isRtl
          ? `تم تحديث حالة الاستضافة إلى ${status}.`
          : `Updated Host status to ${status}.`
      );
      void loadEntityRecords();
      void loadAdminOverview();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleDeleteHostAdmin(hostId: string) {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/hosts/${encodeURIComponent(hostId)}`, {
        method: 'DELETE',
      });
      setNotice(
        isRtl
          ? 'تم حذف الاستضافة وإطلاق مواردها بنجاح.'
          : 'Host deleted and allocations released.'
      );
      setSelectedRecord(null);
      void loadEntityRecords();
      void loadAdminOverview();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleDeleteNodeAdmin(nodeId: string) {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/nodes/${encodeURIComponent(nodeId)}`, {
        method: 'DELETE',
      });
      setNotice(
        isRtl
          ? 'تم حذف عقدة التشغيل بنجاح.'
          : 'Runtime Node deleted successfully.'
      );
      void loadEntityRecords();
      void loadAdminOverview();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      }
    }
  }

  async function handleRegisterNode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setNewToken(null);
    try {
      const res = await apiFetch<{ node: any; agentProvisioningToken: string }>(
        '/api/admin/nodes',
        {
          method: 'POST',
          body: JSON.stringify({
            name: nodeName.trim(),
            location: nodeLocation.trim(),
            fqdn: nodeFqdn.trim(),
            ipAddress: nodeIp.trim(),
            daemonPort: Number(nodePort),
            maxMemoryMb: Number(nodeMemoryMb),
            maxDiskMb: Number(nodeDiskMb),
            maxCpuPercent: 1600,
          }),
        }
      );
      setNotice(`Registered Runtime Node "${res.node.name}" (${res.node.publicId}).`);
      setNewToken(res.agentProvisioningToken);
      setNodeName('');
      setNodeLocation('');
      setNodeFqdn('');
      setNodeIp('');
      void loadAdminOverview();
      if (activeEntity === 'nodes') {
        void loadEntityRecords();
      }
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      }
    }
  }

  const entityTabs: Array<{
    id: AdminEntityTab;
    label: string;
    count: number;
    icon: React.ReactNode;
  }> = [
    {
      id: 'users',
      label: t.adminTabUsers,
      count: overview?.counts?.users ?? 0,
      icon: <Users className="w-3.5 h-3.5" />,
    },
    {
      id: 'hosts',
      label: t.adminTabHosts,
      count: overview?.counts?.hosts ?? 0,
      icon: <Terminal className="w-3.5 h-3.5" />,
    },
    {
      id: 'activity',
      label: t.adminTabActivity,
      count: overview?.counts?.activity ?? 0,
      icon: <History className="w-3.5 h-3.5" />,
    },
    {
      id: 'sessions',
      label: t.adminTabSessions,
      count: overview?.counts?.sessions ?? 0,
      icon: <KeyRound className="w-3.5 h-3.5" />,
    },
    {
      id: 'nodes',
      label: t.adminTabNodes,
      count: overview?.counts?.nodes ?? 0,
      icon: <Server className="w-3.5 h-3.5" />,
    },
    {
      id: 'databases',
      label: t.adminTabDatabases,
      count: overview?.counts?.databases ?? 0,
      icon: <Database className="w-3.5 h-3.5" />,
    },
    {
      id: 'schedules',
      label: t.adminTabSchedules,
      count: overview?.counts?.schedules ?? 0,
      icon: <Clock className="w-3.5 h-3.5" />,
    },
    {
      id: 'backups',
      label: t.adminTabBackups,
      count: overview?.counts?.backups ?? 0,
      icon: <HardDrive className="w-3.5 h-3.5" />,
    },
  ];

  const statusOptionsByEntity: Record<AdminEntityTab, string[]> = {
    users: ['ALL', 'USER', 'ADMIN'],
    hosts: ['ALL', 'ONLINE', 'OFFLINE', 'PENDING', 'STARTING', 'STOPPING', 'SUSPENDED', 'ERROR'],
    activity: ['ALL'],
    sessions: ['ALL', 'ACTIVE', 'REVOKED'],
    nodes: ['ALL', 'ONLINE', 'OFFLINE', 'MAINTENANCE'],
    databases: ['ALL', 'READY', 'PROVISIONING', 'UNAVAILABLE', 'ERROR'],
    schedules: ['ALL', 'ACTIVE', 'INACTIVE'],
    backups: ['ALL', 'COMPLETED', 'PENDING', 'FAILED', 'RESTORING'],
  };

  return (
    <div className="space-y-6">
      {/* Admin Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold text-white">{t.adminTitle}</h1>
          <p className="text-xs text-slate-400 mt-1">{t.adminDesc}</p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowNodeForm((prev) => !prev)}
            className="px-3.5 py-2 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.registerNodeBtn}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void loadAdminOverview();
              void loadEntityRecords();
            }}
            className="p-2 rounded-xl bg-[#11131F] hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
            title={t.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start justify-between gap-2.5 font-mono">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span dir="ltr">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-300 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {notice && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-200 space-y-2">
          <div className="flex items-center justify-between gap-2 font-semibold">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{notice}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-emerald-300 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {newToken && (
            <div className="p-2.5 rounded bg-black/50 font-mono text-[11px] text-amber-300" dir="ltr">
              One-Time Node Agent Token (Save now — stored as HMAC-SHA256 hash): {newToken}
            </div>
          )}
        </div>
      )}

      {/* Control Plane Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {[
          { label: t.adminStatUsers, val: overview?.counts?.users ?? 0 },
          { label: t.adminStatHosts, val: overview?.counts?.hosts ?? 0 },
          { label: t.adminStatRegisteredNodes, val: overview?.counts?.nodes ?? 0 },
          { label: t.adminStatConnectedNodes, val: overview?.counts?.connectedNodes ?? 0 },
          { label: t.adminTabSessions, val: overview?.counts?.sessions ?? 0 },
          { label: t.adminStatBackups, val: overview?.counts?.backups ?? 0 },
        ].map((stat) => (
          <div
            key={stat.label}
            className="p-4 rounded-xl bg-[#11131F] border border-slate-800"
          >
            <div className="text-xs text-slate-400">{stat.label}</div>
            <div
              className="text-xl font-bold text-white font-mono tabular-nums mt-1"
              dir="ltr"
            >
              {stat.val}
            </div>
          </div>
        ))}
      </div>

      {/* Collapsible Register Runtime Node Form */}
      {showNodeForm && (
        <form
          onSubmit={handleRegisterNode}
          className="p-6 rounded-2xl bg-[#11131F] border border-violet-500/30 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Server className="w-4 h-4 text-violet-400 shrink-0" />
              <span>{t.registerNodeTitle}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowNodeForm(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t.adminNodeNameLabel}
              </label>
              <input
                type="text"
                required
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                placeholder="eu-central-node-01"
                dir="ltr"
                className="w-full px-3 py-2 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t.adminLocationLabel}
              </label>
              <input
                type="text"
                required
                value={nodeLocation}
                onChange={(e) => setNodeLocation(e.target.value)}
                placeholder="Frankfurt, DE"
                className="w-full px-3 py-2 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t.adminFqdnLabel}
              </label>
              <input
                type="text"
                required
                value={nodeFqdn}
                onChange={(e) => setNodeFqdn(e.target.value)}
                placeholder="node01.hyperhost.internal"
                dir="ltr"
                className="w-full px-3 py-2 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t.adminIpAddressLabel}
              </label>
              <input
                type="text"
                required
                value={nodeIp}
                onChange={(e) => setNodeIp(e.target.value)}
                placeholder="10.20.0.10"
                dir="ltr"
                className="w-full px-3 py-2 text-xs font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t.adminMaxMemoryLabel}
              </label>
              <input
                type="number"
                required
                value={nodeMemoryMb}
                onChange={(e) => setNodeMemoryMb(Number(e.target.value))}
                dir="ltr"
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-[#090A10] border border-slate-800 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t.adminMaxDiskLabel}
              </label>
              <input
                type="number"
                required
                value={nodeDiskMb}
                onChange={(e) => setNodeDiskMb(Number(e.target.value))}
                dir="ltr"
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-[#090A10] border border-slate-800 rounded-lg text-white"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.registerNodeBtn}</span>
            </button>
          </div>
        </form>
      )}

      {/* Entity Explorer Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1.5 bg-[#11131F] border border-slate-800 rounded-xl overflow-x-auto">
        {entityTabs.map((tab) => {
          const active = activeEntity === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveEntity(tab.id);
                setStatusFilter('ALL');
                setPage(1);
              }}
              className={`px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
                active
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums ${
                  active ? 'bg-black/30 text-white' : 'bg-slate-900 text-slate-400'
                }`}
                dir="ltr"
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search, Filter & Sort Toolbar */}
      <div className="p-4 rounded-xl bg-[#11131F] border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.adminSearchPlaceholder}
              className="w-full ps-9 pe-3 py-2 text-xs bg-[#090A10] border border-slate-800 rounded-lg text-white"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-lg cursor-pointer"
          >
            {isRtl ? 'بحث' : 'Search'}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {statusOptionsByEntity[activeEntity].length > 1 && (
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 bg-[#090A10] border border-slate-800 rounded-lg text-slate-200"
            >
              {statusOptionsByEntity[activeEntity].map((st) => (
                <option key={st} value={st}>
                  {st === 'ALL' ? t.adminFilterAll : st}
                </option>
              ))}
            </select>
          )}

          <select
            value={sortOrder}
            onChange={(e) => {
              setSortOrder(e.target.value as 'newest' | 'oldest' | 'name');
              setPage(1);
            }}
            className="px-3 py-2 bg-[#090A10] border border-slate-800 rounded-lg text-slate-200"
          >
            <option value="newest">{t.adminSortNewest}</option>
            <option value="oldest">{t.adminSortOldest}</option>
            <option value="name">{t.adminSortName}</option>
          </select>
        </div>
      </div>

      {/* PostgreSQL Entity Records Table */}
      <div className="rounded-xl bg-[#11131F] border border-slate-800 overflow-hidden">
        {loadingRecords ? (
          <div className="p-12 text-center text-xs text-slate-400">
            {t.checking}
          </div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            {t.adminNoRecords}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-[#0C0E18] text-slate-400">
                  <th className="py-3 px-4 font-semibold">ID</th>
                  {activeEntity === 'users' && (
                    <>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'المستخدم' : 'User'}
                      </th>
                      <th className="py-3 px-4 font-semibold">Discord ID</th>
                      <th className="py-3 px-4 font-semibold">{t.adminRoleLabel}</th>
                      <th className="py-3 px-4 font-semibold">{t.adminStatHosts}</th>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'تاريخ التسجيل' : 'Created'}
                      </th>
                    </>
                  )}
                  {activeEntity === 'hosts' && (
                    <>
                      <th className="py-3 px-4 font-semibold">{t.hostNameLabel}</th>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'المالك' : 'Owner'}
                      </th>
                      <th className="py-3 px-4 font-semibold">{t.runtimeLabel}</th>
                      <th className="py-3 px-4 font-semibold">{t.statusLabel}</th>
                      <th className="py-3 px-4 font-semibold">{t.limitsLabel}</th>
                    </>
                  )}
                  {activeEntity === 'activity' && (
                    <>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'الحدث' : 'Action'}
                      </th>
                      <th className="py-3 px-4 font-semibold">{t.actorLabel}</th>
                      <th className="py-3 px-4 font-semibold">{t.serverIdLabel}</th>
                      <th className="py-3 px-4 font-semibold">IP</th>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'التوقيت' : 'Timestamp'}
                      </th>
                    </>
                  )}
                  {activeEntity === 'sessions' && (
                    <>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'المستخدم' : 'User'}
                      </th>
                      <th className="py-3 px-4 font-semibold">{t.statusLabel}</th>
                      <th className="py-3 px-4 font-semibold">IP</th>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'انتهاء الصلاحية' : 'Expires'}
                      </th>
                    </>
                  )}
                  {activeEntity === 'nodes' && (
                    <>
                      <th className="py-3 px-4 font-semibold">
                        {t.adminNodeNameLabel}
                      </th>
                      <th className="py-3 px-4 font-semibold">
                        {t.adminLocationLabel}
                      </th>
                      <th className="py-3 px-4 font-semibold">Endpoint</th>
                      <th className="py-3 px-4 font-semibold">{t.statusLabel}</th>
                      <th className="py-3 px-4 font-semibold">{t.adminStatHosts}</th>
                    </>
                  )}
                  {activeEntity === 'databases' && (
                    <>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'الاسم' : 'Name'}
                      </th>
                      <th className="py-3 px-4 font-semibold">Engine</th>
                      <th className="py-3 px-4 font-semibold">{t.serverIdLabel}</th>
                      <th className="py-3 px-4 font-semibold">Endpoint</th>
                      <th className="py-3 px-4 font-semibold">{t.statusLabel}</th>
                    </>
                  )}
                  {activeEntity === 'schedules' && (
                    <>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'المهمة' : 'Schedule'}
                      </th>
                      <th className="py-3 px-4 font-semibold">Cron</th>
                      <th className="py-3 px-4 font-semibold">Type</th>
                      <th className="py-3 px-4 font-semibold">{t.serverIdLabel}</th>
                      <th className="py-3 px-4 font-semibold">{t.statusLabel}</th>
                    </>
                  )}
                  {activeEntity === 'backups' && (
                    <>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'النسخة' : 'Backup'}
                      </th>
                      <th className="py-3 px-4 font-semibold">{t.serverIdLabel}</th>
                      <th className="py-3 px-4 font-semibold">{t.fileColSize}</th>
                      <th className="py-3 px-4 font-semibold">{t.statusLabel}</th>
                      <th className="py-3 px-4 font-semibold">
                        {isRtl ? 'التاريخ' : 'Created'}
                      </th>
                    </>
                  )}
                  <th className="py-3 px-4 font-semibold text-end">
                    {t.fileColActions}
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800/80">
                {records.map((row) => {
                  const entityId = row.publicId || row.serverId || row.id;
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-slate-900/50 transition-colors"
                    >
                      {/* Immutable Prefixed Entity ID */}
                      <td className="py-3 px-4 font-mono whitespace-nowrap" dir="ltr">
                        <button
                          type="button"
                          onClick={() => handleCopy(entityId)}
                          title={t.copyId}
                          className="px-2 py-1 rounded bg-[#090A10] border border-slate-800 hover:border-violet-500/40 text-[11px] text-violet-300 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <span>{entityId}</span>
                          {copiedId === entityId ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3 text-slate-500" />
                          )}
                        </button>
                      </td>

                      {/* USERS COLUMNS */}
                      {activeEntity === 'users' && (
                        <>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-white">
                              {row.displayName}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono" dir="ltr">
                              @{row.username}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-300" dir="ltr">
                            {row.discordId}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                                row.role === 'ADMIN'
                                  ? 'bg-violet-950/60 border border-violet-500/40 text-violet-300'
                                  : 'bg-slate-900 border border-slate-700 text-slate-300'
                              }`}
                            >
                              {row.role}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums" dir="ltr">
                            {row.hostCount} / {row.maxHosts}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-400" dir="ltr">
                            {row.createdAt?.slice(0, 19).replace('T', ' ')}
                          </td>
                        </>
                      )}

                      {/* HOSTS COLUMNS */}
                      {activeEntity === 'hosts' && (
                        <>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-white">{row.name}</div>
                            <div className="text-[11px] text-slate-400" dir="ltr">
                              {row.type}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-slate-200">
                              {row.owner?.displayName || row.owner?.username}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500" dir="ltr">
                              {row.owner?.publicId}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-300" dir="ltr">
                            {row.runtime} v{row.runtimeVersion}
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <span
                              className={
                                row.status === 'ONLINE'
                                  ? 'text-emerald-400'
                                  : row.status === 'SUSPENDED'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                              }
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-400" dir="ltr">
                            {row.cpuLimitPercent}% · {row.memoryLimitMb}MB · {row.diskLimitMb}MB
                          </td>
                        </>
                      )}

                      {/* ACTIVITY COLUMNS */}
                      {activeEntity === 'activity' && (
                        <>
                          <td className="py-3 px-4 font-mono font-semibold text-white" dir="ltr">
                            {row.action}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-slate-200">{row.actor}</span>
                            {row.userId && (
                              <span
                                className="block text-[10px] font-mono text-slate-500"
                                dir="ltr"
                              >
                                {row.userId}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-violet-300" dir="ltr">
                            {row.hostId || '—'}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-400" dir="ltr">
                            {row.ipAddress || '—'}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-400" dir="ltr">
                            {row.createdAt?.slice(0, 19).replace('T', ' ')}
                          </td>
                        </>
                      )}

                      {/* SESSIONS COLUMNS */}
                      {activeEntity === 'sessions' && (
                        <>
                          <td className="py-3 px-4">
                            <div className="text-white font-medium">
                              {row.user?.displayName || row.user?.username}
                            </div>
                            <div className="text-[10px] font-mono text-slate-500" dir="ltr">
                              {row.user?.publicId}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <span
                              className={
                                row.status === 'ACTIVE'
                                  ? 'text-emerald-400'
                                  : 'text-slate-500'
                              }
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-400" dir="ltr">
                            {row.ipAddress || '—'}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-400" dir="ltr">
                            {row.expiresAt?.slice(0, 19).replace('T', ' ')}
                          </td>
                        </>
                      )}

                      {/* NODES COLUMNS */}
                      {activeEntity === 'nodes' && (
                        <>
                          <td className="py-3 px-4 font-semibold text-white" dir="ltr">
                            {row.name}
                          </td>
                          <td className="py-3 px-4 text-slate-300">{row.location}</td>
                          <td className="py-3 px-4 font-mono text-slate-400" dir="ltr">
                            {row.fqdn}:{row.daemonPort}
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <span
                              className={
                                row.liveConnected ? 'text-emerald-400' : 'text-amber-400'
                              }
                            >
                              {row.liveConnected ? 'CONNECTED' : row.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums" dir="ltr">
                            {row.counts?.hosts ?? 0}
                          </td>
                        </>
                      )}

                      {/* DATABASES COLUMNS */}
                      {activeEntity === 'databases' && (
                        <>
                          <td className="py-3 px-4 font-mono font-semibold text-white" dir="ltr">
                            {row.name}
                          </td>
                          <td className="py-3 px-4 font-mono text-violet-300" dir="ltr">
                            {row.engine}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-300" dir="ltr">
                            {row.hostId || row.host?.publicId || '—'}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-400" dir="ltr">
                            {row.hostAddress}:{row.port}
                          </td>
                          <td className="py-3 px-4 font-mono text-emerald-400">
                            {row.status}
                          </td>
                        </>
                      )}

                      {/* SCHEDULES COLUMNS */}
                      {activeEntity === 'schedules' && (
                        <>
                          <td className="py-3 px-4 font-semibold text-white">
                            {row.name}
                          </td>
                          <td className="py-3 px-4 font-mono text-violet-300" dir="ltr">
                            {row.cronExpression}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-300" dir="ltr">
                            {row.taskType}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-400" dir="ltr">
                            {row.hostId || row.host?.publicId || '—'}
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <span
                              className={
                                row.isActive ? 'text-emerald-400' : 'text-slate-500'
                              }
                            >
                              {row.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                        </>
                      )}

                      {/* BACKUPS COLUMNS */}
                      {activeEntity === 'backups' && (
                        <>
                          <td className="py-3 px-4 font-semibold text-white">
                            {row.name}
                          </td>
                          <td className="py-3 px-4 font-mono text-violet-300" dir="ltr">
                            {row.hostId || row.host?.publicId || '—'}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-300" dir="ltr">
                            {row.sizeBytes} B
                          </td>
                          <td className="py-3 px-4 font-mono text-emerald-400">
                            {row.status}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-400" dir="ltr">
                            {row.createdAt?.slice(0, 19).replace('T', ' ')}
                          </td>
                        </>
                      )}

                      {/* ACTIONS */}
                      <td className="py-3 px-4 text-end whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {activeEntity === 'users' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateUserRole(
                                  row.id,
                                  row.role === 'ADMIN' ? 'USER' : 'ADMIN'
                                )
                              }
                              className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-200 cursor-pointer"
                            >
                              {row.role === 'ADMIN' ? '→ USER' : '→ ADMIN'}
                            </button>
                          )}

                          {activeEntity === 'hosts' && (
                            <>
                              {onInspectHost && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onInspectHost(row.serverId || row.publicId || row.id)
                                  }
                                  className="px-2.5 py-1 rounded bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-[11px] text-violet-200 cursor-pointer"
                                >
                                  {t.manage}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  handleHostStatusChange(
                                    row.id,
                                    row.status === 'SUSPENDED' ? 'OFFLINE' : 'SUSPENDED'
                                  )
                                }
                                className="px-2.5 py-1 rounded bg-amber-950/50 hover:bg-amber-900/50 border border-amber-800/60 text-[11px] text-amber-300 cursor-pointer"
                              >
                                {row.status === 'SUSPENDED'
                                  ? t.adminResumeHostBtn
                                  : t.adminSuspendHostBtn}
                              </button>
                            </>
                          )}

                          {activeEntity === 'sessions' && row.status === 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={() => handleRevokeSession(row.id)}
                              className="px-2.5 py-1 rounded bg-red-950/50 hover:bg-red-900/60 border border-red-800/60 text-[11px] text-red-200 cursor-pointer"
                            >
                              {t.adminRevokeSessionBtn}
                            </button>
                          )}

                          {activeEntity === 'nodes' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteNodeAdmin(row.id)}
                              className="p-1.5 rounded bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 text-red-300 cursor-pointer"
                              title={t.deleteBtn}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setSelectedRecord(row)}
                            className="px-2.5 py-1 rounded bg-[#090A10] hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
                            <span>{t.adminInspectBtn}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-slate-800 bg-[#0C0E18] flex items-center justify-between text-xs text-slate-400">
          <div>
            {t.adminPageLabel} {pagination.page} / {pagination.totalPages} ({pagination.total})
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg bg-[#11131F] border border-slate-800 disabled:opacity-40 text-slate-200 cursor-pointer"
            >
              {t.adminPrevPage}
            </button>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() =>
                setPage((p) => Math.min(pagination.totalPages, p + 1))
              }
              className="px-3 py-1.5 rounded-lg bg-[#11131F] border border-slate-800 disabled:opacity-40 text-slate-200 cursor-pointer"
            >
              {t.adminNextPage}
            </button>
          </div>
        </div>
      </div>

      {/* Record Inspection Drawer / Modal */}
      {selectedRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-[#101220] border border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-4 h-4 text-violet-400" />
                <h3 className="text-sm font-bold text-white">
                  {t.adminRecordDetailsTitle} —{' '}
                  <span className="font-mono text-violet-300" dir="ltr">
                    {selectedRecord.publicId ||
                      selectedRecord.serverId ||
                      selectedRecord.id}
                  </span>
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 max-h-[70vh] overflow-y-auto space-y-4">
              <pre
                dir="ltr"
                className="p-4 rounded-xl bg-[#080911] border border-slate-800 text-[11px] font-mono text-slate-200 overflow-x-auto leading-relaxed"
              >
                {JSON.stringify(selectedRecord, null, 2)}
              </pre>

              {activeEntity === 'hosts' && (
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleDeleteHostAdmin(selectedRecord.id)}
                    className="px-3.5 py-2 rounded-lg bg-red-950/60 hover:bg-red-900 border border-red-800 text-xs font-semibold text-red-200 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t.deleteHostTitle}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
