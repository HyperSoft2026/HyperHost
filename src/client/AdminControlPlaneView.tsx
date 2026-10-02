import React, { useEffect, useState } from 'react';
import { Server, Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { apiFetch, ClientApiError } from './api';
import { useI18n } from './i18n';

export const AdminControlPlaneView: React.FC = () => {
  const { t } = useI18n();
  const [overview, setOverview] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);

  // Register Runtime Node Form
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

  async function loadAdminOverview() {
    setError(null);
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
      setNotice(`Registered Runtime Node "${res.node.name}".`);
      setNewToken(res.agentProvisioningToken);
      setNodeName('');
      setNodeLocation('');
      setNodeFqdn('');
      setNodeIp('');
      void loadAdminOverview();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-xl font-bold text-white">{t.adminTitle}</h1>
        <p className="text-xs text-slate-400">{t.adminDesc}</p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start gap-2.5 font-mono">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span dir="ltr">{error}</span>
        </div>
      )}

      {notice && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-200 space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{notice}</span>
          </div>
          {newToken && (
            <div className="p-2.5 rounded bg-black/50 font-mono text-[11px] text-amber-300" dir="ltr">
              One-Time Node Agent Token (Save now — stored as HMAC-SHA256 hash): {newToken}
            </div>
          )}
        </div>
      )}

      {/* Control Plane Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
        {[
          { label: t.adminStatUsers, val: overview?.counts?.users ?? 0 },
          { label: t.adminStatHosts, val: overview?.counts?.hosts ?? 0 },
          { label: t.adminStatRegisteredNodes, val: overview?.counts?.nodes ?? 0 },
          { label: t.adminStatConnectedNodes, val: overview?.counts?.connectedNodes ?? 0 },
          { label: t.adminStatAllocations, val: overview?.counts?.allocations ?? 0 },
          { label: t.adminStatBackups, val: overview?.counts?.backups ?? 0 },
        ].map((stat) => (
          <div
            key={stat.label}
            className="p-4 rounded-xl bg-[#11131F] border border-slate-800"
          >
            <div className="text-xs text-slate-400">{stat.label}</div>
            <div className="text-xl font-bold text-white font-mono tabular-nums mt-1" dir="ltr">
              {stat.val}
            </div>
          </div>
        ))}
      </div>

      {/* Register Runtime Node Form */}
      <form
        onSubmit={handleRegisterNode}
        className="p-6 rounded-xl bg-[#11131F] border border-slate-800 space-y-4"
      >
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Server className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>{t.registerNodeTitle}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t.adminNodeNameLabel}</label>
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
            <label className="block text-xs text-slate-400 mb-1">{t.adminLocationLabel}</label>
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
            <label className="block text-xs text-slate-400 mb-1">{t.adminFqdnLabel}</label>
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
            <label className="block text-xs text-slate-400 mb-1">{t.adminIpAddressLabel}</label>
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
            <label className="block text-xs text-slate-400 mb-1">{t.adminMaxMemoryLabel}</label>
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
            <label className="block text-xs text-slate-400 mb-1">{t.adminMaxDiskLabel}</label>
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
            className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.registerNodeBtn}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
