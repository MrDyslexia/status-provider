export type MiniMaxStatusEndpointId = "international" | "china";

export interface MiniMaxStatusEndpoint {
  id: MiniMaxStatusEndpointId;
  label: string;
  apiBaseUrl: string;
  statusUrl: string;
}

export const MINIMAX_STATUS_ENDPOINTS: Readonly<Record<MiniMaxStatusEndpointId, MiniMaxStatusEndpoint>> = {
  international: {
    id: "international",
    label: "MiniMax International",
    // MiniMax Token Plan is hosted on www.minimax.io (not api.minimax.io) and
    // exposes unified status via /v1/token_plan/remains.
    apiBaseUrl: "https://www.minimax.io",
    statusUrl: "https://www.minimax.io/v1/token_plan/remains",
  },
  china: {
    id: "china",
    label: "MiniMax China",
    apiBaseUrl: "https://api.minimaxi.com",
    // CN Token Plan docs use this path on minimaxi.com; api.minimaxi.com returns MiniMax base_resp auth errors for it.
    statusUrl: "https://api.minimaxi.com/v1/token_plan/remains",
  },
};

export function getMiniMaxStatusEndpoint(id: MiniMaxStatusEndpointId): MiniMaxStatusEndpoint {
  return MINIMAX_STATUS_ENDPOINTS[id];
}
