/**
 * Unified API client for all backend requests.
 * All requests go through this layer - no hardcoded URLs in business components.
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

export { API_BASE };

export class ApiError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
    throw new ApiError(err.detail || `Request failed`, response.status);
  }

  return response.json();
}

/**
 * Resolve gene_id from various input formats.
 * If already canonical (gene-XXX), returns as-is.
 * Otherwise searches and returns the canonical gene_id.
 */
export async function resolveGeneId(geneId: string): Promise<string> {
  // Already canonical
  if (geneId.startsWith('gene-')) {
    return geneId;
  }

  // Search to resolve
  const result = await apiFetch<{ items: Array<{ gene_id: string }> }>(
    `/search/genes?q=${encodeURIComponent(geneId)}&limit=1`
  );

  if (!result.items.length) {
    throw new ApiError(`Gene not found: ${geneId}`);
  }

  return result.items[0].gene_id;
}
