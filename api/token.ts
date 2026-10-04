import { mintToken, rateLimited } from "../server/mint.js";

// Vercel Function: POST /api/token?experiment=talk|cards (also reachable at /interactions/api/token via vercel.json).
export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (rateLimited(ip)) return Response.json({ error: "Too many sessions — try again in a few minutes." }, { status: 429 });
  try {
    const experiment = new URL(request.url).searchParams.get("experiment") ?? "talk";
    return Response.json(await mintToken(process.env, experiment), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[token]", e);
    return Response.json({ error: e instanceof Error ? e.message : "Could not start a session." }, { status: 500 });
  }
}
