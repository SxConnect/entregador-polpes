import React, { useState, useEffect, useRef } from "react";
import {
  getActiveDelivery,
  acceptDelivery,
  rejectDelivery,
  pickupDelivery,
  startRouteDelivery,
  completeDelivery,
  updateCourierStatus,
} from "../services/api.ts";
import { useWakeLock } from "../hooks/useWakeLock.ts";
import { useGeolocation } from "../hooks/useGeolocation.ts";
import {
  Bike,
  Navigation,
  Phone,
  MessageCircle,
  ExternalLink,
  ShieldCheck,
  CheckCircle,
  RotateCw,
} from "lucide-react";

interface Props {
  courier: any;
  onRefreshProfile: () => void;
}

export function HomePage({ courier, onRefreshProfile }: Props) {
  const [delivery, setDelivery] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeDigits, setCodeDigits] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  const prevStatusRef = useRef<string | null>(null);

  // Status de trabalho do entregador
  const isOnline = courier?.status === "online" || courier?.status === "em_corrida";
  const isInCorrida = Boolean(delivery && ["coletado", "em_rota"].includes(delivery.status));

  // 1. Ativa WakeLock para manter a tela acesa no suporte da moto durante corrida
  useWakeLock(isInCorrida);

  // 2. Transmite GPS em tempo real a cada poucos segundos
  useGeolocation(isInCorrida);

  // Polling para checar novas corridas a cada 5 segundos
  useEffect(() => {
    fetchActive();
    const interval = setInterval(fetchActive, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchActive() {
    try {
      const res = await getActiveDelivery();
      const current = res.delivery;
      setDelivery(current);

      // Toca vibração se receber uma nova corrida atribuída
      if (current && current.status === "atribuido" && prevStatusRef.current !== "atribuido") {
        if ("vibrate" in navigator) {
          navigator.vibrate([200, 100, 200, 100, 400]);
        }
      }
      prevStatusRef.current = current?.status || null;
    } catch (err) {
      console.warn("Falha ao buscar corrida ativa:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleOnline() {
    setActionLoading(true);
    try {
      const nextStatus = isOnline ? "offline" : "online";
      await updateCourierStatus(nextStatus);
      onRefreshProfile();
    } catch (err: any) {
      alert(err.message || "Não foi possível alternar o status.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAccept() {
    if (!delivery) return;
    setActionLoading(true);
    try {
      await acceptDelivery(delivery.id);
      await fetchActive();
      onRefreshProfile();
    } catch (err: any) {
      alert(err.message || "Erro ao aceitar corrida.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!delivery) return;
    if (!confirm("Tem certeza que deseja recusar esta corrida? Ela será disponibilizada para outro entregador.")) {
      return;
    }
    setActionLoading(true);
    try {
      await rejectDelivery(delivery.id);
      await fetchActive();
      onRefreshProfile();
    } catch (err: any) {
      alert(err.message || "Erro ao recusar corrida.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePickup() {
    if (!delivery) return;
    setActionLoading(true);
    try {
      await pickupDelivery(delivery.id);
      await fetchActive();
    } catch (err: any) {
      alert(err.message || "Erro ao confirmar coleta.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStartRoute() {
    if (!delivery) return;
    setActionLoading(true);
    try {
      await startRouteDelivery(delivery.id);
      await fetchActive();
    } catch (err: any) {
      alert(err.message || "Erro ao iniciar rota.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCompleteDelivery(e: React.FormEvent) {
    e.preventDefault();
    if (!delivery) return;

    if (delivery.exigir_codigo_confirmacao && codeDigits.trim().length !== 4) {
      setCodeError("Digite o código de 4 dígitos informado pelo cliente.");
      return;
    }

    setActionLoading(true);
    setCodeError(null);

    try {
      await completeDelivery(delivery.id, codeDigits.trim());
      setShowCodeModal(false);
      setCodeDigits("");
      await fetchActive();
      onRefreshProfile();
      alert("Corrida finalizada com sucesso! Parabéns!");
    } catch (err: any) {
      setCodeError(err.message || "Código incorreto.");
    } finally {
      setActionLoading(false);
    }
  }

  function openNavigation(address: any, app: "google" | "waze") {
    const query = encodeURIComponent(
      `${address.logradouro}, ${address.numero || ""} - ${address.bairro || ""}, ${address.cidade || ""}`
    );
    if (app === "google") {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${query}`, "_blank");
    } else {
      window.open(`https://waze.com/ul?q=${query}&navigate=yes`, "_blank");
    }
  }

  function openWhatsApp(phone: string, text: string) {
    const clean = phone.replace(/\D/g, "");
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(text)}`, "_blank");
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      {/* Header com Status do Entregador */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between shadow-xs sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 p-0.5 shadow-xs flex items-center justify-center overflow-hidden shrink-0">
            <img
              src={courier?.logo_url || "/logo-polpes.png"}
              alt="Logo"
              width="40"
              height="40"
              className="w-full h-full object-contain"
              style={{ width: "100%", height: "100%", maxWidth: "40px", maxHeight: "40px" }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = "/logo-default.png";
              }}
            />
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-900 leading-tight">Olá, {courier?.nome?.split(" ")[0]}</h1>
            <span className="text-[11px] text-slate-500 capitalize">{courier?.veiculo} {courier?.placa ? `• ${courier.placa}` : ""}</span>
          </div>
        </div>

        <button
          type="button"
          disabled={actionLoading || courier?.status === "em_corrida"}
          onClick={handleToggleOnline}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all shadow-xs ${
            isOnline
              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
              : "bg-slate-200 text-slate-700 border border-slate-300"
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`}></span>
          <span>{isOnline ? "Online" : "Offline"}</span>
        </button>
      </header>

      {/* Alerta de Wake Lock e GPS ativo */}
      {isInCorrida && (
        <div className="bg-amber-500 text-white px-4 py-1.5 text-[11px] font-semibold flex items-center justify-between">
          <span>⚡ Rastreamento GPS ativo • Tela bloqueada para uso na moto</span>
          <span className="text-[10px] bg-amber-600 px-2 py-0.5 rounded">Ativo</span>
        </div>
      )}

      <main className="flex-1 p-4 max-w-md w-full mx-auto space-y-4">
        {loading ? (
          <div className="text-center py-12 text-slate-400 text-xs flex flex-col items-center gap-2">
            <RotateCw className="w-5 h-5 animate-spin" />
            <span>Atualizando corridas...</span>
          </div>
        ) : !delivery ? (
          /* Estado Vazio: Aguardando Corridas */
          <div className="bg-white rounded-3xl p-8 border border-slate-200/80 shadow-xs text-center space-y-4 my-auto">
            <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto relative">
              <Bike className="w-10 h-10" />
              {isOnline && (
                <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-30"></span>
              )}
            </div>
            <div className="space-y-1">
              <h2 className="font-bold text-base text-slate-800">
                {isOnline ? "Aguardando novas corridas" : "Você está Offline"}
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                {isOnline
                  ? "Assim que a loja atribuir um pedido a você, uma notificação aparecerá aqui instantaneamente."
                  : "Toque no botão superior para ficar Online e começar a receber pedidos."}
              </p>
            </div>
          </div>
        ) : delivery.status === "atribuido" ? (
          /* Card: Nova Corrida Recebida (Aceitar ou Recusar) */
          <div className="bg-white rounded-3xl border-2 border-amber-400 p-5 shadow-lg space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <span className="bg-amber-100 text-amber-800 font-extrabold text-xs px-2.5 py-1 rounded-full uppercase tracking-wider">
                Nova Corrida Atribuída
              </span>
              <strong className="text-lg font-mono font-bold text-emerald-700">
                R$ {Number(delivery.valor_corrida || 0).toFixed(2).replace(".", ",")}
              </strong>
            </div>

            <div className="space-y-3 text-xs">
              {/* Retirada */}
              <div className="flex items-start gap-2.5">
                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  1
                </span>
                <div>
                  <span className="font-semibold text-slate-500 block">Retirada na loja:</span>
                  <p className="text-slate-800 font-medium">
                    {delivery.endereco_retirada.logradouro}, {delivery.endereco_retirada.numero}
                  </p>
                  <span className="text-[11px] text-slate-400">{delivery.endereco_retirada.bairro}</span>
                </div>
              </div>

              {/* Entrega */}
              <div className="flex items-start gap-2.5">
                <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  2
                </span>
                <div>
                  <span className="font-semibold text-slate-500 block">Entrega para {delivery.cliente_nome}:</span>
                  <p className="text-slate-800 font-medium">
                    {delivery.endereco_entrega.logradouro}, {delivery.endereco_entrega.numero}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {delivery.endereco_entrega.bairro} {delivery.endereco_entrega.referencia ? `(Ref: ${delivery.endereco_entrega.referencia})` : ""}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleReject}
                className="py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200 transition-colors"
              >
                Recusar
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleAccept}
                className="py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-1.5"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Aceitar Corrida</span>
              </button>
            </div>
          </div>
        ) : (
          /* Card: Corrida em Andamento (Aceita, Coletada ou Em Rota) */
          <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
            {/* Stepper Visual */}
            <div className="flex items-center justify-between text-[11px] font-bold pb-3 border-b border-slate-100">
              <span className={delivery.status === "aceito" ? "text-emerald-700" : "text-slate-400"}>1. A caminho</span>
              <span className="text-slate-300">›</span>
              <span className={delivery.status === "coletado" ? "text-emerald-700" : "text-slate-400"}>2. Coletado</span>
              <span className="text-slate-300">›</span>
              <span className={delivery.status === "em_rota" ? "text-emerald-700" : "text-slate-400"}>3. Rota entrega</span>
            </div>

            {/* Endereço Atual em Destaque */}
            <div className="space-y-3">
              {delivery.status === "aceito" ? (
                /* Foco na Coleta */
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Endereço de Retirada (Loja)</span>
                  <div className="font-bold text-sm text-slate-800">
                    {delivery.endereco_retirada.logradouro}, {delivery.endereco_retirada.numero}
                  </div>
                  <div className="text-xs text-slate-500">
                    {delivery.endereco_retirada.bairro} - {delivery.endereco_retirada.cidade}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openNavigation(delivery.endereco_retirada, "google")}
                      className="flex-1 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold flex items-center justify-center gap-1 hover:bg-slate-100"
                    >
                      <Navigation className="w-3.5 h-3.5 text-blue-600" /> Google Maps
                    </button>
                    <button
                      type="button"
                      onClick={() => openNavigation(delivery.endereco_retirada, "waze")}
                      className="flex-1 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold flex items-center justify-center gap-1 hover:bg-slate-100"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-cyan-600" /> Waze
                    </button>
                  </div>
                </div>
              ) : (
                /* Foco na Entrega */
                <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200 space-y-2">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">Destino do Cliente</span>
                  <div className="font-bold text-sm text-slate-900">
                    {delivery.endereco_entrega.logradouro}, {delivery.endereco_entrega.numero}
                  </div>
                  <div className="text-xs text-slate-600">
                    {delivery.endereco_entrega.bairro} {delivery.endereco_entrega.complemento ? `• ${delivery.endereco_entrega.complemento}` : ""}
                  </div>
                  {delivery.endereco_entrega.referencia && (
                    <div className="text-[11px] text-amber-800 bg-amber-100/60 p-2 rounded-lg">
                      Obs/Ref: {delivery.endereco_entrega.referencia}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openNavigation(delivery.endereco_entrega, "google")}
                      className="flex-1 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold flex items-center justify-center gap-1 hover:bg-slate-100"
                    >
                      <Navigation className="w-3.5 h-3.5 text-blue-600" /> Google Maps
                    </button>
                    <button
                      type="button"
                      onClick={() => openNavigation(delivery.endereco_entrega, "waze")}
                      className="flex-1 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold flex items-center justify-center gap-1 hover:bg-slate-100"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-cyan-600" /> Waze
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Contato do Cliente */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-medium block">Cliente</span>
                <strong className="text-xs text-slate-800">{delivery.cliente_nome}</strong>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openWhatsApp(delivery.cliente_telefone, `Olá ${delivery.cliente_nome}, sou o entregador do seu pedido na Polpês!`)}
                  className="p-2 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  title="WhatsApp"
                >
                  <MessageCircle className="w-4 h-4" />
                </button>
                <a
                  href={`tel:${delivery.cliente_telefone.replace(/\D/g, "")}`}
                  className="p-2 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200"
                  title="Ligar"
                >
                  <Phone className="w-4 h-4" />
                </a>
              </div>
            </div>

            {/* Botão de Ação Principal Grande */}
            <div className="pt-2">
              {delivery.status === "aceito" && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handlePickup}
                  className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm shadow-md transition-all"
                >
                  Confirmar Coleta na Loja
                </button>
              )}

              {delivery.status === "coletado" && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleStartRoute}
                  className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm shadow-md transition-all"
                >
                  Iniciar Rota para o Cliente
                </button>
              )}

              {delivery.status === "em_rota" && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => setShowCodeModal(true)}
                  className="w-full py-4 rounded-2xl bg-brand-700 hover:bg-brand-800 text-white font-extrabold text-sm shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-5 h-5" />
                  <span>Cheguei / Finalizar Entrega</span>
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Modal de Código de 4 Dígitos */}
      {showCodeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 bg-brand-50 text-brand-600 rounded-full flex items-center justify-center mx-auto mb-2">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-base text-slate-800">Código de Confirmação</h3>
              <p className="text-xs text-slate-500">
                Peça ao cliente os <strong>4 dígitos</strong> que ele recebeu no comprovante de pedido.
              </p>
            </div>

            <form onSubmit={handleCompleteDelivery} className="space-y-4">
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={codeDigits}
                onChange={(e) => setCodeDigits(e.target.value.replace(/\D/g, ""))}
                placeholder="0 0 0 0"
                className="w-full py-3.5 text-center text-3xl font-mono font-extrabold tracking-widest border-2 border-slate-200 rounded-2xl outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-500/20"
                autoFocus
              />

              {codeError && (
                <div className="p-2.5 rounded-xl bg-red-50 text-red-700 text-xs text-center font-medium">
                  {codeError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCodeModal(false)}
                  className="py-3 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || codeDigits.length !== 4}
                  className="py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-md disabled:opacity-50"
                >
                  {actionLoading ? "Confirmando..." : "Confirmar Entrega"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
