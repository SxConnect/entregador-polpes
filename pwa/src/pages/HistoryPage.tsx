import { useState, useEffect } from "react";
import { getDeliveryHistory } from "../services/api.ts";
import { CheckCircle2, XCircle, RotateCw } from "lucide-react";

export function HistoryPage() {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  const totalGanhos = deliveries
    .filter((d) => d.status === "entregue")
    .reduce((acc, d) => acc + (Number(d.valor_corrida) || 0), 0);

  const totalEntregas = deliveries.filter((d) => d.status === "entregue").length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <header className="bg-white border-b border-slate-200 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sticky top-0 z-30">
        <h1 className="font-bold text-base text-slate-900">Histórico de Entregas</h1>
      </header>

      <main className="flex-1 p-4 max-w-md w-full mx-auto space-y-4">
        {/* Card Resumo de Ganhos */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs grid grid-cols-2 gap-4">
          <div>
            <span className="text-[11px] text-slate-400 font-semibold block">Ganhos em Corridas</span>
            <strong className="text-xl font-bold font-mono text-emerald-700">
              R$ {totalGanhos.toFixed(2).replace(".", ",")}
            </strong>
          </div>
          <div className="border-l border-slate-100 pl-4">
            <span className="text-[11px] text-slate-400 font-semibold block">Concluídas</span>
            <strong className="text-xl font-bold font-mono text-slate-800">{totalEntregas}</strong>
          </div>
        </div>

        {/* Lista de Entregas */}
        {loading ? (
          <div className="text-center py-8 text-xs text-slate-400 flex flex-col items-center gap-2">
            <RotateCw className="w-5 h-5 animate-spin" />
            <span>Carregando histórico...</span>
          </div>
        ) : deliveries.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center text-xs text-slate-400">
            Nenhuma entrega realizada ainda.
          </div>
        ) : (
          <div className="space-y-2.5">
            {deliveries.map((d) => {
              const isEntregue = d.status === "entregue";
              const dataFormatada = new Date(d.entregue_em || d.atualizado_em).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div key={d.id} className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {isEntregue ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                      )}
                      <span className="text-xs font-bold text-slate-800 capitalize">
                        {isEntregue ? "Entregue" : "Cancelado"}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-700">
                      R$ {Number(d.valor_corrida || 0).toFixed(2).replace(".", ",")}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600">
                    <p className="font-medium text-slate-800">{d.cliente_nome}</p>
                    <p className="text-[11px] text-slate-400">
                      {d.endereco_entrega?.logradouro}, {d.endereco_entrega?.numero} - {d.endereco_entrega?.bairro}
                    </p>
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                    <span>Pedido #{d.core_order_id}</span>
                    <span>{dataFormatada}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
