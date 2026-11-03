import { Home, History, User } from "lucide-react";

export type NavTab = "home" | "history" | "profile";

interface Props {
  currentTab: NavTab;
  onChangeTab: (tab: NavTab) => void;
  hasActiveDelivery?: boolean;
}

export function BottomNav({ currentTab, onChangeTab, hasActiveDelivery }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] flex items-center justify-around z-40 shadow-lg">
      <button
        onClick={() => onChangeTab("home")}
        className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-colors relative active:scale-95 ${
          currentTab === "home" ? "text-brand-600 font-bold" : "text-slate-500 hover:text-slate-800"
        }`}
      >
        <Home className="w-5 h-5" />
        <span className="text-[11px]">Início</span>
        {hasActiveDelivery && (
          <span className="absolute top-1 right-3 w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
        )}
      </button>

      <button
        onClick={() => onChangeTab("history")}
        className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-colors active:scale-95 ${
          currentTab === "history" ? "text-brand-600 font-bold" : "text-slate-500 hover:text-slate-800"
        }`}
      >
        <History className="w-5 h-5" />
        <span className="text-[11px]">Histórico</span>
      </button>

      <button
        onClick={() => onChangeTab("profile")}
        className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-colors active:scale-95 ${
          currentTab === "profile" ? "text-brand-600 font-bold" : "text-slate-500 hover:text-slate-800"
        }`}
      >
        <User className="w-5 h-5" />
        <span className="text-[11px]">Perfil</span>
      </button>
    </nav>
  );
}
