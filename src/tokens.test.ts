import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { StateBackedClient, TokenExchangeRequest } from "./index.ts";
import { testServer } from "./server.test.ts";

const port = 7007;

Deno.test("token exchange", async () => {
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

Deno.test("token exchange after idp token failure", async () => {
  const machineName = "machine";
  const instanceName = "instance";
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
    (req) => {
      assertEquals(
        new URL(req.url).pathname,
        `/machines/${machineName}/i/${instanceName}`,
      );
      return new Response(
        JSON.stringify({
          state: "my-state",
        }),
        { status: 200 },
      );
    },
  ]);

  let shouldTokenFail = true;
  const client = new StateBackedClient({
    identityProviderToken: () =>
      shouldTokenFail
        ? Promise.reject(new Error())
        : Promise.resolve(expectedReq.token),
    orgId: expectedReq.orgId,
    tokenProviderService: expectedReq.service,
  }, {
    apiHost: `http://localhost:${port}`,
  });

  // our token provider will fail at first
  await assertRejects(() =>
    client.machineInstances.get(machineName, instanceName)
  );

  shouldTokenFail = false;

  // and we should try to refresh it
  const inst = await client.machineInstances.get(machineName, instanceName);
  assertEquals(inst.state, "my-state");

  abort.abort();
  await server;
});
