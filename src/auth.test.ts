import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { StateBackedClient, TokenExchangeTokenConfig } from "./index.ts";
import { testServer } from "./server.test.ts";
import { signToken } from "https://deno.land/x/statebacked_token/mod.ts";

const port = 7001;

Deno.test("state backed token promise", async () => {
  await testAuthToken((expectedToken, port) =>
    new StateBackedClient(() => Promise.resolve(expectedToken), {
      apiHost: `http://localhost:${port}`,
    })
  );
});

Deno.test("state backed token string", async () => {
  await testAuthToken((expectedToken) =>
    new StateBackedClient(expectedToken, {
      apiHost: `http://localhost:${port}`,
    })
  );
});

Deno.test("state backed token promise property", async () => {
  await testAuthToken((expectedToken) =>
    new StateBackedClient({
      token: () => Promise.resolve(expectedToken),
    }, {
      apiHost: `http://localhost:${port}`,
    })
  );
});

Deno.test("state backed token string property", async () => {
  await testAuthToken((expectedToken) =>
    new StateBackedClient({
      token: expectedToken,
    }, {
      apiHost: `http://localhost:${port}`,
    })
  );
});

Deno.test("state backed token exchange with string token", async () => {
  const identityProviderToken = "idp-token";
  const orgId = "org-id";
  const tokenProviderService = "my-service";
  const tokenConfig = {
    identityProviderToken,
    orgId,
    tokenProviderService,
  };

  await testAuthToken(() =>
    new StateBackedClient(tokenConfig, {
      apiHost: `http://localhost:${port}`,
    }), tokenConfig);
});

Deno.test("state backed token exchange with promise token", async () => {
  const identityProviderToken = "idp-token";
  const orgId = "org-id";
  const tokenProviderService = "my-service";
  const tokenConfig = {
    identityProviderToken: () => Promise.resolve(identityProviderToken),
    orgId,
    tokenProviderService,
  };

  await testAuthToken(() =>
    new StateBackedClient(tokenConfig, {
      apiHost: `http://localhost:${port}`,
    }), tokenConfig);
});

Deno.test("state backed token promise when expired", async () => {
  let client: StateBackedClient | undefined;
  let wasCalled = false;
  await testAuthToken((expectedToken, port) => {
    client = new StateBackedClient(() => {
      wasCalled = true;
      return Promise.resolve(expectedToken);
    }, {
      apiHost: `http://localhost:${port}`,
    });
    client["latestToken"] = expectedToken + "-nope";
    client["tokenExpiration"] = Date.now() - 2000;
    return client;
  });

  assert(wasCalled);
  assert(client!["latestToken"]);
  assert(!client!["latestToken"].endsWith("-nope"));
  assert(client!["tokenExpiration"]! > Date.now());
});

Deno.test("state backed token exchange with promise token when expired", async () => {
  const identityProviderToken = "idp-token";
  const orgId = "org-id";
  const tokenProviderService = "my-service";
  let client: StateBackedClient | undefined;
  let wasCalled = false;
  const tokenConfig = {
    identityProviderToken: () => {
      wasCalled = true;
      return Promise.resolve(identityProviderToken);
    },
    orgId,
    tokenProviderService,
  };

  await testAuthToken((expectedToken) => {
    client = new StateBackedClient(tokenConfig, {
      apiHost: `http://localhost:${port}`,
    });
    client["latestToken"] = expectedToken + "-nope";
    client["tokenExpiration"] = Date.now() - 2000;
    return client;
  }, tokenConfig);

  assert(wasCalled);
  assert(client!["latestToken"]);
  assert(!client!["latestToken"].endsWith("-nope"));
  assert(client!["tokenExpiration"]! > Date.now());
});

async function testAuthToken(
  getClient: (expectedToken: string, port: number) => StateBackedClient,
  tokenExchangeParams?: TokenExchangeTokenConfig,
) {
  const machineName = "machine";
  const instanceName = "inst";
  const expectedToken = await signToken({
    stateBackedKeyId: "sbk_fake",
    stateBackedSecretKey: "sbsec_fake",
  }, {
    sub: "our-user",
  }, {
    expires: {
      in: "1h",
    },
  });

  const instanceGetHandler = (req: Request) => {
    assertEquals(
      req.headers.get("authorization"),
      `Bearer ${expectedToken}`,
    );

    return new Response(
      JSON.stringify({
        state: "fake-state",
      }),
      { status: 200 },
    );
  };

  const [abort, server] = await testServer(
    port,
    [
      tokenExchangeParams
        ? async (req: Request) => {
          assertEquals(new URL(req.url).pathname, "/tokens");
          if (!tokenExchangeParams) {
            throw new Error("unexpected token exchange request");
          }

          assertEquals(req.method, "POST");

          const formData = await req.formData();
          const body = Object.fromEntries(formData.entries());

          const subjectToken =
            typeof tokenExchangeParams.identityProviderToken === "string"
              ? tokenExchangeParams.identityProviderToken
              : (await tokenExchangeParams.identityProviderToken());

          assertEquals(
            body.grant_type,
            "urn:ietf:params:oauth:grant-type:token-exchange",
          );
          assertEquals(
            body.audience,
            `https://tokens.statebacked.dev/${tokenExchangeParams.orgId}/${tokenExchangeParams.tokenProviderService}`,
          );
          assertEquals(
            body.requested_token_type,
            "urn:ietf:params:oauth:token-type:access_token",
          );
          assertEquals(body.subject_token, subjectToken);

          return new Response(
            JSON.stringify({
              access_token: expectedToken,
            }),
            { status: 200 },
          );
        }
        : null,
      instanceGetHandler,
      // 2 to make sure we don't re-retrieve the token unnecessarily
      instanceGetHandler,
    ].filter(<T>(x: T | null): x is T => !!x),
  );

  const client = getClient(expectedToken, port);

  // ensure we don't re-retrieve the token during concurrent requests
  await Promise.all([
    client.machineInstances.get(machineName, instanceName),
    client.machineInstances.get(machineName, instanceName),
  ]);

  abort.abort();
  await server;
}