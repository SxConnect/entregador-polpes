import { prisma } from "../config/prisma.js";

export interface ResolvedStoreSettings {
  valor_padrao_corrida: number;
  tempo_aceite_segundos: number;
  exigir_codigo_confirmacao: boolean;
  exigir_foto: boolean;
  msg_padrao_rastreio: string;
  pwa_logo_url?: string | null;
  [key: string]: any;
}

export const BASE_DEFAULT_SETTINGS: ResolvedStoreSettings = {
  valor_padrao_corrida: 7.0,
  tempo_aceite_segundos: 60,
  exigir_codigo_confirmacao: true,
  exigir_foto: false,
  msg_padrao_rastreio: "Seu pedido está a caminho! Acompanhe o entregador pelo link:",
};

export async function resolveSettings(
  storeId: string,
  branchId?: string | null
): Promise<ResolvedStoreSettings> {
  // 1. Busca configurações da Loja (Conta)
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });

  const storeSettings = (store?.settings as Record<string, any>) || {};

  // 2. Busca configurações da Unidade (Filial), se informada
  let branchSettings: Record<string, any> = {};
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, store_id: storeId },
      select: { settings: true },
    });
    branchSettings = (branch?.settings as Record<string, any>) || {};
  }

  // 3. Herança com precedência: Unidade > Loja > Padrão Base
  const resolved: ResolvedStoreSettings = { ...BASE_DEFAULT_SETTINGS };

  // Aplica Store settings
  for (const [key, val] of Object.entries(storeSettings)) {
    if (val !== undefined && val !== null) {
      (resolved as any)[key] = val;
    }
  }

  // Aplica Branch settings (sobrescreve Store settings)
  for (const [key, val] of Object.entries(branchSettings)) {
    if (val !== undefined && val !== null) {
      (resolved as any)[key] = val;
    }
  }

  return resolved;
}
