export function normalizeBase(url) {
  return (url ?? "").trim().replace(/\/+$/, "");
}

export function resolveApiBase() {
  const configured = normalizeBase(import.meta.env.VITE_API_BASE);
  if (configured) {
    return configured;
  }
  return "";
}

export function resolveWsBase(apiBase) {
  const configured = normalizeBase(import.meta.env.VITE_WS_BASE);
  if (configured) {
    return configured;
  }
  if (apiBase) {
    return apiBase.replace(/^http/i, "ws");
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

export function joinUrl(base, path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!base) {
    return normalizedPath;
  }
  return `${normalizeBase(base)}${normalizedPath}`;
}
