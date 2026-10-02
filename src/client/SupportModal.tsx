import React, { useState } from 'react';
import {
  X,
  MessageSquare,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Send,
  Loader2,
} from 'lucide-react';
import { apiFetch, ClientApiError } from './api';
import { useI18n } from './i18n';
import type { AuthenticatedUserDTO } from '../shared/types';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AuthenticatedUserDTO | null;
}

export const SupportModal: React.FC<SupportModalProps> = ({
  isOpen,
  onClose,
  user,
}) => {
  const { isRtl } = useI18n();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    referenceId: string;
    discordNotified: boolean;
  } | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!user) {
      setError(
        isRtl
          ? 'يرجى تسجيل الدخول عبر Discord لتقديم تذكرة دعم فني.'
          : 'Please sign in with Discord OAuth2 to submit a support inquiry.'
      );
      return;
    }

    if (!subject.trim() || !message.trim()) {
      setError(
        isRtl
          ? 'يرجى ملء حقلي الموضوع والتفاصيل.'
          : 'Please fill in both the Subject and Details fields.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{
        referenceId: string;
        status: string;
        createdAt: string;
        discordNotified: boolean;
        discordReason?: string | null;
      }>('/api/support', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim(),
          message: message.trim(),
        }),
      });

      setResult({
        referenceId: res.referenceId,
        discordNotified: res.discordNotified,
      });
      setSubject('');
      setMessage('');
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(`[${err.code}] ${err.message}`);
      } else {
        setError(
          isRtl
            ? 'تعذّر إرسال تذكرة الدعم، يرجى المحاولة لاحقاً.'
            : 'Failed to submit support ticket, please try again.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyRef = () => {
    if (!result?.referenceId) return;
    void navigator.clipboard?.writeText(result.referenceId);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="bg-[#11131F] border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-950/50 border border-violet-800/60 text-violet-400">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {isRtl ? 'تذكرة دعم فني جديدة' : 'New Support Inquiry'}
              </h2>
              <p className="text-xs text-slate-400">HyperHost Support Engine</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Security Warning Banner */}
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-200 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold">
              {isRtl ? 'تنبيه أمني هام: ' : 'Security Notice: '}
            </span>
            <span>
              {isRtl
                ? 'لا تشارك كلمات المرور أو Discord tokens أو API keys أو أي بيانات سرية.'
                : 'Do not share passwords, Discord tokens, API keys, or any sensitive secrets.'}
            </span>
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-200 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result ? (
          <div className="p-5 rounded-xl bg-[#090A12] border border-emerald-800/50 space-y-4">
            <div className="flex items-center gap-2.5 text-emerald-400 font-semibold text-sm">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>
                {isRtl
                  ? 'تم إنشاء تذكرة الدعم الفني بنجاح.'
                  : 'Support request created successfully.'}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#11131F] border border-slate-800 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] text-slate-400">
                  {isRtl ? 'رقم التذكرة المرجعي:' : 'Reference ID:'}
                </div>
                <div className="font-mono text-xs font-bold text-violet-300" dir="ltr">
                  {result.referenceId}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyRef}
                className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
              >
                {copiedRef ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span>{copiedRef ? (isRtl ? 'تم النسخ' : 'Copied') : (isRtl ? 'نسخ' : 'Copy')}</span>
              </button>
            </div>

            <div className="text-xs text-slate-400 leading-relaxed">
              {result.discordNotified ? (
                <span className="text-emerald-300">
                  {isRtl
                    ? '✓ تم إرسال إشعار فوري إلى فريق الدعم عبر Discord.'
                    : '✓ Real-time notification dispatched to HyperHost Discord team.'}
                </span>
              ) : (
                <span className="text-slate-400">
                  {isRtl
                    ? 'ℹ تم تسجيل التذكرة في قاعدة البيانات وسيتم مراجعتها من قِبل الفريق (تعذّر إرسال إشعار Discord المباشر).'
                    : 'ℹ Ticket stored in system database for review (direct Discord DM notification was unavailable).'}
                </span>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  onClose();
                }}
                className="px-4 py-2 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-xl cursor-pointer"
              >
                {isRtl ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 block font-medium">
                  {isRtl ? 'معرّف الحساب / Public ID' : 'Account / Public ID'}
                </label>
                <input
                  type="text"
                  disabled
                  value={user?.publicId || 'usr_...'}
                  dir="ltr"
                  className="w-full px-3 py-2 bg-[#090A12] border border-slate-800 rounded-lg text-slate-400 font-mono text-xs cursor-not-allowed"
                />
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 block font-medium">
                  {isRtl ? 'اسم المستخدم' : 'Username'}
                </label>
                <input
                  type="text"
                  disabled
                  value={user?.displayName || user?.username || '—'}
                  className="w-full px-3 py-2 bg-[#090A12] border border-slate-800 rounded-lg text-slate-400 text-xs cursor-not-allowed"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-300 block font-medium">
                {isRtl ? 'موضوع التذكرة' : 'Subject'} *
              </label>
              <input
                type="text"
                required
                maxLength={128}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={
                  isRtl
                    ? 'مثال: استفسار حول موارد العقدة أو ربط الدومين'
                    : 'e.g. Issue connecting Discord bot runtime'
                }
                className="w-full px-3 py-2 text-xs bg-[#090A12] border border-slate-800 focus:border-violet-500 rounded-lg text-white placeholder:text-slate-600 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-300 block font-medium">
                {isRtl ? 'التفاصيل' : 'Details'} *
              </label>
              <textarea
                required
                rows={4}
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  isRtl
                    ? 'اشرح المشكلة بالتفصيل مع ذكر اسم أو معرّف الاستضافة إن وجد...'
                    : 'Describe the issue or inquiry in detail with host identifier if applicable...'
                }
                className="w-full px-3 py-2 text-xs bg-[#090A12] border border-slate-800 focus:border-violet-500 rounded-lg text-white placeholder:text-slate-600 focus:outline-none resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/80">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-900 border border-slate-700/80 rounded-xl cursor-pointer"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={submitting || !user}
                className="px-4 py-2 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-xl inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>{isRtl ? 'إرسال التذكرة' : 'Submit Ticket'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
