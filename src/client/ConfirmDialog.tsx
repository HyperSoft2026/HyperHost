import React from 'react';
import { AlertTriangle, AlertCircle, X, Check, Loader2 } from 'lucide-react';
import { useI18n } from './i18n';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  bulletPoints?: string[];
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  bulletPoints = [],
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const { isRtl } = useI18n();

  if (!isOpen) return null;

  const defaultConfirmText =
    confirmLabel ||
    (isRtl
      ? variant === 'danger'
        ? 'تأكيد الحذف'
        : 'تأكيد التنفيذ'
      : variant === 'danger'
      ? 'Confirm Delete'
      : 'Confirm');

  const defaultCancelText = cancelLabel || (isRtl ? 'إلغاء' : 'Cancel');

  const buttonStyle =
    variant === 'danger'
      ? 'bg-rose-600 hover:bg-rose-500 text-white'
      : variant === 'warning'
      ? 'bg-amber-600 hover:bg-amber-500 text-white'
      : 'bg-violet-600 hover:bg-violet-500 text-white';

  const iconStyle =
    variant === 'danger'
      ? 'text-rose-400 bg-rose-950/50 border-rose-800/60'
      : variant === 'warning'
      ? 'text-amber-400 bg-amber-950/50 border-amber-800/60'
      : 'text-violet-400 bg-violet-950/50 border-violet-800/60';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="bg-[#11131F] border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border ${iconStyle}`}>
              {variant === 'danger' ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
            </div>
            <h3 className="text-base font-bold text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
          {message}
        </p>

        {bulletPoints.length > 0 && (
          <div className="p-3.5 rounded-xl bg-[#090A12] border border-slate-800/80 space-y-2">
            <div className="text-[11px] font-semibold text-rose-300">
              {isRtl ? 'العمليات والموارد التي سيتم حذفها:' : 'Affected resources and operations:'}
            </div>
            <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
              {bulletPoints.map((point, idx) => (
                <li key={idx} className="font-mono text-[11px]">
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-700/80 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            {defaultCancelText}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={loading}
            className={`px-4 py-2 text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 ${buttonStyle}`}
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>{defaultConfirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
