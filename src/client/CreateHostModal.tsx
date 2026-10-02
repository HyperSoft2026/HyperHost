import React, { useState } from 'react';
import { X, AlertCircle, Check, Cpu, HardDrive, Zap, ShieldCheck } from 'lucide-react';
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
  onCreated: (
    hostId: string,
    notification?: { sent: boolean; reason: string | null }
  ) => void;
  currentHostCount: number;
  availableNodes: Array<{
    id: string;
    name: string;
    location: string;
    liveConnected: boolean;
  }>;
  isAdmin?: boolean;
}

export const CreateHostModal: React.FC<CreateHostModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  currentHostCount,
  availableNodes,
  isAdmin = false,
}) => {
  const { t, isRtl } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<HostTypeCode>('DISCORD_BOT');
  const [runtime, setRuntime] = useState<HostRuntimeCode>('NODEJS');
  const [runtimeVersion, setRuntimeVersion] = useState('22');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const selectedRuntimeSpec =
    RUNTIME_CATALOG.find((r) => r.code === runtime) || RUNTIME_CATALOG[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (currentHostCount >= MAX_HOSTS_PER_USER) {
      setError(
        isRtl
          ? `تم الوصول إلى الحد الأقصى للحساب (${MAX_HOSTS_PER_USER} استضافات).`
          : `Account limit reached (${MAX_HOSTS_PER_USER} Hosts maximum).`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{
        host: { id: string; publicId?: string; serverId?: string };
        notification?: { sent: boolean; reason: string | null };
      }>('/api/hosts', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          type,
          runtime,
          runtimeVersion,
          nodeId: null,
          planCode: 'FREE',
        }),
      });
      onCreated(
        res.host.serverId || res.host.publicId || res.host.id,
        res.notification
      );
      onClose();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError(isRtl ? 'تعذّر إنشاء الاستضافة.' : 'Failed to create Host.');
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

            {/* Hosting Plan Card (Strict Server-Enforced Quota Snapshot) */}
            <div className="sm:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-300">
                  {t.hostingPlanLabel}
                </label>
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  {isRtl ? 'خطة نشطة معتمدة' : 'Active Plan'}
                </span>
              </div>

              <div className="relative overflow-hidden rounded-xl border border-indigo-500/50 bg-gradient-to-br from-indigo-950/40 via-[#0E101D] to-[#121424] p-4 transition-all shadow-lg shadow-indigo-950/20">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-indigo-900/30">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300">
                      <Zap className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white tracking-wide">
                          {t.freePlanBadge}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          FREE
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {t.freePlanDesc}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium self-start sm:self-center">
                    <Check className="w-3.5 h-3.5" />
                    <span>{isRtl ? 'محددة تلقائياً' : 'Selected'}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 text-slate-200">
                    <Cpu className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[10px] text-slate-400 font-medium">{t.cpuLimit}</div>
                      <div className="text-xs font-semibold text-white font-mono" dir="ltr">100% CPU</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 text-slate-200">
                    <Zap className="w-4 h-4 text-violet-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[10px] text-slate-400 font-medium">{t.ramLimit}</div>
                      <div className="text-xs font-semibold text-white font-mono" dir="ltr">512 MB RAM</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 text-slate-200">
                    <HardDrive className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[10px] text-slate-400 font-medium">{isRtl ? 'سعة التخزين NVMe' : 'Storage Limit'}</div>
                      <div className="text-xs font-semibold text-emerald-300 font-mono" dir="ltr">800 MB Storage</div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pt-3 text-[11px] text-slate-400">
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>{t.planSnapshotNotice}</span>
                </div>
              </div>
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
