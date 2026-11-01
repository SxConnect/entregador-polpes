import { Bike, ShieldCheck, Store, LogOut } from "lucide-react";
import { removeToken } from "../services/api.ts";

interface Props {
  courier: any;
  stores: any[];
  onLogout: () => void;
}

export function ProfilePage({ courier, stores, onLogout }: Props) {
  function handleLogout() {
    if (confirm("Deseja realmente sair do aplicativo?")) {
      removeToken();
      onLogout();
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900 pb-20">
      <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-30">
        <h1 className="font-bold text-base text-slate-900">Meu Perfil</h1>
      </header>

      <main className="flex-1 p-4 max-w-md w-full mx-auto space-y-4">
        {/* Card Dados Pessoais */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
            <div className="w-12 h-12 bg-brand-50 text-brand-700 rounded-2xl flex items-center justify-center font-bold text-lg">
              <Bike className="w-6 h-6" />
            </div>
            <div>
              <strong className="text-base text-slate-900 block leading-tight">{courier?.nome}</strong>
              <span className="text-xs text-slate-400 font-mono">{courier?.telefone}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Veículo</span>
              <strong className="text-slate-800 capitalize">{courier?.veiculo || "Moto"}</strong>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Placa</span>
              <strong className="text-slate-800 uppercase font-mono">{courier?.placa || "N/A"}</strong>
            </div>
          </div>
        </div>

        {/* Card Lojas Vinculadas */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center gap-2 text-slate-700 font-bold text-xs">
            <Store className="w-4 h-4 text-brand-600" />
            <span>Lojas Vinculadas</span>
          </div>

          {stores.length === 0 ? (
            <p className="text-xs text-slate-400">Nenhuma loja vinculada no momento.</p>
          ) : (
            <div className="space-y-1.5">
              {stores.map((s) => (
                <div key={s.id} className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">{s.nome}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold capitalize">
                    {s.tipo}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Card LGPD e Termos */}
        <div className="bg-brand-50/70 rounded-2xl p-4 border border-brand-200/80 space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 text-brand-800 font-bold">
            <ShieldCheck className="w-4 h-4 text-brand-600" />
            <span>Consentimento de Privacidade (LGPD)</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Termos aceitos em:{" "}
            <strong>
              {courier?.consentimento_lgpd_em
                ? new Date(courier.consentimento_lgpd_em).toLocaleDateString("pt-BR")
                : "Pendente"}
            </strong>
          </p>
          <p className="text-[10px] text-slate-500">
            Sua localização só é monitorada durante entregas ativas para garantir a segurança da rota.
          </p>
        </div>

        {/* Botão Sair */}
        <button
          type="button"
          onClick={handleLogout}
          className="w-full py-3.5 rounded-2xl bg-white border border-red-200 text-red-600 font-bold text-xs hover:bg-red-50 flex items-center justify-center gap-2 transition-colors shadow-xs"
        >
          <LogOut className="w-4 h-4" />
          <span>Sair do Aplicativo</span>
        </button>
      </main>
    </div>
  );
}
