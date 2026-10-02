import React, { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import {
  MAX_HOSTS_PER_USER,
  RUNTIME_CATALOG,
  type HostRuntimeCode,
  type HostTypeCode,
} from '../shared/types';
import { apiFetch, ClientApiError } from './api';
import { useI18n } from './i18n';

interface CreateHostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (hostId: string) => void;
  currentHostCount: number;
  availableNodes: Array<{
    id: string;
    name: string;
    location: string;
    liveConnected: boolean;
  }>;
}

export const CreateHostModal: React.FC<CreateHostModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  currentHostCount,
  availableNodes,
}) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<HostTypeCode>('DISCORD_BOT');
  const [runtime, setRuntime] = useState<HostRuntimeCode>('NODEJS');
  const [runtimeVersion, setRuntimeVersion] = useState('22');
  const [nodeId, setNodeId] = useState<string>('');
  const [memoryLimitMb, setMemoryLimitMb] = useState<number>(512);
  const [cpuLimitPercent, setCpuLimitPercent] = useState<number>(100);
  const [diskLimitMb, setDiskLimitMb] = useState<number>(2048);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const selectedRuntimeSpec =
    RUNTIME_CATALOG.find((r) => r.code === runtime) || RUNTIME_CATALOG[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (currentHostCount >= MAX_HOSTS_PER_USER) {
      setError(`Account limit reached (${MAX_HOSTS_PER_USER} Hosts maximum).`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{ host: { id: string } }>('/api/hosts', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          type,
          runtime,
          runtimeVersion,
          nodeId: nodeId || null,
          memoryLimitMb: Number(memoryLimitMb),
          cpuLimitPercent: Number(cpuLimitPercent),
          diskLimitMb: Number(diskLimitMb),
        }),
      });
      onCreated(res.host.id);
      onClose();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError('Failed to create Host.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#11131F] border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white">{t.createNewHostTitle}</h2>
            <p className="text-xs text-slate-400">
              {t.quotaUsage}:{' '}
              <span className="font-mono tabular-nums text-indigo-300" dir="ltr">
                {currentHostCount} / {MAX_HOSTS_PER_USER}
              </span>{' '}
              {t.hostsWord}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-900 border border-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span dir="ltr">{error}</span>
          </div>
        )}

        {availableNodes.filter((n) => n.liveConnected).length === 0 && (
          <div className="p-3.5 rounded-lg bg-amber-950/30 border border-amber-800/50 text-xs text-amber-200">
            {t.noLiveNodesNotice}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t.hostNameLabel}
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={64}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.hostNamePlaceholder}
                className="w-full px-3.5 py-2 text-sm bg-[#090A10] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t.appTypeLabel}
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as HostTypeCode)}
                className="w-full px-3.5 py-2 text-sm bg-[#090A10] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="DISCORD_BOT">Discord Bot</option>
                <option value="TELEGRAM_BOT">Telegram Bot</option>
                <option value="NODEJS_APP">Node.js Application</option>
                <option value="PYTHON_APP">Python Application</option>
                <option value="JAVA_APP">Java Application</option>
                <option value="GO_APP">Go Application</option>
                <option value="RUST_APP">Rust Application</option>
                <option value="CUSTOM">Custom Workload</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t.runtimeEnvLabel}
              </label>
              <select
                value={runtime}
                onChange={(e) => {
                  const next = e.target.value as HostRuntimeCode;
                  setRuntime(next);
                  const spec = RUNTIME_CATALOG.find((r) => r.code === next);
                  if (spec) setRuntimeVersion(spec.defaultVersion);
                }}
                className="w-full px-3.5 py-2 text-sm bg-[#090A10] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              >
                {RUNTIME_CATALOG.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t.runtimeVersionLabel}
              </label>
              <select
                value={runtimeVersion}
                onChange={(e) => setRuntimeVersion(e.target.value)}
                dir="ltr"
                className="w-full px-3.5 py-2 text-sm font-mono bg-[#090A10] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              >
                {selectedRuntimeSpec.availableVersions.map((ver) => (
                  <option key={ver} value={ver}>
                    v{ver}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t.descriptionOptionalLabel}
              </label>
              <input
                type="text"
                maxLength={280}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.descriptionPlaceholder}
                className="w-full px-3.5 py-2 text-sm bg-[#090A10] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t.targetNodeLabel}
              </label>
              <select
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-[#090A10] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">{t.unassignedNodeOption}</option>
                {availableNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.location}) — {n.liveConnected ? 'ONLINE' : 'OFFLINE'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t.cpuLimitPercentLabel}
              </label>
              <input
                type="number"
                min={25}
                max={800}
                step={25}
                value={cpuLimitPercent}
                onChange={(e) => setCpuLimitPercent(Number(e.target.value))}
                dir="ltr"
                className="w-full px-3.5 py-2 text-sm font-mono tabular-nums bg-[#090A10] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t.memoryLimitMbLabel}
              </label>
              <input
                type="number"
                min={128}
                max={32768}
                step={128}
                value={memoryLimitMb}
                onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
                dir="ltr"
                className="w-full px-3.5 py-2 text-sm font-mono tabular-nums bg-[#090A10] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t.diskLimitMbLabel}
              </label>
              <input
                type="number"
                min={512}
                max={102400}
                step={512}
                value={diskLimitMb}
                onChange={(e) => setDiskLimitMb(Number(e.target.value))}
                dir="ltr"
                className="w-full px-3.5 py-2 text-sm font-mono tabular-nums bg-[#090A10] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting || currentHostCount >= MAX_HOSTS_PER_USER}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              {submitting ? t.creatingHost : t.createHost}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
