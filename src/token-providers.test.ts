import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { StateBackedClient, UpsertTokenProviderRequest } from "./index.ts";
import { testServer } from "./server.test.ts";

const port = 7007;

Deno.test("upsert token provider", async () => {
  const expectedReq: UpsertTokenProviderRequest = {
    keyId: "sbk_fake",
    service: "my-service",
    mapping: {
      "sub.$": "sub",
    },
  };

  const [abort, server] = await testServer(port, [
    async (req) => {
      assertEquals(
        new URL(req.url).pathname,
        "/token-providers",
      );
      assertEquals(req.method, "POST");
      assertEquals(await req.json(), expectedReq);

      return new Response(
        null,
        { status: 204 },
      );
    },
  ]);

  const client = new StateBackedClient(() => Promise.resolve("fake-token"), {
    apiHost: `http://localhost:${port}`,
  });

  await client.tokenProviders.upsert(expectedReq);

  abort.abort();
  await server;
});

Deno.test("delete token providers", async () => {
  const service = "my-service";

  const [abort, server] = await testServer(port, [
    (req) => {
      assertEquals(
        new URL(req.url).pathname,
        `/token-providers/${service}`,
      );
      assertEquals(req.method, "DELETE");

      return new Response(
        null,
        { status: 204 },
      );
    },
  ]);

  const client = new StateBackedClient(() => Promise.resolve("fake-token"), {
    apiHost: `http://localhost:${port}`,
  });

  await client.tokenProviders.delete(service);

  abort.abort();
  await server;
});
