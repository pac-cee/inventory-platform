// Looks up a single beneficiary's transfer status. Unlike the old
// bankingAsService integration, UrubutoPay's initiate response gives us a
// real transaction reference directly — no paginated search needed.
import { checkTransfer, isSuccessBody } from "./client.js";
import { mapUrubutoStatus } from "./statusMap.js";
import type { UrubutoStatus } from "./statusMap.js";
import type { UrubutoDeps } from "./transfer.js";

export async function fetchTransferStatus(
  deps: UrubutoDeps,
  ref: string,
): Promise<{ status: UrubutoStatus; reason?: any }> {
  if (!deps.apiKey || ref.startsWith("MOCK:")) {
    return { status: "SUCCESSFUL" };
  }

  const [internalRef, beneficiaryCode] = ref.split(":");
  if (!internalRef || !beneficiaryCode) {
    throw new Error(`Malformed UrubutoPay transfer reference: ${ref}`);
  }

  const result = await checkTransfer(
    { baseUrl: deps.baseUrl, apiKey: deps.apiKey, authHeader: deps.authHeader },
    internalRef,
    beneficiaryCode,
  );
  if (!isSuccessBody(result) || !result.data) {
    return { status: "PENDING", reason: result.message };
  }
  return { status: mapUrubutoStatus(result.data.transaction_status) };
}
