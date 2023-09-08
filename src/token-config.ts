/**
 * Token configuration to directly provide a State Backed token
 * that the client will use for all requests.
 */
export type StateBackedTokenConfig = {
  /**
   * The State Backed token to use or a function returning a promise for that token.
   */
  token: string | (() => Promise<string>);
};

/**
 * Token configuration allowing the State Backed client to exchange
 * an identity provider token for a State Backed token.
 *
 * Token exchange must be configured prior to use by creating at least one identity provider and at least one token provider.
 */
export type TokenExchangeTokenConfig = {
  /**
   * The identity provider token to exchange for a State Backed token or a function returning a promise for that token.
   *
   * For example, this might be your Auth0 or Supabase access token.
   */
  identityProviderToken: string | (() => Promise<string>);

  /**
   * The name of the token provider service to use to generate the State Backed token.
   */
  tokenProviderService: string;

  /**
   * The State Backed organization ID to use.
   */
  orgId: string;
};
