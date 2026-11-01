const API_BASE = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

function getToken(): string {
  return localStorage.getItem("entregador_token") || "";
}

export function setToken(token: string): void {
  localStorage.setItem("entregador_token", token);
}

export function removeToken(): void {
  localStorage.removeItem("entregador_token");
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      removeToken();
      window.dispatchEvent(new Event("entregador:unauthorized"));
    }
    throw new Error(data.message || `Erro HTTP ${res.status}`);
  }

  return data;
}

// ── Onboarding / Convite ──────────────────────────────────────────────
export async function getInvite(token: string) {
  return request(`/api/v1/invites/${token}`);
}

export async function acceptInvite(token: string, consentimento_versao = "1.0") {
  return request(`/api/v1/invites/${token}/accept`, {
    method: "POST",
    body: JSON.stringify({ consentimento_lgpd: true, consentimento_versao }),
  });
}

// ── Auth Direta ───────────────────────────────────────────────────────
export async function courierLogin(telefone: string) {
  return request("/api/v1/courier/auth/login", {
    method: "POST",
    body: JSON.stringify({ telefone }),
  });
}

export async function getProfile() {
  return request("/api/v1/courier/me");
}

export async function updateCourierStatus(status: "online" | "offline") {
  return request("/api/v1/courier/status", {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

// ── Corridas ──────────────────────────────────────────────────────────
export async function getActiveDelivery() {
  return request("/api/v1/courier/deliveries/active");
}

export async function getDeliveryHistory() {
  return request("/api/v1/courier/deliveries/history");
}

export async function acceptDelivery(id: string) {
  return request(`/api/v1/courier/deliveries/${id}/accept`, { method: "POST" });
}

export async function rejectDelivery(id: string) {
  return request(`/api/v1/courier/deliveries/${id}/reject`, { method: "POST" });
}

export async function pickupDelivery(id: string) {
  return request(`/api/v1/courier/deliveries/${id}/pickup`, { method: "POST" });
}

export async function startRouteDelivery(id: string) {
  return request(`/api/v1/courier/deliveries/${id}/start-route`, { method: "POST" });
}

export async function completeDelivery(
  id: string,
  codigo_confirmacao: string,
  foto_comprovante_url?: string,
  lat?: number,
  lng?: number
) {
  return request(`/api/v1/courier/deliveries/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({
      codigo_confirmacao,
      foto_comprovante_url,
      lat,
      lng,
    }),
  });
}

// ── Geolocalização ────────────────────────────────────────────────────
export async function sendLocation(lat: number, lng: number, precisao?: number) {
  return request("/api/v1/courier/location", {
    method: "POST",
    body: JSON.stringify({ lat, lng, precisao }),
  });
}
