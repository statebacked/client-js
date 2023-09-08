import {
  BlobCtorType,
  Fetch,
  FormDataCtorType,
  WebSocketCtorType,
} from "./web-types.ts";

/**
 * Options for the StateBacked client.
 */
export type ClientOpts = {
  /**
   * The API host to use. Defaults to `https://api.statebacked.dev`.
   */
  apiHost?: string;

  /**
   * The organization ID to use.
   * Only required if you are using an admin session (e.g. the smply CLI)
   * AND you belong to more than one organization.
   *
   * If you are using a JWT signed with a key generated with `smply keys create`
   * (the standard case), you do not need to set this.
   */
  orgId?: string;

  /**
   * The claims representing the user we are acting as.
   *
   * This will cause all requests to fail if used with a non-admin token that does not
   * have sufficient permission to create keys.
   */
  actAs?: Record<string, unknown>;

  /**
   * Number of milliseconds between keep alive pings on
   * any open WebSocket connections.
   *
   * Defaults to 5 minutes.
   */
  wsPingIntervalMs?: number;

  /**
   * WebSocket implementation to use.
   *
   * Defaults to globalThis.WebSocket.
   */
  WebSocket?: WebSocketCtorType;

  /**
   * FormData implementation to use.
   *
   * Defaults to globalThis.FormData.
   */
  FormData?: FormDataCtorType;

  /**
   * Blob implementation to use.
   *
   * Defaults to globalThis.Blob.
   */
  Blob?: BlobCtorType;

  /**
   * Fetch implementation to use.
   *
   * Defaults to globalThis.fetch.
   */
  fetch?: Fetch;

  /**
   * HMAC SHA256 implementation to use.
   *
   * Should return the HMAC SHA256 of the data using the key.
   */
  hmacSha256?: (key: Uint8Array, data: Uint8Array) => Promise<Uint8Array>;

  /**
   * Base64url implementation to use.
   */
  base64url?: (data: Uint8Array) => string;
};
