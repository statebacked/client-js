import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { StateBackedClient, TokenExchangeRequest } from "./index.ts";
import { testServer } from "./server.test.ts";

Deno.test("token exchange", async () => {
  const port = 8686;
  const expectedReq: TokenExchangeRequest = {
    orgId: "my-org",
    service: "my-service",
    token: "my-token",
  };
  const expectedToken = "sb-token";

  const [abort, server] = await testServer(port, [
    async (req) => {
      assertEquals(
        new URL(req.url).pathname,
        "/tokens",
      );
      assertEquals(req.method, "POST");
      const body = await req.formData();
      assertEquals(Object.fromEntries(body.entries()), {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience:
          `https://tokens.statebacked.dev/${expectedReq.orgId}/${expectedReq.service}`,
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        subject_token: expectedReq.token,
      });

      return new Response(
        JSON.stringify({
          access_token: expectedToken,
        }),
        { status: 200 },
      );
    },
  ]);

  const client = new StateBackedClient(() => Promise.resolve("fake-token"), {
    apiHost: `http://localhost:${port}`,
  });

  const token = await client.tokens.exchange(expectedReq);
  assertEquals(token, expectedToken);

  abort.abort();
  await server;
});
