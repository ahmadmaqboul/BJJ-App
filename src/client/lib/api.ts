export class ApiError extends Error {
  constructor(
    /** Machine-readable code from the server, e.g. 'invalid_credentials'. */
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  /** True when the request never reached the server. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 0);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('bad_response', res.status);
  }

  if (!res.ok) {
    const obj = (payload ?? {}) as { error?: string; details?: unknown };
    throw new ApiError(obj.error ?? 'generic', res.status, obj.details);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/**
 * Turns an ApiError into a translation key. Server codes carry a `:arg`
 * suffix for things like `pin_too_short:6` and `locked_until:<iso>`, so the
 * code is split before lookup and the argument handed back for interpolation.
 */
export function errorKey(err: unknown): { key: string; vars?: Record<string, string> } {
  if (!(err instanceof ApiError)) return { key: 'err.generic' };
  if (err.isOffline) return { key: 'err.network' };

  const [code, arg] = err.code.split(':');

  if (code === 'pin_too_short') return { key: 'err.pin_too_short', vars: { n: arg ?? '4' } };
  if (code === 'locked_until') return { key: 'err.locked' };

  const known = new Set([
    'invalid_credentials',
    'account_disabled',
    'current_pin_wrong',
    'pin_all_same_digit',
    'pin_sequential',
    'pin_unchanged',
    'forbidden',
    'login_taken',
    'phone_required_for_login',
    'bad_phone',
    'bad_amount',
    'member_not_found',
    'no_change',
    'login_required_first',
    'already_staff',
    'date_in_past',
  ]);

  return { key: known.has(code ?? '') ? `err.${code}` : 'err.generic' };
}
