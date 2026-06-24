export const BLAST_DEFAULT_BASE = "http://localhost:4567";
const BLAST_SELF_ROUTES = new Set(["/blast", "/blast/"]);

export function normalizeBlastBase(value: string | undefined | null): string {
  const trimmed = value?.trim() || BLAST_DEFAULT_BASE;
  return trimmed.replace(/\/+$/, "");
}

export function getBlastBase(env: Record<string, string | undefined> = import.meta.env): string {
  const configured = normalizeBlastBase(env.VITE_BLAST_BASE);
  return isBlastSelfRoute(configured) ? BLAST_DEFAULT_BASE : configured;
}

export function getBlastUrl(path = "", base = getBlastBase()): string {
  const normalizedBase = normalizeBlastBase(base);
  const normalizedPath = path.replace(/^\/+/, "");
  return normalizedPath ? `${normalizedBase}/${normalizedPath}` : normalizedBase;
}

export function isBlastSelfRoute(value: string): boolean {
  return BLAST_SELF_ROUTES.has(value.trim());
}
