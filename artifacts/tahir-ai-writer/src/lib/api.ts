// VITE_API_URL: full origin of the API server (e.g. https://my-api.replit.app).
// Falls back to relative path for local development.
const API_ORIGIN = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const API_BASE = API_ORIGIN ? `${API_ORIGIN}/api` : "/api";

export function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}
