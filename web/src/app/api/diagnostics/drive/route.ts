import { diagnosticResponse } from "@/lib/diagnostic-proxy";

/** Admin only: tests the receipt storage (Google Drive) step by step, without uploading anything. */
export const dynamic = "force-dynamic";
export const GET = () => diagnosticResponse("/payments/drive-check");
