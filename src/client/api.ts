import type { ApiErrorPayload, ApiSuccessPayload } from '../shared/types';

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

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
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
