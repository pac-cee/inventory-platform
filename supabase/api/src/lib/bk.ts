// BK-method payment dispatch — thin composition of the small modules under
// ./urubutopay/*. No logic lives here; each method just wires config into
// the matching operation module. Backed by UrubutoPay's Bulk Disbursement
// API (see ./urubutopay/transfer.ts for how the two BK "patterns" map to
// UrubutoPay's destination channels).
import { env } from "../env.js";
import { performTransfer } from "./urubutopay/transfer.js";
import { fetchTransferStatus } from "./urubutopay/status.js";
import { fetchWalletBalance } from "./urubutopay/balance.js";

const deps = {
  baseUrl: env.urubutopayBaseUrl,
  apiKey: env.urubutopayMode === "demo" ? "" : env.urubutopayApiKey,
  walletAccountId: env.urubutopayWalletAccountId,
  authHeader: env.urubutopayAuthHeader,
};

if (!deps.apiKey) {
  console.warn(
    env.urubutopayMode === "demo"
      ? "[UrubutoPay] URUBUTOPAY_MODE=demo — running in deterministic MOCK mode (no real disbursement)"
      : "[UrubutoPay] No URUBUTOPAY_API_KEY found. Running in MOCK mode",
  );
}

interface BkTransferInput {
  phone?: string | null;
  /** Who the phone payment is for; the transfer falls back to a generic label without it. */
  recipientName?: string | null;
  metadata?: { bankAccountNumber?: string; bankAccountName?: string; tinNumber?: string } | null;
}

export const bk = {
  // True when no real UrubutoPay call is made (no key, or demo mode).
  get isMock(): boolean {
    return !deps.apiKey;
  },

  async transfer(input: BkTransferInput, amount: number, txId: string): Promise<string> {
    return performTransfer(
      deps,
      {
        phone: input.phone,
        recipientName: input.recipientName,
        metadata: input.metadata?.bankAccountNumber
          ? { bankAccountNumber: input.metadata.bankAccountNumber, bankAccountName: input.metadata.bankAccountName ?? "" }
          : null,
      },
      amount,
      txId,
    );
  },

  async getTransferStatus(ref: string) {
    return fetchTransferStatus(deps, ref);
  },

  async getAccountBalance() {
    return fetchWalletBalance(deps);
  },
};
