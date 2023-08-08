import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { StateBackedClient } from "./index.ts";
import { testServer } from "./test-server.ts";
import {
  decode as b64Decode,
} from "https://deno.land/std@0.192.0/encoding/base64url.ts";

Deno.test("dangerously.delete", async () => {
  const port = 8686;
  const machineName = "machine";

  const [abort, server] = await testServer(port, [
    async (req) => {
      assertEquals(
        new URL(req.url).pathname,
        `/machines/${machineName}`,
      );
      assertEquals(req.method, "DELETE");

      const {
        hmacSha256OfMachineNameWithMachineNameKey,
        dangerDataWillBeDeletedForever,
      } = await req.json();

      assertEquals(dangerDataWillBeDeletedForever, true);

      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(machineName),
        {
          name: "HMAC",
          hash: { name: "SHA-256" },
        },
        false,
        ["verify"],
      );

      const verified = await crypto.subtle.verify(
        "HMAC",
        key,
        b64Decode(hmacSha256OfMachineNameWithMachineNameKey),
        new TextEncoder().encode(machineName),
      );

      assert(verified);

      return new Response(null, { status: 204 });
    },
  ]);

  const client = new StateBackedClient(() => Promise.resolve("fake-token"), {
    apiHost: `http://localhost:${port}`,
  });

  await client.machines.dangerously.delete(
    machineName,
    {
      dangerDataWillBeDeletedForever: true,
    },
  );

  abort.abort();
  await server;
});
