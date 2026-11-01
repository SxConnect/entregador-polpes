import { Bike, ShieldCheck, MapPin } from "lucide-react";

export function App() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 max-w-md mx-auto shadow-sm">
      <header className="bg-brand-600 text-white p-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <Bike className="w-6 h-6" />
          <h1 className="font-bold text-lg tracking-tight">Entregador</h1>
        </div>
        <div className="flex items-center gap-1.5 text-xs bg-brand-700/60 px-2.5 py-1 rounded-full font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse"></span>
          <span>Online</span>
        </div>
      </header>

      <main className="flex-1 p-4 space-y-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm text-center space-y-3">
          <div className="w-12 h-12 bg-brand-50 text-brand-600 rounded-full flex items-center justify-center mx-auto">
            <MapPin className="w-6 h-6" />
          </div>
          <h2 className="font-bold text-base text-slate-800">Nenhuma corrida no momento</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Fique com o aplicativo aberto para receber notificações de novas entregas da loja.
          </p>
        </div>

        <div className="bg-brand-50/70 border border-brand-200 rounded-2xl p-4 flex items-start gap-3 text-xs text-brand-800">
          <ShieldCheck className="w-5 h-5 shrink-0 text-brand-600 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Rastreamento Ativo</span>
            Sua localização só é transmitida para a loja e para o cliente durante uma corrida em andamento.
          </div>
        </div>
      </main>

      <footer className="p-3 bg-white border-t border-slate-200 text-center text-[11px] text-slate-400">
        Entregador Polpes · v1.0.0
      </footer>
    </div>
  );
}
