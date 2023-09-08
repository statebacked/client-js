import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { StateBackedClient, TokenExchangeTokenConfig } from "./index.ts";
import { testServer } from "./server.test.ts";
import { signToken } from "https://deno.land/x/statebacked_token/mod.ts";
import { anonymousTokenConfig } from "./anonymous-token-config.ts";
import {
  decode as b64UrlDecode,
  encode as b64UrlEncode,
} from "https://deno.land/std@0.192.0/encoding/base64url.ts";

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

async function isValidAnonymousToken(
  orgId: string,
  actual: string,
  expected: string,
  claimCheck: (claims: Record<string, unknown>) => boolean | Promise<boolean> =
    () => true,
) {
  const expectedParts = expected.split(".");
  const parts = actual.split(".");
  const sig = parts[2];
  const data = parts.slice(0, 2).join(".");
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(orgId),
    {
      name: "HMAC",
      hash: { name: "SHA-256" },
    },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    "HMAC",
    k,
    b64UrlDecode(sig),
    new TextEncoder().encode(data),
  );
  if (!valid) {
    return false;
  }

  const claims = JSON.parse(
    new TextDecoder().decode(b64UrlDecode(parts[1])),
  );
  const expectedClaims = JSON.parse(
    new TextDecoder().decode(b64UrlDecode(expectedParts[1])),
  );
  assertEquals(claims, expectedClaims);

  const header = JSON.parse(
    new TextDecoder().decode(b64UrlDecode(parts[0])),
  );
  const expectedHeader = JSON.parse(
    new TextDecoder().decode(b64UrlDecode(expectedParts[0])),
  );
  assertEquals(header, expectedHeader);

  return claimCheck(claims);
}

Deno.test("anonymous token, default session", async () => {
  const orgId = "org-id";
  const tokenConfig = {
    anonymous: {
      orgId,
    },
  };

  const anonTokenConfig = anonymousTokenConfig(tokenConfig, {
    base64url: (x) => b64UrlEncode(x),
    hmacSha256,
  });

  await testAuthToken(
    () =>
      new StateBackedClient(tokenConfig, {
        apiHost: `http://localhost:${port}`,
      }),
    anonTokenConfig,
    isValidAnonymousToken.bind(null, orgId),
  );
});

Deno.test("anonymous token, provided session", async () => {
  const orgId = "org-id";
  const sid = "session-id";
  const tokenConfig = {
    anonymous: {
      orgId,
      getSessionId: () => sid,
    },
  };

  const anonTokenConfig = anonymousTokenConfig(tokenConfig, {
    base64url: (x) => b64UrlEncode(x),
    hmacSha256,
  });

  await testAuthToken(
    () =>
      new StateBackedClient(tokenConfig, {
        apiHost: `http://localhost:${port}`,
      }),
    anonTokenConfig,
    (actual, expected) =>
      isValidAnonymousToken(
        orgId,
        actual,
        expected,
        (claims) => claims.sid === sid,
      ),
  );
});

Deno.test("anonymous token, provided device", async () => {
  const orgId = "org-id";
  const did = "device-id";
  const tokenConfig = {
    anonymous: {
      orgId,
      getDeviceId: () => did,
    },
  };

  const anonTokenConfig = anonymousTokenConfig(tokenConfig, {
    base64url: (x) => b64UrlEncode(x),
    hmacSha256,
  });

  await testAuthToken(
    () =>
      new StateBackedClient(tokenConfig, {
        apiHost: `http://localhost:${port}`,
      }),
    anonTokenConfig,
    (actual, expected) =>
      isValidAnonymousToken(
        orgId,
        actual,
        expected,
        (claims) => claims.did === did,
      ),
  );
});

async function testAuthToken(
  getClient: (expectedToken: string, port: number) => StateBackedClient,
  tokenExchangeParams?: TokenExchangeTokenConfig,
  isCorrectIdentityProviderToken: (
    actualToken: string,
    expectedToken: string,
  ) => boolean | Promise<boolean> = (actualToken, expectedToken) =>
    actualToken === expectedToken,
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
          assert(
            await isCorrectIdentityProviderToken(
              body.subject_token as string,
              subjectToken,
            ),
          );

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

async function hmacSha256(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey(
    "raw",
    key,
    {
      name: "HMAC",
      hash: { name: "SHA-256" },
    },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    k,
    data,
  );

  return new Uint8Array(sig);
}
