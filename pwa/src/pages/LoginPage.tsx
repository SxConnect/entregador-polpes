import { useState } from "react";
import { courierLogin, registerCourierPassword, setToken } from "../services/api.ts";
import { Phone, Lock, Eye, EyeOff, ArrowRight, ShieldCheck } from "lucide-react";

interface Props {
  onSuccess: () => void;
}

type AuthMode = "login" | "register";

export function LoginPage({ onSuccess }: Props) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [phone, setPhone] = useState("(21) 99698-4261");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function formatPhoneInput(v: string): string {
    let digits = v.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length > 11) {
      digits = digits.slice(2);
    }
    digits = digits.slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  function getCleanPhone(): string {
    let digits = phone.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length > 11) {
      digits = digits.slice(2);
    }
    return digits;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const cleanDigits = getCleanPhone();

    if (!cleanDigits || cleanDigits.length < 10) {
      setError("Por favor, digite seu número de celular com o DDD (ex: 21 99698-4261).");
      return;
    }

    if (!password.trim()) {
      setError("Por favor, digite sua senha de acesso.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await courierLogin(cleanDigits, password);
      if (res.token) {
        setToken(res.token);
        onSuccess();
      }
    } catch (err: any) {
      const msg = err.message || "Não foi possível entrar.";
      setError(msg);
      if (msg.includes("não definiu uma senha") || msg.includes("não possui uma senha")) {
        setMode("register");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterPassword(e: React.FormEvent) {
    e.preventDefault();
    const cleanDigits = getCleanPhone();

    if (!cleanDigits || cleanDigits.length < 10) {
      setError("Por favor, digite seu número de celular com o DDD (ex: 21 99698-4261).");
      return;
    }

    if (!password.trim() || password.length < 4) {
      setError("A senha deve ter pelo menos 4 caracteres ou dígitos.");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas não coincidem. Digite a mesma senha nos dois campos.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await registerCourierPassword({
        telefone: cleanDigits,
        senha: password.trim(),
        veiculo: "moto",
      });

      if (res.token) {
        setToken(res.token);
        setSuccessMsg("Senha cadastrada com sucesso! Entrando...");
        setTimeout(() => {
          onSuccess();
        }, 400);
      }
    } catch (err: any) {
      setError(err.message || "Erro ao cadastrar senha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-100 sm:p-4">
      <div className="w-full max-w-md min-h-screen sm:min-h-0 bg-white sm:rounded-3xl sm:shadow-xl sm:border sm:border-slate-200/80 p-5 sm:p-8 flex flex-col justify-between">
        <div className="pt-4 sm:pt-2 space-y-5">
          {/* Topo / Logo */}
          <div className="text-center space-y-3">
            <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto rounded-3xl bg-white p-2.5 shadow-md border border-slate-200 flex items-center justify-center overflow-hidden">
              <img
                src="/logo-polpes.png"
                alt="Logo Entregador"
                width="96"
                height="96"
                className="w-full h-full object-contain"
                style={{ width: "100%", height: "100%", maxWidth: "96px", maxHeight: "96px" }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = "/logo-default.png";
                }}
              />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">App do Entregador</h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                {mode === "login"
                  ? "Acesse com seu celular e senha"
                  : "Defina sua senha de acesso"}
              </p>
            </div>
          </div>

          {/* Abas Alternar: Entrar vs Cadastrar Senha */}
          <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl border border-slate-200/60 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
                setSuccessMsg(null);
              }}
              className={`py-2.5 rounded-xl transition-all cursor-pointer ${
                mode === "login"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Entrar com Senha
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setError(null);
                setSuccessMsg(null);
              }}
              className={`py-2.5 rounded-xl transition-all cursor-pointer ${
                mode === "register"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Cadastrar Senha
            </button>
          </div>

          {/* Formulário de Login */}
          {mode === "login" ? (
            <form onSubmit={handleLogin} className="bg-slate-50/80 rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Número de Celular / WhatsApp
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    key="login-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                    placeholder="(DDD) 90000-0000"
                    className="w-full pl-10 pr-3 py-3 border border-slate-300 bg-white rounded-xl text-base font-semibold text-slate-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-500/20"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Senha de Acesso
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    key="login-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Digite sua senha"
                    className="w-full pl-10 pr-10 py-3 border border-slate-300 bg-white rounded-xl text-sm font-semibold text-slate-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium leading-relaxed">
                  {error}
                </div>
              )}

              {successMsg && (
                <div className="p-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-xs font-medium">
                  {successMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-md shadow-brand-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] cursor-pointer"
              >
                {loading ? "Entrando..." : "Acessar Entregas"}
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setError(null);
                    setSuccessMsg(null);
                  }}
                  className="text-xs text-brand-600 font-bold hover:underline cursor-pointer"
                >
                  Primeiro acesso? Cadastre sua senha aqui
                </button>
              </div>
            </form>
          ) : (
            /* Formulário de Cadastrar Senha / Primeiro Acesso */
            <form onSubmit={handleRegisterPassword} className="bg-slate-50/80 rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Número de Celular / WhatsApp
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    key="register-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                    placeholder="(DDD) 90000-0000"
                    className="w-full pl-10 pr-3 py-3 border border-slate-300 bg-white rounded-xl text-base font-semibold text-slate-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-500/20"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Crie uma Senha de Acesso
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    key="register-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 4 caracteres ou números"
                    className="w-full pl-10 pr-10 py-3 border border-slate-300 bg-white rounded-xl text-sm font-semibold text-slate-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Confirme a Nova Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    key="register-confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Digite a mesma senha novamente"
                    className="w-full pl-10 pr-10 py-3 border border-slate-300 bg-white rounded-xl text-sm font-semibold text-slate-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium leading-relaxed">
                  {error}
                </div>
              )}

              {successMsg && (
                <div className="p-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-xs font-medium">
                  {successMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] cursor-pointer"
              >
                {loading ? "Cadastrando..." : "Cadastrar Senha e Entrar"}
                <ShieldCheck className="w-4 h-4" />
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                    setSuccessMsg(null);
                  }}
                  className="text-xs text-brand-600 font-bold hover:underline cursor-pointer"
                >
                  Já possui senha? Faça login aqui
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="text-center pt-6 pb-2 text-xs text-slate-400 space-y-1">
          <p>Módulo de entregas Polpê's Açaí</p>
          <p className="text-slate-500 font-medium">Acesso seguro por celular e senha criptografada.</p>
        </div>
      </div>
    </div>
  );
}
