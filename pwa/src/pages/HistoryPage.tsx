import { useState, useEffect, useMemo } from "react";
import { getDeliveryHistory } from "../services/api.ts";
import { CheckCircle2, XCircle, RotateCw, Calendar, DollarSign, PackageCheck } from "lucide-react";

type PeriodFilter = "hoje" | "semana" | "mes" | "todas";

export function HistoryPage() {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilter>("hoje");

  useEffect(() => {
    getDeliveryHistory()
      .then((res) => {
        setDeliveries(res.deliveries || []);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("Falha ao carregar histórico:", err);
        setLoading(false);
      });
  }, []);

  // Filtra as entregas pelo período selecionado
  const filteredDeliveries = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    return deliveries.filter((d) => {
      const dDate = new Date(d.entregue_em || d.atualizado_em || d.criado_em);

      if (period === "hoje") {
        return dDate >= startOfToday;
      }
      if (period === "semana") {
        return dDate >= startOfWeek;
      }
      if (period === "mes") {
        return dDate >= startOfMonth;
      }
      return true; // "todas"
    });
  }, [deliveries, period]);

  const totalGanhos = useMemo(() => {
    return filteredDeliveries
      .filter((d) => d.status === "entregue")
      .reduce((acc, d) => acc + (Number(d.valor_corrida) || 0), 0);
  }, [filteredDeliveries]);

  const totalEntregas = useMemo(() => {
    return filteredDeliveries.filter((d) => d.status === "entregue").length;
  }, [filteredDeliveries]);

  const periodLabels: Record<PeriodFilter, string> = {
    hoje: "Ganhos de Hoje",
    semana: "Ganhos da Semana",
    mes: "Ganhos do Mês",
    todas: "Ganhos Totais",
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <header className="bg-white border-b border-slate-200 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sticky top-0 z-30 flex items-center justify-between">
        <h1 className="font-bold text-base text-slate-900 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-brand-600" />
          <span>Histórico & Acertos</span>
        </h1>
        <span className="text-xs text-slate-400 font-medium">Acerto diário</span>
      </header>

      <main className="flex-1 p-4 max-w-md w-full mx-auto space-y-4">
        {/* Filtros de Período */}
        <div className="grid grid-cols-4 p-1 bg-white rounded-2xl border border-slate-200/80 shadow-xs text-xs font-bold text-center">
          <button
            type="button"
            onClick={() => setPeriod("hoje")}
            className={`py-2 rounded-xl transition-all cursor-pointer ${
              period === "hoje"
                ? "bg-brand-600 text-white shadow-xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => setPeriod("semana")}
            className={`py-2 rounded-xl transition-all cursor-pointer ${
              period === "semana"
                ? "bg-brand-600 text-white shadow-xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Semana
          </button>
          <button
            type="button"
            onClick={() => setPeriod("mes")}
            className={`py-2 rounded-xl transition-all cursor-pointer ${
              period === "mes"
                ? "bg-brand-600 text-white shadow-xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Mês
          </button>
          <button
            type="button"
            onClick={() => setPeriod("todas")}
            className={`py-2 rounded-xl transition-all cursor-pointer ${
              period === "todas"
                ? "bg-brand-600 text-white shadow-xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Todas
          </button>
        </div>

        {/* Card Resumo de Ganhos para Acerto */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-3xl p-5 shadow-md space-y-3">
          <div className="flex items-center justify-between text-emerald-100 text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <DollarSign className="w-4 h-4" />
              {periodLabels[period]}
            </span>
            <span className="bg-emerald-500/40 px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold">
              {period === "hoje" ? "Fechamento do Dia" : "Período Selecionado"}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-3xl font-extrabold font-mono tracking-tight">
                R$ {totalGanhos.toFixed(2).replace(".", ",")}
              </div>
              <span className="text-xs text-emerald-100/90 font-medium">
                Valor total para acerto com a loja
              </span>
            </div>

            <div className="text-right">
              <div className="text-2xl font-bold font-mono">
                {totalEntregas}
              </div>
              <span className="text-[11px] text-emerald-100/90 font-medium block">
                {totalEntregas === 1 ? "corrida" : "corridas"}
              </span>
            </div>
          </div>
        </div>

        {/* Lista de Entregas do Período */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Corridas ({filteredDeliveries.length})
            </h2>
            <span className="text-[11px] text-slate-400">
              {period === "hoje" ? "Hoje" : period === "semana" ? "Últimos 7 dias" : period === "mes" ? "Este mês" : "Histórico completo"}
            </span>
          </div>

          {loading ? (
            <div className="text-center py-12 text-xs text-slate-400 flex flex-col items-center gap-2">
              <RotateCw className="w-6 h-6 animate-spin text-brand-600" />
              <span>Carregando histórico...</span>
            </div>
          ) : filteredDeliveries.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center space-y-2">
              <PackageCheck className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-xs font-semibold text-slate-600">Nenhuma entrega neste período.</p>
              <p className="text-[11px] text-slate-400">
                {period === "hoje"
                  ? "As entregas finalizadas hoje aparecerão aqui somando seus ganhos."
                  : "Selecione outro período acima para visualizar suas entregas anteriores."}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredDeliveries.map((d) => {
                const isEntregue = d.status === "entregue";
                const dDate = new Date(d.entregue_em || d.atualizado_em || d.criado_em);
                const dataFormatada = dDate.toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <div key={d.id} className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {isEntregue ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                        )}
                        <span className="text-xs font-bold text-slate-800 capitalize">
                          {isEntregue ? "Entregue com Sucesso" : "Cancelada"}
                        </span>
                      </div>
                      <span className="text-sm font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg border border-emerald-100">
                        R$ {Number(d.valor_corrida || 0).toFixed(2).replace(".", ",")}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 space-y-0.5">
                      <div className="flex justify-between items-center">
                        <strong className="text-slate-800">{d.cliente_nome}</strong>
                        <span className="text-[11px] font-mono text-slate-400">Pedido #{d.core_order_id}</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {d.endereco_entrega?.logradouro}, {d.endereco_entrega?.numero}
                        {d.endereco_entrega?.bairro ? ` - ${d.endereco_entrega?.bairro}` : ""}
                        {d.endereco_entrega?.cidade ? `, ${d.endereco_entrega?.cidade}` : ""}
                      </p>
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-slate-400 pt-2 border-t border-slate-100">
                      <span>{d.store?.nome || "Polpê's"}</span>
                      <span>{dataFormatada}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
