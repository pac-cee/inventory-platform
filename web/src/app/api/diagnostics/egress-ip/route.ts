import { diagnosticResponse } from "@/lib/diagnostic-proxy";

/** Admin only: the public IP address the API server uses (the one MTN / UrubutoPay need to allow-list). */
export const dynamic = "force-dynamic";
export const GET = () => diagnosticResponse("/payments/egress-ip");
