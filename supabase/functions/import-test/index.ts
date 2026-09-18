import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getGreeting } from "../_shared/test_helper.ts";

// Isolated diagnostic for the _shared/*.ts cross-file import question
// (see whoami's history — the first deploy imported ../_shared/session.ts
// and returned nothing over curl; switching to a self-contained file
// fixed it, but that was never confirmed to be the actual cause rather
// than a leftover shell-quoting issue in the test at the time). No auth,
// no POST body, no other variable — just "does the import resolve".
// Accepts any method so a plain `curl <url> -H "apikey: ..."` is enough
// to test it. Delete this function once the question is settled.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  return new Response(JSON.stringify({ message: getGreeting() }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});
