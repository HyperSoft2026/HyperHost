import {
  normalizeLocale,
  type ApiErrorPayload,
  type ApiSuccessPayload,
} from '../shared/types';

export class ClientApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ClientApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function getCurrentBrowserLocale(): string {
  if (typeof window === 'undefined') return 'ar-IQ';
  try {
    return normalizeLocale(window.localStorage.getItem('hyperhost_locale'));
  } catch {
    return 'ar-IQ';
  }
}

let cachedCsrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  cachedCsrfToken = token;
}

function getCsrfCookieValue(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)hyperhost_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1].trim()) : null;
}

export function getActiveCsrfToken(): string | null {
  return cachedCsrfToken || getCsrfCookieValue();
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const csrfToken = getActiveCsrfToken();
  const headers: Record<string, string> = {
    'X-HyperHost-Request': '1',
    'X-HyperHost-Locale': getCurrentBrowserLocale(),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  };

  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  });

  const payload = (await response.json()) as
    | ApiSuccessPayload<T>
    | ApiErrorPayload;

  if (!response.ok || !payload.success) {
    const err =
      'error' in payload
        ? payload.error
        : {
            code: 'HTTP_ERROR',
            message: `Request failed with status ${response.status}`,
          };
    throw new ClientApiError(err.code, err.message, response.status, err.details);
  }

  return payload.data;
}
