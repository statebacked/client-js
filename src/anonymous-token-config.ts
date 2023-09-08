import { ClientOpts } from "./client-opts.ts";
import { TokenExchangeTokenConfig } from "./token-config.ts";

/**
 * Token configuration for the default anonymous token provider.
 * Your machine will receive an auth context that includes a
 * session ID (`sid`) and, if provided, a device ID (`did`) as well as an `auth` property
 * that always has the value "anonymous".
 *
 * For most use cases, you probably want to use the token exchange token provider with an identity provider like Auth0 or your own authentication.
 * Make sure you really want anonymous access before using this token provider.
 */
export type AnonymousTokenConfig = {
  /**
   * The config for anonymous access
   */
  anonymous: {
    /**
     * The State Backed organization ID to use for anonymous access.
     */
    orgId: string;
    getSessionId?: () => string | Promise<string>;
    getDeviceId?: () => string | Promise<string>;
  };
};

const genBadUuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

const globalSession = (() => {
  let session: string | undefined;
  return () => {
    if (!session) {
      if (
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ) {
        session = crypto.randomUUID();
      } else {
        session = genBadUuid();
      }
    }

    return session;
  };
})();

export const anonymousTokenConfig = (
  opts: AnonymousTokenConfig,
  clientConfig: Required<Pick<ClientOpts, "base64url" | "hmacSha256">>,
): TokenExchangeTokenConfig => ({
  identityProviderToken: async () => {
    const sid = opts.anonymous.getSessionId
      ? (await opts.anonymous.getSessionId())
      : globalSession();
    const did = opts.anonymous.getDeviceId
      ? (await opts.anonymous.getDeviceId())
      : sid;
    const header = {
      "alg": "HS256",
      "typ": "JWT",
    };
    const anonScope =
      `https://${opts.anonymous.orgId}.anonymous.auth.statebacked.dev`;
    const iat = Math.floor(Date.now() / 1000);
    const claims = {
      aud: anonScope,
      iss: anonScope,
      iat,
      exp: iat + 86400,
      sid,
      did,
    };
    const encHeader = clientConfig.base64url(
      new TextEncoder().encode(JSON.stringify(header)),
    );
    const encClaims = clientConfig.base64url(
      new TextEncoder().encode(JSON.stringify(claims)),
    );
    const data = `${encHeader}.${encClaims}`;
    const sig = await clientConfig.hmacSha256(
      new TextEncoder().encode(opts.anonymous.orgId),
      new TextEncoder().encode(data),
    );
    const encSig = clientConfig.base64url(sig);
    return `${data}.${encSig}`;
  },
  tokenProviderService: "anonymous-statebacked-dev",
  orgId: opts.anonymous.orgId,
});
