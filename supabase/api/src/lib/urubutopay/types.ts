// UrubutoPay Bulk Disbursement API — types matching the live OpenAPI spec at
// https://developers.urubutopay.rw/reference/ (InitiateDisbursementRequest,
// Beneficiary, TransferStatusDataResponse, GetWalletBalanceDataResponse).

export interface UrubutoBeneficiary {
  beneficiary_names: string;
  beneficiary_phone_number: string; // phone number (MOMO) or bank account number (EKASH)
  amount: number;
  beneficiary_code: string;
  description: string;
}

export interface InitiateDisbursementRequest {
  source_of_funds: string;
  source_payment_channel: "MERCHANT_WALLET";
  destination_payment_channel: "MOMO" | "EKASH";
  external_transaction_ref_number: string;
  beneficiary_to_be_charged: "YES" | "NO";
  wallet_account_id: string;
  beneficiaries: UrubutoBeneficiary[];
}

// Envelope varies by endpoint in the live spec: `success: true` and/or
// `status: 200` (number or string) — see isSuccessBody() in client.ts.
export interface InitiateDisbursementResponse {
  timestamp?: string;
  success?: boolean;
  status?: number | string;
  message: string;
  data: {
    internal_transaction_ref_number: string;
    external_transaction_ref_number: string;
    amount: number;
    transaction_date: string;
    transaction_status: string;
    disbursement_status: string;
    source_of_funds: string;
    currency: string;
  };
}

export interface CheckTransferStatusResponse {
  timestamp?: string;
  success?: boolean;
  status?: number | string;
  message?: string;
  data?: {
    source_payment_channel: string;
    destination_payment_channel: string;
    transaction_status: string;
    transaction_date: string;
    amount: number;
    currency: string;
    beneficiary_names: string;
    beneficiary_phone_number: string;
    beneficiary_code: string;
    internal_transaction_ref_number: string;
    disbursement_ref_number: string;
    external_disbursement_ref_number: string;
  };
}

export interface WalletBalanceResponse {
  timestamp?: string;
  status?: number | boolean;
  success?: boolean;
  message?: string;
  data: {
    balance: number;
    currency: string;
    organization: { name: string };
  };
}
