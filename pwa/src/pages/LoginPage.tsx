import { useState } from "react";
import { courierLogin, setToken } from "../services/api.ts";
import { Phone, ArrowRight } from "lucide-react";

interface Props {
  onSuccess: () => void;
}

export function LoginPage({ onSuccess }: Props) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function formatPhoneInput(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanDigits = phone.replace(/\D/g, "");
    if (cleanDigits.length < 10) {
      setError("Informe um número de telefone com DDD válido.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await courierLogin(cleanDigits);
      if (res.token) {
        setToken(res.token);
        onSuccess();
      }
    } catch (err: any) {
      setError(err.message || "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 max-w-md mx-auto p-4 sm:p-6">
      <div className="pt-8 space-y-6">
        <div className="text-center space-y-2">
          <img
            src="/logo-polpes.png"
            alt="Logo Entregador"
            className="w-20 h-20 rounded-2xl mx-auto shadow-md object-contain bg-white p-1 border border-slate-200"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = "/logo-default.png";
            }}
          />
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">App do Entregador</h1>
          <p className="text-xs text-slate-500">Entre com seu número cadastrado</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Número de Celular / WhatsApp
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3.5 pointer-events-none" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                placeholder="(21) 99999-9999"
                className="w-full pl-9 pr-3 py-3 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600 font-mono tracking-wider"
                autoFocus
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || phone.replace(/\D/g, "").length < 10}
            className="w-full py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-md shadow-brand-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? "Entrando..." : "Acessar Entregas"}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>

      <div className="text-center pb-4 text-xs text-slate-400 space-y-1">
        <p>Ainda não é entregador cadastrado?</p>
        <p className="text-slate-500 font-medium">Solicite seu link de convite diretamente à loja parceira.</p>
      </div>
    </div>
  );
}
