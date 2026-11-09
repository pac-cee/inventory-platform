// Real wallet balance — unlike the old bankingAsService integration, this
// endpoint actually exists.
import { getWalletBalance } from "./client.js";
import type { UrubutoDeps } from "./transfer.js";

export async function fetchWalletBalance(
  deps: UrubutoDeps,
): Promise<{ availableBalance: string; currency: string }> {
  if (!deps.apiKey) {
    return { availableBalance: "1000000", currency: "RWF" };
  }
  const result = await getWalletBalance(
    { baseUrl: deps.baseUrl, apiKey: deps.apiKey, authHeader: deps.authHeader },
    deps.walletAccountId,
  );
  return { availableBalance: String(result.data.balance), currency: result.data.currency };
}
