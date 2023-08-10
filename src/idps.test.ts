import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  DeleteIdentityProviderRequest,
  StateBackedClient,
  UpsertIdentityProviderRequest,
} from "./index.ts";
import { testServer } from "./server.test.ts";

Deno.test("upsert idp", async () => {
  const port = 8686;
  const expectedReq: UpsertIdentityProviderRequest = {
    aud: "https://example.com/aud",
    iss: "https://example.com/iss",
    jwksUrl: "https://example.com/.well-known/jwks",
    algs: ["RS256"],
    mapping: {
      "sub.$": "sub",
    },
  };

  const [abort, server] = await testServer(port, [
    async (req) => {
      assertEquals(
        new URL(req.url).pathname,
        "/idps",
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

  await client.identityProviders.upsert(expectedReq);

  abort.abort();
  await server;
});

Deno.test("delete idp", async () => {
  const port = 8686;
  const expectedReq: DeleteIdentityProviderRequest = {
    aud: "https://example.com/aud",
    iss: "https://example.com/iss",
  };

  const [abort, server] = await testServer(port, [
    async (req) => {
      assertEquals(
        new URL(req.url).pathname,
        "/idps",
      );
      assertEquals(req.method, "DELETE");
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

  await client.identityProviders.delete(expectedReq);

  abort.abort();
  await server;
});
