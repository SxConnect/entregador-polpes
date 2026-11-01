import { useState, useEffect } from "react";
import {
  Bike,
  CheckCircle2,
  Clock,
  MapPin,
  ShieldCheck,
  AlertCircle,
  Navigation,
} from "lucide-react";

interface Props {
  token: string;
}

const STATUS_INFO: Record<
  string,
  { label: string; description: string; step: number; color: string }
> = {
  pendente: {
    label: "Preparando seu pedido",
    description: "A loja está organizando os itens e aguardando um entregador.",
    step: 1,
    color: "text-amber-600 bg-amber-50 border-amber-200",
  },
  atribuido: {
    label: "Entregador designado",
    description: "Um entregador parceiro já foi vinculado ao seu pedido.",
    step: 1,
    color: "text-blue-600 bg-blue-50 border-blue-200",
  },
  aceito: {
    label: "Entregador a caminho da loja",
    description: "O entregador está se deslocando para retirar o seu pedido.",
    step: 2,
    color: "text-blue-600 bg-blue-50 border-blue-200",
  },
  coletado: {
    label: "Pedido coletado na loja",
    description: "O pedido foi retirado e a rota de entrega começará em instantes.",
    step: 2,
    color: "text-indigo-600 bg-indigo-50 border-indigo-200",
  },
  em_rota: {
    label: "Entregador a caminho!",
    description: "Seu pedido está na rota final de entrega até o seu endereço.",
    step: 3,
    color: "text-emerald-700 bg-emerald-50 border-emerald-300",
  },
  entregue: {
    label: "Pedido Entregue!",
    description: "Sua entrega foi finalizada com sucesso. Esperamos que aproveite!",
    step: 4,
    color: "text-green-700 bg-green-50 border-green-200",
  },
  cancelado: {
    label: "Pedido Cancelado",
    description: "Esta entrega foi cancelada pela loja.",
    step: 0,
    color: "text-red-700 bg-red-50 border-red-200",
  },
};

export function TrackingPage({ token }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const API_BASE =
    import.meta.env.VITE_API_URL ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

  useEffect(() => {
    fetchTracking();
    const interval = setInterval(fetchTracking, 6000);
    return () => clearInterval(interval);
  }, [token]);

  async function fetchTracking() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/tracking/${token}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || "Entrega não encontrada");
      }
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Não foi possível carregar o rastreamento.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs text-slate-500 font-semibold">Localizando entrega...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm max-w-sm w-full text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-800">Rastreamento Indisponível</h2>
          <p className="text-xs text-slate-500 leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  const statusObj = STATUS_INFO[data.status] || {
    label: "Status: " + data.status,
    description: "",
    step: 1,
    color: "text-slate-700 bg-slate-50 border-slate-200",
  };

  const isCompleted = data.status === "entregue";
  const isCancelled = data.status === "cancelado";

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-100 text-slate-900 max-w-md mx-auto shadow-sm">
      {/* Header com Loja e Logo */}
      <header className="bg-white border-b border-slate-200 p-4 sticky top-0 z-30 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src={data.store.logo_url || "/logo-polpes.png"}
            alt={data.store.nome}
            className="w-10 h-10 rounded-xl object-contain bg-white border border-slate-200 p-0.5 shadow-xs"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = "/logo-default.png";
            }}
          />
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-bold block">Acompanhamento</span>
            <strong className="text-sm font-bold text-slate-900">{data.store.nome}</strong>
          </div>
        </div>

        <div className="text-right">
          <span className="text-[10px] text-slate-400 block font-medium">Pedido</span>
          <span className="text-xs font-bold font-mono text-slate-800">#{data.core_order_id}</span>
        </div>
      </header>

      <main className="flex-1 p-4 space-y-4">
        {/* Card de Status Principal */}
        <div className={`rounded-3xl p-5 border shadow-xs space-y-3 ${statusObj.color}`}>
          <div className="flex items-center gap-2">
            {isCompleted ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : isCancelled ? (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            ) : (
              <Clock className="w-5 h-5 text-brand-600 shrink-0 animate-pulse" />
            )}
            <h2 className="text-base font-extrabold">{statusObj.label}</h2>
          </div>
          <p className="text-xs leading-relaxed opacity-90">{statusObj.description}</p>

          {/* Stepper Visual */}
          {!isCancelled && (
            <div className="pt-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1.5">
                <span className={statusObj.step >= 1 ? "text-emerald-700" : ""}>1. Loja</span>
                <span className={statusObj.step >= 2 ? "text-emerald-700" : ""}>2. Coleta</span>
                <span className={statusObj.step >= 3 ? "text-emerald-700" : ""}>3. A caminho</span>
                <span className={statusObj.step >= 4 ? "text-emerald-700" : ""}>4. Entregue</span>
              </div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
                  style={{
                    width:
                      statusObj.step === 1
                        ? "25%"
                        : statusObj.step === 2
                        ? "50%"
                        : statusObj.step === 3
                        ? "75%"
                        : "100%",
                  }}
                ></div>
              </div>
            </div>
          )}
        </div>

        {/* Banner do Código de 4 Dígitos */}
        {data.codigo_confirmacao && (
          <div className="bg-white rounded-3xl p-5 border-2 border-emerald-500 shadow-md text-center space-y-2">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-800 uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Código de Confirmação</span>
            </div>
            <p className="text-xs text-slate-600">
              Informe estes <strong>4 dígitos</strong> ao entregador quando ele chegar para liberar o pedido:
            </p>
            <div className="py-2">
              <span className="font-mono text-4xl font-extrabold tracking-widest text-emerald-700 bg-emerald-50 px-6 py-2 rounded-2xl border border-emerald-200 inline-block shadow-inner">
                {data.codigo_confirmacao}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 block">
              Garante que apenas você pode receber esta entrega com segurança.
            </span>
          </div>
        )}

        {/* Mapa / Localização do Entregador */}
        {data.courier_location && data.status === "em_rota" && (
          <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Navigation className="w-4 h-4 text-brand-600" />
                <span>Posição do Entregador</span>
              </div>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                Ao vivo
              </span>
            </div>

            {/* Iframe OpenStreetMap com pino nas coordenadas */}
            <div className="w-full h-48 rounded-2xl overflow-hidden border border-slate-200 relative bg-slate-100">
              <iframe
                title="Mapa de Rastreio"
                className="w-full h-full border-0"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                  data.courier_location.lng - 0.01
                }%2C${data.courier_location.lat - 0.008}%2C${data.courier_location.lng + 0.01}%2C${
                  data.courier_location.lat + 0.008
                }&layer=mapnik&marker=${data.courier_location.lat}%2C${data.courier_location.lng}`}
              />
            </div>
          </div>
        )}

        {/* Dados do Entregador (LGPD Sanitizado) */}
        {data.courier && (
          <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-xs flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center font-bold">
                <Bike className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-medium block">Entregador</span>
                <strong className="text-sm font-bold text-slate-900">{data.courier.nome}</strong>
                <span className="text-[11px] text-slate-500 block capitalize">
                  {data.courier.veiculo} {data.courier.placa ? `• Placa ${data.courier.placa}` : ""}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Endereço de Destino */}
        <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-xs flex items-start gap-3 text-xs">
          <MapPin className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-[10px] text-slate-400 font-semibold block uppercase">Endereço de Entrega</span>
            <p className="font-bold text-slate-800">
              {data.endereco_entrega.logradouro}, {data.endereco_entrega.numero}
            </p>
            <p className="text-slate-500">
              {data.endereco_entrega.bairro} - {data.endereco_entrega.cidade}
            </p>
          </div>
        </div>
      </main>

      {/* Rodapé Seguro */}
      <footer className="p-4 text-center text-[11px] text-slate-400 bg-white border-t border-slate-200 flex items-center justify-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-slate-400" />
        <span>Rastreamento em tempo real • Entregador Polpes</span>
      </footer>
    </div>
  );
}
