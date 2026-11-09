// Initiates a bulk-disbursement transfer for exactly one beneficiary. Both
// BK "patterns" go through the same source (the company's UrubutoPay
// Merchant Wallet) — they differ only in destination channel:
//   - phone present  -> Pattern 2 (employee reimbursement): destination MOMO
//   - metadata present -> Pattern 1 (vendor payment): destination EKASH
//     (EKASH reaches BK and other Rwandan banks; the beneficiary's bank
//     account number goes in the same field a phone number would use)
import { initiateBulkDisbursement } from "./client.js";

export interface UrubutoDeps {
  baseUrl: string;
  apiKey: string; // empty string => mock mode
  authHeader?: string; // "authorization" (default) | "x-api-key"
  walletAccountId: string;
}

interface TransferInput {
  phone?: string | null;
  recipientName?: string | null;
  metadata?: { bankAccountNumber: string; bankAccountName: string } | null;
}

export async function performTransfer(
  deps: UrubutoDeps,
  input: TransferInput,
  amount: number,
  txId: string,
): Promise<string> {
  // Deterministic, derived from our transaction id: UrubutoPay rejects a
  // duplicate external_transaction_ref_number, so a retry of the same payment
  // can never send the money twice.
  const beneficiaryCode = txId;
  const externalRef = `verlet-${txId}`;

  let destination: "MOMO" | "EKASH";
  let beneficiaryName: string;
  let beneficiaryTarget: string;

  if (input.phone) {
    destination = "MOMO";
    // UrubutoPay's Beneficiary schema requires beneficiary_names. Use the name
    // typed on the request; payments made before that field existed (or by an
    // older app build) have none and keep the generic label.
    beneficiaryName = input.recipientName?.trim() || "Employee Reimbursement";
    beneficiaryTarget = input.phone;
  } else if (input.metadata) {
    destination = "EKASH";
    beneficiaryName = input.metadata.bankAccountName;
    beneficiaryTarget = input.metadata.bankAccountNumber;
  } else {
    throw new Error("UrubutoPay transfer requires either a phone number or bank account details");
  }

  if (!deps.apiKey) {
    console.log(
      `[UrubutoPay Mock] Simulating ${destination} transfer of RWF ${amount} to ${beneficiaryTarget} (beneficiary_code: ${beneficiaryCode})`,
    );
    return `MOCK:${beneficiaryCode}`;
  }

  const result = await initiateBulkDisbursement({ baseUrl: deps.baseUrl, apiKey: deps.apiKey, authHeader: deps.authHeader }, {
    source_of_funds: deps.walletAccountId,
    source_payment_channel: "MERCHANT_WALLET",
    destination_payment_channel: destination,
    external_transaction_ref_number: externalRef,
    beneficiary_to_be_charged: "NO",
    wallet_account_id: deps.walletAccountId,
    beneficiaries: [
      {
        beneficiary_names: beneficiaryName,
        beneficiary_phone_number: beneficiaryTarget,
        amount,
        beneficiary_code: beneficiaryCode,
        description: `Corporate purchase Tx ${txId}`,
      },
    ],
  });

  // check-transfer needs both the UrubutoPay-generated ref and our
  // beneficiary_code — encode both into the single opaque string payments.ts
  // stores as momo_ref, so bk.ts's Promise<string> signature doesn't change.
  return `${result.data.internal_transaction_ref_number}:${beneficiaryCode}`;
}
