import { proxyPhoto } from "@/lib/photo-proxy";

/** A location's picture, same proxy path as an item's. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyPhoto("locations", id);
}
