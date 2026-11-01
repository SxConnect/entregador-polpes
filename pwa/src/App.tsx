import { useState, useEffect } from "react";
import { getProfile, getActiveDelivery } from "./services/api.ts";
import { LoginPage } from "./pages/LoginPage.tsx";
import { InvitePage } from "./pages/InvitePage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { HistoryPage } from "./pages/HistoryPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { BottomNav, NavTab } from "./components/BottomNav.tsx";
import { Bike } from "lucide-react";

export function App() {
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState<any>(null);
  const [stores, setStores] = useState<any[]>([]);
  const [currentTab, setCurrentTab] = useState<NavTab>("home");
  const [hasActiveDelivery, setHasActiveDelivery] = useState(false);

  // Rota de convite: detecta se pathname é /convite/:token
  const inviteMatch = window.location.pathname.match(/\/convite\/([a-zA-Z0-9_-]+)/);
  const inviteToken = inviteMatch ? inviteMatch[1] : null;

  useEffect(() => {
    function handleUnauthorized() {
      setCourier(null);
    }
    window.addEventListener("entregador:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("entregador:unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    if (inviteToken) {
      setLoading(false);
      return;
    }
    loadProfile();
  }, [inviteToken]);

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
          <div className="w-12 h-12 bg-brand-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-md animate-bounce">
            <Bike className="w-6 h-6" />
          </div>
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
