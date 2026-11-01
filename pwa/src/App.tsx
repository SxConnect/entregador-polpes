import { useState, useEffect } from "react";
import { getProfile, getActiveDelivery } from "./services/api.ts";
import { LoginPage } from "./pages/LoginPage.tsx";
import { InvitePage } from "./pages/InvitePage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { HistoryPage } from "./pages/HistoryPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { TrackingPage } from "./pages/TrackingPage.tsx";
import { EmbedPanelPage } from "./pages/EmbedPanelPage.tsx";
import { BottomNav, NavTab } from "./components/BottomNav.tsx";

export function App() {
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState<any>(null);
  const [stores, setStores] = useState<any[]>([]);
  const [currentTab, setCurrentTab] = useState<NavTab>("home");
  const [hasActiveDelivery, setHasActiveDelivery] = useState(false);

  // Rota de convite: detecta se pathname é /convite/:token
  const inviteMatch = window.location.pathname.match(/\/convite\/([a-zA-Z0-9_-]+)/);
  const inviteToken = inviteMatch ? inviteMatch[1] : null;

  // Rota de rastreio público: detecta se pathname é /t/:token
  const trackingMatch = window.location.pathname.match(/\/t\/([a-zA-Z0-9_-]+)/);
  const trackingToken = trackingMatch ? trackingMatch[1] : null;

  // Rota do painel embutível da loja
  const isEmbed = window.location.pathname.startsWith("/embed/painel");

  useEffect(() => {
    function handleUnauthorized() {
      setCourier(null);
    }
    window.addEventListener("entregador:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("entregador:unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    if (inviteToken || trackingToken || isEmbed) {
      setLoading(false);
      return;
    }
    loadProfile();
  }, [inviteToken, trackingToken, isEmbed]);

  async function loadProfile() {
    setLoading(true);
    try {
      const res = await getProfile();
      setCourier(res.courier);
      setStores(res.stores || []);

      // Checa se há corrida ativa
      const act = await getActiveDelivery().catch(() => ({ delivery: null }));
      setHasActiveDelivery(Boolean(act.delivery));
    } catch {
      setCourier(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <img
            src="/logo-polpes.png"
            alt="Entregador"
            className="w-16 h-16 rounded-2xl mx-auto object-contain bg-white p-1 border border-slate-200 shadow-md animate-bounce"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = "/logo-default.png";
            }}
          />
          <p className="text-xs text-slate-500 font-semibold tracking-wide">Carregando Entregador...</p>
        </div>
      </div>
    );
  }

  // Se acessou por link de convite
  if (inviteToken) {
    return (
      <InvitePage
        token={inviteToken}
        onSuccess={() => {
          // Remove rota do convite da barra de endereços e carrega o perfil
          window.history.replaceState(null, "", "/");
          loadProfile();
        }}
      />
    );
  }

  // Se acessou por link de rastreamento público do cliente
  if (trackingToken) {
    return <TrackingPage token={trackingToken} />;
  }

  // Se acessou pela rota do painel embutível da loja
  if (isEmbed) {
    return <EmbedPanelPage authQuery={window.location.search} />;
  }

  // Se não autenticado
  if (!courier) {
    return <LoginPage onSuccess={loadProfile} />;
  }

  // App Autenticado
  return (
    <div className="min-h-screen max-w-md mx-auto relative bg-slate-50">
      {currentTab === "home" && (
        <HomePage courier={courier} onRefreshProfile={loadProfile} />
      )}

      {currentTab === "history" && <HistoryPage />}

      {currentTab === "profile" && (
        <ProfilePage
          courier={courier}
          stores={stores}
          onLogout={() => setCourier(null)}
        />
      )}

      <BottomNav
        currentTab={currentTab}
        onChangeTab={setCurrentTab}
        hasActiveDelivery={hasActiveDelivery}
      />
    </div>
  );
}
