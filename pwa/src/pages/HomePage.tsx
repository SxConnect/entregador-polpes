import React, { useState, useEffect, useRef } from "react";
import {
  getActiveDelivery,
  acceptDelivery,
  rejectDelivery,
  pickupDelivery,
  startRouteDelivery,
  completeDelivery,
  updateCourierStatus,
  batchAcceptDeliveries,
  batchPickupDeliveries,
  batchStartRouteDeliveries,
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
  MapPin,
  Flag,
  Route,
  Layers,
} from "lucide-react";

interface Props {
  courier: any;
  onRefreshProfile: () => void;
}

export function HomePage({ courier, onRefreshProfile }: Props) {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [batchInfo, setBatchInfo] = useState<any>(null);
  const [selectedStopIndex, setSelectedStopIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeDigits, setCodeDigits] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  const prevStatusRef = useRef<string | null>(null);

  // Entrega atualmente em foco na tela
  const activeDelivery = deliveries[selectedStopIndex] || deliveries[0] || null;

  // Status de trabalho do entregador
  const isOnline = courier?.status === "online" || courier?.status === "em_corrida";
  const isInCorrida = deliveries.some((d) => ["coletado", "em_rota"].includes(d.status));

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
      const list = res.deliveries || (res.delivery ? [res.delivery] : []);
      setDeliveries(list);
      setBatchInfo(res);

      if (selectedStopIndex >= list.length) {
        setSelectedStopIndex(0);
      }

      // Toca vibração se receber uma nova corrida atribuída
      const firstStatus = list[0]?.status;
      if (firstStatus === "atribuido" && prevStatusRef.current !== "atribuido") {
        if ("vibrate" in navigator) {
          navigator.vibrate([200, 100, 200, 100, 400]);
        }
      }
      prevStatusRef.current = firstStatus || null;
    } catch (err) {
      console.warn("Falha ao buscar corridas ativas:", err);
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

  async function handleAccept(deliveryId?: string) {
    setActionLoading(true);
    try {
      if (deliveries.length > 1 && !deliveryId) {
        await batchAcceptDeliveries();
      } else {
        await acceptDelivery(deliveryId || activeDelivery.id);
      }
      await fetchActive();
      onRefreshProfile();
    } catch (err: any) {
      alert(err.message || "Erro ao aceitar corrida.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject(deliveryId?: string) {
    if (!confirm("Tem certeza que deseja recusar? O pedido será disponibilizado para outro entregador.")) {
      return;
    }
    setActionLoading(true);
    try {
      await rejectDelivery(deliveryId || activeDelivery.id);
      await fetchActive();
      onRefreshProfile();
    } catch (err: any) {
      alert(err.message || "Erro ao recusar corrida.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePickup(deliveryId?: string) {
    setActionLoading(true);
    try {
      if (deliveries.length > 1 && !deliveryId) {
        await batchPickupDeliveries();
      } else {
        await pickupDelivery(deliveryId || activeDelivery.id);
      }
      await fetchActive();
    } catch (err: any) {
      alert(err.message || "Erro ao confirmar coleta.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStartRoute(deliveryId?: string) {
    setActionLoading(true);
    try {
      if (deliveries.length > 1 && !deliveryId) {
        await batchStartRouteDeliveries();
      } else {
        await startRouteDelivery(deliveryId || activeDelivery.id);
      }
      await fetchActive();
    } catch (err: any) {
      alert(err.message || "Erro ao iniciar rota.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCompleteDelivery(e: React.FormEvent) {
    e.preventDefault();
    if (!activeDelivery) return;

    if (activeDelivery.exigir_codigo_confirmacao && codeDigits.trim().length !== 4) {
      setCodeError("Digite o código de 4 dígitos informado pelo cliente.");
      return;
    }

    setActionLoading(true);
    setCodeError(null);

    try {
      await completeDelivery(activeDelivery.id, codeDigits.trim());
      setShowCodeModal(false);
      setCodeDigits("");
      await fetchActive();
      onRefreshProfile();
      alert("Entrega finalizada com sucesso! Parabéns!");
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

  function openFullRoute() {
    if (batchInfo?.rota_google_maps_url) {
      window.open(batchInfo.rota_google_maps_url, "_blank");
    } else if (activeDelivery) {
      openNavigation(activeDelivery.endereco_entrega, "google");
    }
  }

  function openWhatsApp(phone: string, text: string) {
    const clean = phone.replace(/\D/g, "");
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(text)}`, "_blank");
  }

  // Verifica se todas do lote estão atribuídas ou coletadas
  const allAtribuidas = deliveries.length > 1 && deliveries.every((d) => d.status === "atribuido");
  const allAceitas = deliveries.length > 1 && deliveries.every((d) => ["aceito", "atribuido"].includes(d.status));
  const hasColetadas = deliveries.length > 1 && deliveries.some((d) => ["coletado", "em_rota"].includes(d.status));

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
        ) : deliveries.length === 0 ? (
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
                  ? "Assim que a loja atribuir entregas a você, uma notificação aparecerá aqui instantaneamente com a rota otimizada."
                  : "Toque no botão superior para ficar Online e começar a receber pedidos."}
              </p>
            </div>
          </div>
        ) : (
          /* Entregas Ativas (Única ou Lote Multi-Paradas) */
          <div className="space-y-4">
            {/* Banner de Lote Multi-Paradas (Se houver 2 ou mais entregas) */}
            {deliveries.length > 1 && (
              <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="bg-brand-500 text-white p-1.5 rounded-xl">
                      <Layers className="w-4 h-4" />
                    </span>
                    <div>
                      <h2 className="font-extrabold text-sm text-white">Lote de {deliveries.length} Entregas</h2>
                      <span className="text-[11px] text-slate-400">Rota otimizada por proximidade</span>
                    </div>
                  </div>
                  <strong className="text-lg font-mono font-bold text-emerald-400">
                    R$ {Number(batchInfo?.valor_total_lote || 0).toFixed(2).replace(".", ",")}
                  </strong>
                </div>

                {/* Botão de Navegar Rota Completa com todas as paradas no Google Maps */}
                <button
                  type="button"
                  onClick={openFullRoute}
                  className="w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-md shadow-brand-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                >
                  <Route className="w-4 h-4 text-emerald-300" />
                  <span>Navegar Rota Completa no Google Maps</span>
                  <ExternalLink className="w-3.5 h-3.5 text-white/70" />
                </button>

                {/* Seletor de Paradas do Lote */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                    Paradas da Rota (Toque para ver detalhes):
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {deliveries.map((d, idx) => {
                      const isSelected = selectedStopIndex === idx;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setSelectedStopIndex(idx)}
                          className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                            isSelected
                              ? "bg-white text-slate-900 border-white shadow-xs"
                              : "bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-extrabold uppercase">
                              {idx + 1}ª Parada
                            </span>
                            {d.is_mais_distante && (
                              <Flag className={`w-3 h-3 ${isSelected ? "text-amber-600" : "text-amber-400"}`} />
                            )}
                          </div>
                          <span className="text-[11px] font-bold truncate block">
                            {d.cliente_nome.split(" ")[0]}
                          </span>
                          <span className="text-[9px] text-slate-400 truncate block">
                            {d.distancia_loja_km ? `${d.distancia_loja_km} km` : d.endereco_entrega?.bairro}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Ações em Lote (Aceitar todas ou Coletar todas) */}
                {allAtribuidas && (
                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleAccept()}
                      className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>Aceitar Todas as {deliveries.length} Entregas</span>
                    </button>
                  </div>
                )}

                {allAceitas && !hasColetadas && (
                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handlePickup()}
                      className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>Confirmar Coleta de Todos os Pedidos</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Card de Detalhe da Corrida Selecionada */}
            {activeDelivery && (
              <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
                {/* Cabeçalho da Corrida */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="bg-brand-50 text-brand-700 font-bold text-xs px-2.5 py-1 rounded-xl">
                      Parada {selectedStopIndex + 1} de {deliveries.length}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-400">
                      #{activeDelivery.core_order_id}
                    </span>
                  </div>

                  <strong className="text-base font-mono font-bold text-emerald-700">
                    R$ {Number(activeDelivery.valor_corrida || 0).toFixed(2).replace(".", ",")}
                  </strong>
                </div>

                {/* Destaque se for a Entrega Mais Distante */}
                {activeDelivery.is_mais_distante && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-2.5 text-amber-800 text-xs">
                    <Flag className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <strong className="block font-bold">Ponto Mais Distante da Rota</strong>
                      <span className="text-[11px] text-amber-700">
                        {activeDelivery.distancia_loja_km ? `${activeDelivery.distancia_loja_km} km da loja` : "Destino final do lote"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Stepper Visual */}
                <div className="flex items-center justify-between text-[11px] font-bold pb-1 text-slate-400">
                  <span className={activeDelivery.status === "aceito" ? "text-emerald-700 font-extrabold" : ""}>1. A caminho</span>
                  <span>›</span>
                  <span className={activeDelivery.status === "coletado" ? "text-emerald-700 font-extrabold" : ""}>2. Coletado</span>
                  <span>›</span>
                  <span className={activeDelivery.status === "em_rota" ? "text-emerald-700 font-extrabold" : ""}>3. Em rota</span>
                  <span>›</span>
                  <span className={activeDelivery.status === "entregue" ? "text-emerald-700 font-extrabold" : ""}>4. Entregue</span>
                </div>

                {/* Endereço de Coleta (Loja) */}
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1.5">
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Retirada na Loja</span>
                    <button
                      type="button"
                      onClick={() => openNavigation(activeDelivery.endereco_retirada, "google")}
                      className="text-brand-600 font-bold hover:underline flex items-center gap-1"
                    >
                      <Navigation className="w-3 h-3" /> Ver no Mapa
                    </button>
                  </div>
                  <div className="font-bold text-xs text-slate-800">
                    {activeDelivery.endereco_retirada.logradouro}, {activeDelivery.endereco_retirada.numero}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {activeDelivery.endereco_retirada.bairro} - {activeDelivery.endereco_retirada.cidade}
                  </div>
                </div>

                {/* Endereço de Destino (Cliente) */}
                <div className="bg-emerald-50/70 p-3.5 rounded-2xl border border-emerald-200 space-y-2">
                  <div className="flex justify-between items-center text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-emerald-600" />
                      Destino do Cliente
                    </span>
                    {activeDelivery.distancia_loja_km && (
                      <span className="bg-emerald-200/80 px-2 py-0.5 rounded-full text-emerald-900 font-mono">
                        {activeDelivery.distancia_loja_km} km
                      </span>
                    )}
                  </div>

                  <div className="font-bold text-sm text-slate-900">
                    {activeDelivery.endereco_entrega.logradouro}, {activeDelivery.endereco_entrega.numero}
                  </div>
                  <div className="text-xs text-slate-600">
                    {activeDelivery.endereco_entrega.bairro}
                    {activeDelivery.endereco_entrega.complemento ? ` • ${activeDelivery.endereco_entrega.complemento}` : ""}
                  </div>

                  {activeDelivery.endereco_entrega.referencia && (
                    <div className="text-[11px] text-amber-800 bg-amber-100/60 p-2 rounded-xl">
                      Obs: {activeDelivery.endereco_entrega.referencia}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openNavigation(activeDelivery.endereco_entrega, "google")}
                      className="flex-1 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold flex items-center justify-center gap-1 hover:bg-slate-100"
                    >
                      <Navigation className="w-3.5 h-3.5 text-blue-600" /> Google Maps
                    </button>
                    <button
                      type="button"
                      onClick={() => openNavigation(activeDelivery.endereco_entrega, "waze")}
                      className="flex-1 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold flex items-center justify-center gap-1 hover:bg-slate-100"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-cyan-600" /> Waze
                    </button>
                  </div>
                </div>

                {/* Contato do Cliente */}
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 font-medium block">Cliente</span>
                    <strong className="text-xs text-slate-800">{activeDelivery.cliente_nome}</strong>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openWhatsApp(activeDelivery.cliente_telefone, `Olá ${activeDelivery.cliente_nome}, sou o entregador do seu pedido na Polpês!`)}
                      className="p-2 rounded-xl bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                      title="WhatsApp"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </button>
                    <a
                      href={`tel:${activeDelivery.cliente_telefone.replace(/\D/g, "")}`}
                      className="p-2 rounded-xl bg-blue-100 text-blue-700 hover:bg-blue-200"
                      title="Ligar"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                  </div>
                </div>

                {/* Botões de Ação para Esta Entrega */}
                <div className="pt-2">
                  {activeDelivery.status === "atribuido" && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => handleReject(activeDelivery.id)}
                        className="py-3 rounded-2xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200"
                      >
                        Recusar
                      </button>
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => handleAccept(activeDelivery.id)}
                        className="py-3 rounded-2xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-md"
                      >
                        Aceitar Esta
                      </button>
                    </div>
                  )}

                  {activeDelivery.status === "aceito" && (
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handlePickup(activeDelivery.id)}
                      className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md"
                    >
                      Confirmar Coleta na Loja
                    </button>
                  )}

                  {activeDelivery.status === "coletado" && (
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStartRoute(activeDelivery.id)}
                      className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md"
                    >
                      Iniciar Rota para Esta Parada
                    </button>
                  )}

                  {activeDelivery.status === "em_rota" && (
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => setShowCodeModal(true)}
                      className="w-full py-4 rounded-2xl bg-brand-700 hover:bg-brand-800 text-white font-extrabold text-sm shadow-md transition-all flex items-center justify-center gap-2"
                    >
                      <CheckCircle className="w-5 h-5" />
                      <span>Cheguei / Finalizar Entrega #{activeDelivery.core_order_id}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal de Código de 4 Dígitos */}
      {showCodeModal && activeDelivery && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 bg-brand-50 text-brand-600 rounded-full flex items-center justify-center mx-auto mb-2">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-base text-slate-800">Finalizar Entrega #{activeDelivery.core_order_id}</h3>
              <p className="text-xs text-slate-500">
                Cliente: <strong>{activeDelivery.cliente_nome}</strong>. Peça o código de <strong>4 dígitos</strong> para liberar a entrega.
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
