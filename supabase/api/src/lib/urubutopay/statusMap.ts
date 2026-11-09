// Maps UrubutoPay's check-transfer status vocabulary — confirmed from the
// live OpenAPI spec: INITIATED, PENDING, SUCCESSFUL, FAILED — to the
// SUCCESSFUL|FAILED|PENDING union payments.ts expects.
export type UrubutoStatus = "SUCCESSFUL" | "FAILED" | "PENDING";

const STATUS_MAP: Record<string, UrubutoStatus> = {
  INITIATED: "PENDING",
  PENDING: "PENDING",
  SUCCESSFUL: "SUCCESSFUL",
  // The live spec's tables say both SUCCESS and SUCCESSFUL.
  SUCCESS: "SUCCESSFUL",
  FAILED: "FAILED",
};

// Unknown/unrecognized status is treated as still-pending, never silently as
// success — an unmapped string should never look like money moved.
export function mapUrubutoStatus(transactionStatus: string | null | undefined): UrubutoStatus {
  if (!transactionStatus) return "PENDING";
  return STATUS_MAP[transactionStatus.toUpperCase()] ?? "PENDING";
}
