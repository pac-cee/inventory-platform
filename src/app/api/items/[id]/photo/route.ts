import { proxyPhoto } from "@/lib/photo-proxy";

/** An item's picture, fetched through Next so the session token can be added. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyPhoto("items", id);
}
