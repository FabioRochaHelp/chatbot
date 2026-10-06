export class ApiError extends Error {
    status: number;
    code: string;
    details?: unknown;

    constructor(status: number, code: string, message: string, details?: unknown) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    /** Erros de validação por campo: { campo: mensagem }. */
    get fieldErrors(): Record<string, string> {
        if (!Array.isArray(this.details)) return {};
        return Object.fromEntries(
            (this.details as { field: string; message: string }[]).map(detail => [detail.field, detail.message])
        );
    }
}

type Options = { method?: string; body?: unknown; token?: string };

async function request<T>(path: string, { method = 'GET', body, token }: Options = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    let response: Response;
    try {
        response = await fetch('/api/v1' + path, {
            method,
            headers,
            credentials: 'same-origin',
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch {
        throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível falar com o servidor.');
    }
    const json = await response.json().catch(() => null);
    if (!response.ok) {
        const error = json?.error;
        throw new ApiError(
            response.status,
            error?.code || 'HTTP_' + response.status,
            error?.message || 'Erro inesperado.',
            error?.details
        );
    }
    return json as T;
}

export type Page<T> = { data: T[]; meta: { total: number; limit: number; offset: number } };

export const api = {
    get: async <T>(path: string) => (await request<{ data: T }>(path)).data,
    page: <T>(path: string) => request<Page<T>>(path),
    post: async <T>(path: string, body?: unknown, options: Omit<Options, 'method' | 'body'> = {}) =>
        (await request<{ data: T }>(path, { method: 'POST', body: body ?? {}, ...options })).data,
    patch: async <T>(path: string, body: unknown) => (await request<{ data: T }>(path, { method: 'PATCH', body })).data,
    delete: async <T>(path: string) => (await request<{ data: T }>(path, { method: 'DELETE' })).data
};
