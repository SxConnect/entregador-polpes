import { useState, useEffect } from "react";
import { getInvite, acceptInvite, setToken } from "../services/api.ts";
import { ShieldCheck, Bike, Store, CheckCircle, AlertCircle } from "lucide-react";

interface Props {
  token: string;
  onSuccess: () => void;
}

export function InvitePage({ token, onSuccess }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<any>(null);
  const [lgpdAccepted, setLgpdAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getInvite(token)
      .then((data) => {
        setInviteData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Convite inválido ou expirado.");
        setLoading(false);
      });
  }, [token]);

  async function handleAccept() {
    if (!lgpdAccepted) {
      alert("É necessário marcar o consentimento dos termos e LGPD para prosseguir.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await acceptInvite(token, "1.0-2026");
      if (res.token) {
        setToken(res.token);
        onSuccess();
      }
    } catch (err: any) {
      alert(err.message || "Erro ao aceitar convite.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-xs text-slate-500 font-medium">Validando convite...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm max-w-sm w-full text-center space-y-4">
          <div className="w-14 h-14 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-slate-800">Convite Indisponível</h2>
          <p className="text-xs text-slate-500 leading-relaxed">{error}</p>
          <a
            href="/"
            className="block w-full py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 transition-colors"
          >
            Voltar para o Início
          </a>
        </div>
      </div>
    );
  }

  const { courier, store } = inviteData;

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 max-w-md mx-auto p-4 sm:p-6">
      <div className="space-y-6 pt-4">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-brand-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-md shadow-brand-500/20">
            <Bike className="w-9 h-9" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">App do Entregador</h1>
          <p className="text-xs text-slate-500">Convite para entrega de pedidos</p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400 font-medium block">Loja Convidante</span>
              <strong className="text-sm text-slate-800">{store.nome}</strong>
            </div>
          </div>

          <div className="space-y-1 text-xs">
            <div className="flex justify-between py-1 text-slate-600">
              <span>Entregador:</span>
              <strong className="text-slate-800">{courier.nome}</strong>
            </div>
            <div className="flex justify-between py-1 text-slate-600">
              <span>Telefone:</span>
              <span className="font-mono text-slate-800">{courier.telefone}</span>
            </div>
            <div className="flex justify-between py-1 text-slate-600">
              <span>Veículo:</span>
              <span className="capitalize text-slate-800">{courier.veiculo}</span>
            </div>
          </div>
        </div>

        {/* Termos e LGPD */}
        <div className="bg-brand-50/70 border border-brand-200/80 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-brand-800 font-bold text-xs">
            <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0" />
            <span>Privacidade e Uso de Dados (LGPD)</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Ao ativar sua conta, sua localização GPS será coletada e transmitida para a loja e cliente
            <strong> exclusivamente enquanto você estiver realizando uma corrida ativa</strong>. Seus dados nunca são
            compartilhados para fins comerciais ou publicitários.
          </p>

          <label className="flex items-start gap-2.5 pt-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={lgpdAccepted}
              onChange={(e) => setLgpdAccepted(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300 cursor-pointer"
            />
            <span className="text-[11px] text-slate-700 leading-snug font-medium">
              Li e concordo com os Termos de Uso e autorizo o rastreamento GPS durante as entregas.
            </span>
          </label>
        </div>
      </div>

      <div className="pt-6 pb-2 space-y-2">
        <button
          type="button"
          disabled={!lgpdAccepted || submitting}
          onClick={handleAccept}
          className="w-full py-3.5 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-md shadow-brand-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <span>Ativando conta...</span>
          ) : (
            <>
              <CheckCircle className="w-5 h-5" />
              <span>Aceitar Convite e Começar</span>
            </>
          )}
        </button>
        <p className="text-[10px] text-center text-slate-400">
          Você poderá acessar este app a qualquer momento sem precisar baixar de lojas de aplicativos.
        </p>
      </div>
    </div>
  );
}
