import React, { useState, useEffect } from "react";
import {
  Bike,
  Package,
  Settings,
  Plus,
  Copy,
  MessageCircle,
  Upload,
  Trash2,
  RotateCw,
} from "lucide-react";

interface Props {
  authQuery: string; // token=... ou key=...
}

export function EmbedPanelPage({ authQuery }: Props) {
  const [tab, setTab] = useState<"deliveries" | "couriers" | "settings">("deliveries");
  const [store, setStore] = useState<any>(null);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [couriers, setCouriers] = useState<any[]>([]);
  const [activeCouriers, setActiveCouriers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Modais
  const [showNewCourier, setShowNewCourier] = useState(false);
  const [newCourierForm, setNewCourierForm] = useState({
    nome: "",
    telefone: "",
    veiculo: "moto",
    placa: "",
  });

  const [assignDeliveryId, setAssignDeliveryId] = useState<string | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState("");
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);

  // Configurações
  const [settingsForm, setSettingsForm] = useState<any>({});
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const API_BASE =
    import.meta.env.VITE_API_URL ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

  function getHeaders(): Record<string, string> {
    const params = new URLSearchParams(authQuery);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (params.get("token")) {
      headers["X-Embed-Token"] = params.get("token")!;
    }
    if (params.get("key")) {
      headers["X-Store-API-Key"] = params.get("key")!;
    }
    return headers;
  }

  async function api(path: string, options: RequestInit = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...getHeaders(),
        ...(options.headers as Record<string, string>),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.message || `Erro HTTP ${res.status}`);
    }
    return json;
  }

  useEffect(() => {
    loadAll();
  }, [authQuery]);

  async function loadAll() {
    setLoading(true);
    try {
      const [storeData, delData, courData, activeCourData] = await Promise.all([
        api("/api/v1/store/settings"),
        api("/api/v1/deliveries?limit=50"),
        api("/api/v1/couriers"),
        api("/api/v1/couriers?disponiveis=true"),
      ]);

      setStore(storeData);
      setSettingsForm(storeData.settings || {});
      setDeliveries(delData.deliveries || []);
      setCouriers(courData.couriers || []);
      setActiveCouriers(activeCourData.couriers || []);
    } catch (err: any) {
      console.error("Erro ao carregar dados do painel:", err);
      alert(err.message || "Erro de autenticação no painel.");
    } finally {
      setLoading(false);
    }
  }

  // ── Ações de Entregadores ─────────────────────────────────────────────
  async function handleCreateCourier(e: React.FormEvent) {
    e.preventDefault();
    setActionLoading(true);
    try {
      await api("/api/v1/couriers", {
        method: "POST",
        body: JSON.stringify(newCourierForm),
      });
      setShowNewCourier(false);
      setNewCourierForm({ nome: "", telefone: "", veiculo: "moto", placa: "" });
      await loadAll();
      alert("Entregador cadastrado e convite gerado com sucesso!");
    } catch (err: any) {
      alert(err.message || "Erro ao cadastrar entregador.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleToggleCourier(courierId: string, currentAtivo: boolean) {
    try {
      await api(`/api/v1/couriers/${courierId}/toggle`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !currentAtivo }),
      });
      await loadAll();
    } catch (err: any) {
      alert(err.message || "Erro ao alternar status do entregador.");
    }
  }

  async function handleResendInvite(courierId: string) {
    try {
      const res = await api(`/api/v1/couriers/${courierId}/invites`, { method: "POST" });
      await loadAll();
      copyText(res.invite_url);
      alert("Novo link de convite gerado e copiado para a área de transferência!");
    } catch (err: any) {
      alert(err.message || "Erro ao gerar convite.");
    }
  }

  // ── Ações de Entregas ─────────────────────────────────────────────────
  async function handleAssignDelivery() {
    if ((!assignDeliveryId && selectedDeliveryIds.length === 0) || !selectedCourierId) return;
    setActionLoading(true);
    try {
      if (selectedDeliveryIds.length > 0) {
        await api(`/api/v1/deliveries/batch-assign`, {
          method: "POST",
          body: JSON.stringify({ delivery_ids: selectedDeliveryIds, courier_id: selectedCourierId }),
        });
        setSelectedDeliveryIds([]);
      } else if (assignDeliveryId) {
        await api(`/api/v1/deliveries/${assignDeliveryId}/assign`, {
          method: "POST",
          body: JSON.stringify({ courier_id: selectedCourierId }),
        });
      }
      setAssignDeliveryId(null);
      setSelectedCourierId("");
      await loadAll();
      alert("Entregador atribuído com sucesso!");
    } catch (err: any) {
      alert(err.message || "Erro ao atribuir entregador.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelDelivery(deliveryId: string) {
    if (!confirm("Tem certeza que deseja cancelar esta entrega?")) return;
    try {
      await api(`/api/v1/deliveries/${deliveryId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ motivo: "Cancelado pelo lojista" }),
      });
      await loadAll();
    } catch (err: any) {
      alert(err.message || "Erro ao cancelar entrega.");
    }
  }

  // ── Ações de Configurações & Logo ─────────────────────────────────────
  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setActionLoading(true);
    try {
      await api("/api/v1/store/settings", {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            valor_padrao_corrida: Number(settingsForm.valor_padrao_corrida || 7.0),
            tempo_aceite_segundos: Number(settingsForm.tempo_aceite_segundos || 60),
            exigir_codigo_confirmacao: settingsForm.exigir_codigo_confirmacao !== false,
            exigir_foto: Boolean(settingsForm.exigir_foto),
            msg_padrao_rastreio: settingsForm.msg_padrao_rastreio || "",
          },
        }),
      });
      await loadAll();
      alert("Configurações salvas com sucesso!");
    } catch (err: any) {
      alert(err.message || "Erro ao salvar configurações.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const params = new URLSearchParams(authQuery);
      const headers: Record<string, string> = {};
      if (params.get("token")) headers["X-Embed-Token"] = params.get("token")!;
      if (params.get("key")) headers["X-Store-API-Key"] = params.get("key")!;

      const res = await fetch(`${API_BASE}/api/v1/store/logo`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || "Falha no upload");
      }

      await loadAll();
      alert("Logo do PWA atualizado com sucesso!");
    } catch (err: any) {
      alert(err.message || "Erro ao enviar imagem.");
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  }

  async function handleRemoveLogo() {
    if (!confirm("Deseja restaurar a logo padrão da loja?")) return;
    try {
      await api("/api/v1/store/logo", { method: "DELETE" });
      await loadAll();
      alert("Logo personalizada removida!");
    } catch (err: any) {
      alert(err.message || "Erro ao remover logo.");
    }
  }

  function copyText(txt: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center space-y-2">
          <RotateCw className="w-8 h-8 text-brand-600 animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-semibold">Carregando painel de entregas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-12 font-sans">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-3">
          <img
            src={store?.logo_url || "/logo-polpes.png"}
            alt="Logo"
            className="w-10 h-10 rounded-xl object-contain bg-white border border-slate-200 p-0.5"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = "/logo-default.png";
            }}
          />
          <div>
            <h1 className="text-base font-extrabold text-slate-900">{store?.nome}</h1>
            <span className="text-[11px] text-slate-400 font-medium">Módulo Entregas Próprias</span>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="bg-slate-100 p-1 rounded-xl flex gap-1 border border-slate-200/80">
          <button
            onClick={() => setTab("deliveries")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              tab === "deliveries" ? "bg-white text-brand-700 shadow-xs" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Entregas ({deliveries.length})</span>
          </button>

          <button
            onClick={() => setTab("couriers")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              tab === "couriers" ? "bg-white text-brand-700 shadow-xs" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <Bike className="w-4 h-4" />
            <span>Entregadores ({couriers.length})</span>
          </button>

          <button
            onClick={() => setTab("settings")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              tab === "settings" ? "bg-white text-brand-700 shadow-xs" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Configurações & Logo</span>
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        {/* ── ABA 1: ENTREGAS EM ANDAMENTO ───────────────────────────── */}
        {tab === "deliveries" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Entregas de Pedidos</h2>
                <p className="text-xs text-slate-500">Acompanhe as corridas e atribua entregadores aos pedidos.</p>
              </div>
            </div>

            {deliveries.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center space-y-2">
                <Package className="w-12 h-12 text-slate-300 mx-auto" />
                <h3 className="font-bold text-slate-700 text-sm">Nenhuma entrega registrada</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Quando um pedido entrar como pronto para entrega no sistema da loja, ele aparecerá aqui
                  automaticamente.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Banner de Atribuição em Lote */}
                {selectedDeliveryIds.length > 0 && (
                  <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 flex items-center justify-between shadow-xs">
                    <div className="text-xs">
                      <strong className="text-brand-900 block font-bold">
                        {selectedDeliveryIds.length} {selectedDeliveryIds.length === 1 ? "pedido selecionado" : "pedidos selecionados"}
                      </strong>
                      <span className="text-brand-700 text-[11px]">
                        Atribua todos para um único entregador fazer a rota de paradas.
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedDeliveryIds([])}
                        className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
                      >
                        Limpar
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssignDeliveryId("batch")}
                        className="px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Bike className="w-4 h-4" />
                        <span>Atribuir Lote ({selectedDeliveryIds.length})</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3">
                  {deliveries.map((d) => {
                    const isSelectable = d.status !== "entregue" && d.status !== "cancelado";
                    const isSelected = selectedDeliveryIds.includes(d.id);

                    return (
                      <div key={d.id} className={`bg-white rounded-2xl p-5 border shadow-xs space-y-3 transition-all ${
                        isSelected ? "border-brand-500 bg-brand-50/20" : "border-slate-200"
                      }`}>
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                          <div className="flex items-center gap-2.5">
                            {isSelectable && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedDeliveryIds((prev) => [...prev, d.id]);
                                  } else {
                                    setSelectedDeliveryIds((prev) => prev.filter((id) => id !== d.id));
                                  }
                                }}
                                className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 cursor-pointer"
                              />
                            )}
                            <span className="font-mono font-bold text-sm text-slate-900">Pedido #{d.core_order_id}</span>
                            <span
                              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                                d.status === "entregue"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : d.status === "em_rota"
                                  ? "bg-blue-100 text-blue-800"
                                  : d.status === "cancelado"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {d.status}
                            </span>
                          </div>

                          <strong className="text-sm font-mono text-emerald-700 font-bold">
                            R$ {Number(d.valor_corrida || 0).toFixed(2).replace(".", ",")}
                          </strong>
                        </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold block uppercase">Cliente</span>
                        <strong className="text-slate-800">{d.cliente_nome}</strong>
                        <span className="text-slate-500 block">{d.cliente_telefone}</span>
                        <p className="text-slate-600 mt-1">
                          {d.endereco_entrega?.logradouro}, {d.endereco_entrega?.numero} - {d.endereco_entrega?.bairro}
                        </p>
                      </div>

                      <div className="md:border-l md:border-slate-100 md:pl-4">
                        <span className="text-[10px] text-slate-400 font-semibold block uppercase">Entregador</span>
                        {d.courier ? (
                          <div className="flex items-center gap-2 mt-0.5">
                            <Bike className="w-4 h-4 text-brand-600" />
                            <strong className="text-slate-800">{d.courier.nome}</strong>
                            <span className="text-slate-400 capitalize">({d.courier.veiculo})</span>
                          </div>
                        ) : (
                          <span className="text-amber-600 font-medium mt-0.5 block">Nenhum entregador atribuído</span>
                        )}

                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">Código de 4 dígitos:</span>
                          <span className="font-mono font-bold text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-800">
                            {d.codigo_confirmacao}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Ações da Corrida */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            copyText(d.tracking_url);
                            alert("Link de rastreio copiado!");
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium flex items-center gap-1"
                        >
                          <Copy className="w-3.5 h-3.5" /> Copiar Rastreio
                        </button>
                        <a
                          href={`https://wa.me/${d.cliente_telefone.replace(/\D/g, "")}?text=${encodeURIComponent(
                            `Olá ${d.cliente_nome}! Seu pedido está sendo preparado. Acompanhe a entrega pelo link: ${d.tracking_url}`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-medium flex items-center gap-1"
                        >
                          <MessageCircle className="w-3.5 h-3.5" /> Enviar WhatsApp
                        </a>
                      </div>

                      <div className="flex items-center gap-2">
                        {d.status !== "entregue" && d.status !== "cancelado" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setAssignDeliveryId(d.id);
                                setSelectedCourierId(d.courier_id || "");
                              }}
                              className="px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs flex items-center gap-1 shadow-xs"
                            >
                              <Bike className="w-3.5 h-3.5" />
                              <span>{d.courier ? "Reatribuir" : "Atribuir Entregador"}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCancelDelivery(d.id)}
                              className="px-2.5 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs"
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
            )}
          </div>
        )}

        {/* ── ABA 2: ENTREGADORES COM TOGGLE DE VÍNCULO ───────────────── */}
        {tab === "couriers" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Entregadores Cadastrados</h2>
                <p className="text-xs text-slate-500">
                  Gerencie sua frota própria. Entregadores inativos pelo toggle não aparecem para receber pedidos.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowNewCourier(true)}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Cadastrar Entregador</span>
              </button>
            </div>

            {couriers.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center space-y-3">
                <Bike className="w-12 h-12 text-slate-300 mx-auto" />
                <h3 className="font-bold text-slate-700 text-sm">Nenhum entregador cadastrado</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Clique no botão acima para cadastrar seu primeiro entregador próprio e gerar o link de convite.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {couriers.map((c) => (
                  <div key={c.id} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg ${c.ativo ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-400'}`}>
                        <Bike className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <strong className="text-sm font-bold text-slate-900">{c.nome}</strong>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            c.status === "online" ? "bg-emerald-100 text-emerald-800" : c.status === "em_corrida" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-500"
                          }`}>
                            {c.status}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400 font-mono block">{c.telefone}</span>
                        <span className="text-[11px] text-slate-500 capitalize">
                          {c.veiculo} {c.placa ? `• Placa ${c.placa}` : ""}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Toggle de Vínculo Ativo/Inativo */}
                      <div className="flex items-center gap-2 border-r border-slate-200 pr-4">
                        <div className="text-right">
                          <span className="text-xs font-bold text-slate-800 block">
                            {c.ativo ? "Vínculo Ativo" : "Inativo"}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {c.ativo ? "Pode receber pedidos" : "Não recebe pedidos"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleCourier(c.id, c.ativo)}
                          className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-200 ${
                            c.ativo ? "bg-brand-600" : "bg-slate-300"
                          }`}
                        >
                          <div
                            className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ${
                              c.ativo ? "translate-x-5" : "translate-x-0"
                            }`}
                          ></div>
                        </button>
                      </div>

                      {/* Ações de Convite */}
                      <div className="flex items-center gap-2">
                        {c.invite ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                copyText(c.invite.invite_url);
                                alert("Link de convite copiado!");
                              }}
                              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1"
                              title="Copiar Link de Convite"
                            >
                              <Copy className="w-3.5 h-3.5" /> Convite
                            </button>
                            <a
                              href={`https://wa.me/${c.telefone.replace(/\D/g, "")}?text=${encodeURIComponent(
                                `Olá ${c.nome}! Você foi cadastrado como entregador na ${store?.nome}. Abra seu aplicativo por este link para começar: ${c.invite.invite_url}`
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 rounded-xl bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                              title="Enviar convite no WhatsApp"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </a>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleResendInvite(c.id)}
                            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                          >
                            Novo Convite
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ABA 3: CONFIGURAÇÕES & LOGO ────────────────────────────── */}
        {tab === "settings" && (
          <div className="space-y-6">
            {/* Seção 1: Logo do PWA */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">Logo do App do Entregador</h3>
                <p className="text-xs text-slate-500">
                  Esta logo aparece na tela de login, convite e topo do PWA do entregador.
                </p>
              </div>

              <div className="flex items-center gap-6">
                <div className="w-24 h-24 rounded-2xl bg-slate-50 border border-slate-200 p-2 flex items-center justify-center relative shadow-xs">
                  <img
                    src={store?.logo_url || "/logo-polpes.png"}
                    alt="Logo PWA"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = "/logo-default.png";
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs cursor-pointer shadow-xs transition-colors">
                    <Upload className="w-4 h-4" />
                    <span>{uploadingLogo ? "Enviando imagem..." : "Enviar Logo Personalizada"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleLogoUpload}
                      disabled={uploadingLogo}
                      className="hidden"
                    />
                  </label>

                  <div>
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      className="text-xs font-semibold text-slate-400 hover:text-red-600 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Restaurar logo padrão
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-400 block">
                    Formatos aceitos: PNG, JPG ou WebP (máx. 5MB).
                  </span>
                </div>
              </div>
            </div>

            {/* Seção 2: Configurações Operacionais */}
            <form onSubmit={handleSaveSettings} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">Parâmetros Operacionais de Entrega</h3>
                <p className="text-xs text-slate-500">Defina regras de valores, segurança e tolerância de tempo.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Valor Padrão da Corrida (R$)
                  </label>
                  <input
                    type="number"
                    step="0.50"
                    min="0"
                    value={settingsForm.valor_padrao_corrida ?? 7.0}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, valor_padrao_corrida: parseFloat(e.target.value) })
                    }
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-bold font-mono outline-none focus:border-brand-600"
                  />
                  <span className="text-[11px] text-slate-400">Valor repassado ao entregador por corrida.</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tempo para Aceite (segundos)
                  </label>
                  <input
                    type="number"
                    min="15"
                    max="600"
                    value={settingsForm.tempo_aceite_segundos ?? 60}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, tempo_aceite_segundos: parseInt(e.target.value, 10) })
                    }
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono outline-none focus:border-brand-600"
                  />
                  <span className="text-[11px] text-slate-400">Tempo limite para o entregador responder.</span>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                  <div>
                    <strong className="text-xs text-slate-800 block">Exigir código de 4 dígitos na entrega</strong>
                    <span className="text-[11px] text-slate-400">
                      O cliente dita o código gerado no pedido para o entregador concluir a corrida no app.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settingsForm.exigir_codigo_confirmacao !== false}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, exigir_codigo_confirmacao: e.target.checked })
                    }
                    className="w-5 h-5 rounded text-brand-600 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100">
                  <div>
                    <strong className="text-xs text-slate-800 block">Exigir foto de comprovante na entrega</strong>
                    <span className="text-[11px] text-slate-400">
                      O entregador precisa anexar uma foto do pacote entregue para finalizar.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settingsForm.exigir_foto)}
                    onChange={(e) => setSettingsForm({ ...settingsForm, exigir_foto: e.target.checked })}
                    className="w-5 h-5 rounded text-brand-600 cursor-pointer"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mensagem padrão de rastreio para o cliente
                </label>
                <textarea
                  rows={2}
                  value={settingsForm.msg_padrao_rastreio || ""}
                  onChange={(e) => setSettingsForm({ ...settingsForm, msg_padrao_rastreio: e.target.value })}
                  placeholder="Seu pedido está a caminho! Acompanhe o entregador pelo link:"
                  className="w-full p-3 rounded-xl border border-slate-200 text-xs outline-none focus:border-brand-600"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-md shadow-brand-600/20 transition-all disabled:opacity-50"
                >
                  {actionLoading ? "Salvando..." : "Salvar Configurações"}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      {/* Modal: Atribuir Entregador (SÓ MOSTRA ENTREGADORES COM TOGGLE ATIVO!) */}
      {assignDeliveryId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="text-center space-y-1">
              <Bike className="w-10 h-10 text-brand-600 mx-auto" />
              <h3 className="font-bold text-base text-slate-900">
                {selectedDeliveryIds.length > 0 ? `Atribuir Lote (${selectedDeliveryIds.length} Pedidos)` : "Atribuir Entregador"}
              </h3>
              <p className="text-xs text-slate-400">
                {selectedDeliveryIds.length > 0
                  ? "Selecione o entregador que fará a rota com todas estas paradas."
                  : "Selecione um entregador próprio ativo para realizar esta corrida."}
              </p>
            </div>

            {activeCouriers.length === 0 ? (
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-800 text-xs text-center space-y-1">
                <strong>Nenhum entregador com vínculo ativo!</strong>
                <p className="text-[11px]">Vá na aba Entregadores e ative o toggle de quem for trabalhar hoje.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {activeCouriers.map((c) => (
                  <label
                    key={c.id}
                    className={`flex items-center justify-between p-3 rounded-2xl border cursor-pointer transition-all ${
                      selectedCourierId === c.id
                        ? "border-brand-600 bg-brand-50/50 shadow-xs"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name="courier_choice"
                        value={c.id}
                        checked={selectedCourierId === c.id}
                        onChange={() => setSelectedCourierId(c.id)}
                        className="text-brand-600 cursor-pointer"
                      />
                      <div>
                        <strong className="text-xs text-slate-800 block">{c.nome}</strong>
                        <span className="text-[11px] text-slate-400 capitalize">{c.veiculo}</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      {c.status}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAssignDeliveryId(null)}
                className="py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={actionLoading || !selectedCourierId}
                onClick={handleAssignDelivery}
                className="py-2.5 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 shadow-xs disabled:opacity-50"
              >
                {actionLoading ? "Vinculando..." : "Vincular"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Novo Entregador */}
      {showNewCourier && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form onSubmit={handleCreateCourier} className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="text-center space-y-1">
              <h3 className="font-bold text-base text-slate-900">Novo Entregador Próprio</h3>
              <p className="text-xs text-slate-400">Cadastre o entregador para gerar o link de convite.</p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={newCourierForm.nome}
                  onChange={(e) => setNewCourierForm({ ...newCourierForm, nome: e.target.value })}
                  placeholder="Ex: Carlos Eduardo"
                  className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-brand-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Telefone WhatsApp com DDD</label>
                <input
                  type="tel"
                  required
                  value={newCourierForm.telefone}
                  onChange={(e) => setNewCourierForm({ ...newCourierForm, telefone: e.target.value })}
                  placeholder="Ex: 21999998888"
                  className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-brand-600 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Veículo</label>
                  <select
                    value={newCourierForm.veiculo}
                    onChange={(e) => setNewCourierForm({ ...newCourierForm, veiculo: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-brand-600 bg-white"
                  >
                    <option value="moto">Moto</option>
                    <option value="bicicleta">Bicicleta</option>
                    <option value="carro">Carro</option>
                    <option value="a_pe">A pé</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Placa (opcional)</label>
                  <input
                    type="text"
                    value={newCourierForm.placa}
                    onChange={(e) => setNewCourierForm({ ...newCourierForm, placa: e.target.value.toUpperCase() })}
                    placeholder="RIO2A18"
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-brand-600 font-mono uppercase"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewCourier(false)}
                className="py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="py-2.5 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 shadow-xs"
              >
                {actionLoading ? "Cadastrando..." : "Cadastrar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
