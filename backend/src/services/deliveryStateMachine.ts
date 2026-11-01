export type DeliveryStatus =
  | "pendente"
  | "atribuido"
  | "aceito"
  | "coletado"
  | "em_rota"
  | "entregue"
  | "recusado"
  | "cancelado";

export const VALID_STATUS_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  pendente: ["atribuido", "cancelado"],
  atribuido: ["aceito", "recusado", "cancelado", "atribuido"],
  aceito: ["coletado", "cancelado"],
  coletado: ["em_rota", "cancelado"],
  em_rota: ["entregue", "cancelado"],
  recusado: ["atribuido", "cancelado"],
  entregue: [],
  cancelado: [],
};

export function canTransition(current: string, next: string): boolean {
  const allowed = VALID_STATUS_TRANSITIONS[current as DeliveryStatus];
  if (!allowed) return false;
  return allowed.includes(next as DeliveryStatus);
}

export function assertValidTransition(current: string, next: string): void {
  if (!canTransition(current, next)) {
    throw new Error(
      `Transição de status inválida: não é permitido alterar de '${current}' para '${next}'.`
    );
  }
}

export function getTimestampFieldForStatus(status: DeliveryStatus): string | null {
  switch (status) {
    case "atribuido":
      return "atribuido_em";
    case "aceito":
      return "aceito_em";
    case "coletado":
      return "coletado_em";
    case "em_rota":
      return "em_rota_em";
    case "entregue":
      return "entregue_em";
    case "cancelado":
      return "cancelado_em";
    default:
      return null;
  }
}
