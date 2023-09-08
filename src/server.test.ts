import { serve } from "https://deno.land/std@0.192.0/http/mod.ts";
import { defer } from "./defer.ts";
import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";

export async function testServer(
  port: number,
  matchers: Array<(req: Request) => Response | Promise<Response>>,
) {
  const [onListen, whenListening] = defer();
  const abort = new AbortController();

  const server = serve((req) => {
    return matchers.shift()!(req);
  }, { onListen, signal: abort.signal, port });

  await whenListening;

  return [
    abort,
    server.then(() => {
      assertEquals(matchers.length, 0);
    }),
  ] as const;
}
