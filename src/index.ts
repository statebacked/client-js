import * as errors from "./errors.ts";
import * as api from "./gen-api.ts";
import { ReconnectingWebSocket } from "./reconnecting-web-socket.ts";
import {
  BlobCtorType,
  Fetch,
  FetchResponseType,
  FormDataCtorType,
  WebSocketCtorType,
} from "./web-types.ts";
import { EnhancedState, enhanceState, toStrings } from "./state-utils.ts";

export { errors };

const DEFAULT_WS_PING_INTERVAL = 5 * 60 * 1000;

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

export type TokenConfig = StateBackedTokenConfig | TokenExchangeTokenConfig;

/**
 * A client for the StateBacked.dev API.
 *
 * State Backed allows you to launch instances of XState state machines in the
 * cloud with a simple API.
 *
 * This client is suitable for use client-side or server-side.
 *
 * See the full State Backed documentation at https://docs.statebacked.dev.
 *
 * To use this client, first, download the smply CLI with `npm install --global smply`.
 * Then, create an API key with `smply keys create`.
 * On your server, use @statebacked/token to generate a JWT with the key you created.
 *
 * Then, create a State Backed client with new StateBackedClient(token);
 */
export class StateBackedClient {
  private readonly opts:
    & Omit<ClientOpts, "actAs">
    & Required<
      Pick<
        Omit<ClientOpts, "actAs">,
        | "apiHost"
        | "wsPingIntervalMs"
        | "fetch"
        | "Blob"
        | "FormData"
        | "hmacSha256"
        | "base64url"
      >
    >
    & {
      actAs?: string;
    };
  private latestToken: string | undefined;
  private tokenExpiration: number | undefined;
  private inProgressTokenPromise: Promise<string> | undefined;
  private ws: ReconnectingWebSocket<WSToClientMsg, WSToServerMsg> | undefined;

  constructor(
    /**
     * Configuration to retrieve the State Backed token to use for all requests.
     */
    private tokenConfig: TokenConfig | string | (() => Promise<string>),
    /**
     * Options for the client.
     */
    opts?: ClientOpts,
  ) {
    this.opts = {
      apiHost: opts?.apiHost ?? "https://api.statebacked.dev",
      orgId: opts?.orgId,
      actAs: opts?.actAs ? JSON.stringify(opts.actAs) : undefined,
      WebSocket: opts?.WebSocket ??
        (globalThis as any as { WebSocket: WebSocketCtorType }).WebSocket,
      wsPingIntervalMs: opts?.wsPingIntervalMs ?? DEFAULT_WS_PING_INTERVAL,
      Blob: opts?.Blob ?? (globalThis as any as { Blob: BlobCtorType }).Blob,
      FormData: opts?.FormData ??
        (globalThis as any as { FormData: FormDataCtorType }).FormData,
      fetch: opts?.fetch ??
        (globalThis as any as { fetch: Fetch }).fetch.bind(globalThis),
      hmacSha256: opts?.hmacSha256 ?? (async (key, data) => {
        const cryptoKey = await crypto.subtle.importKey(
          "raw",
          key,
          {
            name: "HMAC",
            hash: { name: "SHA-256" },
          },
          true,
          ["sign"],
        );
        const sig = await crypto.subtle.sign(
          "HMAC",
          cryptoKey,
          data,
        );

        return new Uint8Array(sig);
      }),
      base64url: opts?.base64url ?? ((data) => {
        const binString = Array.from(data, (x) => String.fromCodePoint(x)).join(
          "",
        );
        return btoa(binString).replace(/[+]/g, "-").replace(/[\/]/g, "_")
          .replace(/=/g, "");
      }),
    };

    // let's eagerly retrieve the token
    this.token().catch(() => {
      // we can swallow the error here because we will attempt to get the token
      // again on the next request and throw a propper error
    });
  }

  private tokenIsExpired() {
    return this.tokenExpiration && this.tokenExpiration < Date.now() - 1_000;
  }

  private setToken(token: string) {
    this.latestToken = token;

    try {
      const jwt = JSON.parse(atob(token.split(".")[1]));
      if (typeof jwt.exp === "number") {
        this.tokenExpiration = jwt.exp * 1000;
      }
    } catch (_) {
      // ignore, we just won't set our token expiration
    }
  }

  private token() {
    if (this.latestToken) {
      if (!this.tokenIsExpired()) {
        return Promise.resolve(this.latestToken);
      }

      this.latestToken = undefined;
      // continue as though we don't have the token
    }

    if (!this.inProgressTokenPromise) {
      this.inProgressTokenPromise = this.refreshToken().then((token) => {
        this.setToken(token);
        this.inProgressTokenPromise = undefined;
        return token;
      }).catch((err) => {
        this.inProgressTokenPromise = undefined;
        throw err;
      });
    }

    return this.inProgressTokenPromise;
  }

  private async refreshToken() {
    const tokenConfig = this.tokenConfig;

    if (typeof tokenConfig === "string") {
      // supports the old API where you could pass a token directly
      return tokenConfig;
    }

    if (typeof tokenConfig === "function") {
      // supports the old API where you could pass a token function directly
      return tokenConfig().catch((err) => {
        throw new errors.UnauthorizedError(
          "failed to retrieve token",
          undefined,
          err,
        );
      });
    }

    if (
      "token" in tokenConfig && typeof tokenConfig.token === "string"
    ) {
      return tokenConfig.token;
    }

    if (
      "token" in tokenConfig && typeof tokenConfig.token === "function"
    ) {
      return tokenConfig.token().catch((err) => {
        throw new errors.UnauthorizedError(
          "failed to retrieve token",
          undefined,
          err,
        );
      });
    }

    if ("identityProviderToken" in tokenConfig) {
      return this.tokens.exchange({
        orgId: tokenConfig.orgId,
        service: tokenConfig.tokenProviderService,
        token: typeof tokenConfig.identityProviderToken === "string"
          ? tokenConfig.identityProviderToken
          : await tokenConfig.identityProviderToken(),
      });
    }

    throw new errors.UnauthorizedError("invalid token configuration");
  }

  private get nonAuthJSONHeaders() {
    return {
      "content-type": "application/json",
      ...(this.opts.orgId ? { "x-statebacked-org-id": this.opts.orgId } : {}),
      ...(this.opts.actAs ? { "x-statebacked-act": this.opts.actAs } : {}),
    };
  }

  private get headers() {
    return this.token().then((token) => ({
      ...this.nonAuthJSONHeaders,
      "authorization": `Bearer ${token}`,
    }));
  }

  private async ensureWebSocketEstablished(
    handler: (msg: WSToClientMsg) => void,
  ) {
    const unsubscribe = () => {
      this.ws?.removeListener(handler);
    };

    const token = await this.token();

    if (this.ws) {
      this.ws.addListener(handler);
      return unsubscribe;
    }

    const url = new URL(this.opts.apiHost);
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
    url.pathname = url.pathname.replace(/[/]$/, "") + "/rt";
    url.searchParams.set("token", token);
    if (this.opts.orgId) {
      url.searchParams.set("x-statebacked-org-id", this.opts.orgId);
    }

    const WS = this.opts.WebSocket;

    if (!WS) {
      throw new Error(
        "Please provide a WebSocket implementation in the StateBackedClient constructor",
      );
    }

    this.ws = new ReconnectingWebSocket(WS, url.toString(), () => {
      const wsPingInterval = setInterval(() => {
        this.ws?.send({ type: "ping" });
      }, this.opts.wsPingIntervalMs);

      return () => {
        clearInterval(wsPingInterval);
      };
    });
    this.ws.addListener(handler);

    return unsubscribe;
  }

  /**
   * Machines API.
   *
   * Machine definitions name a logical machine.
   *
   * For example, you might have a machine definition that represents a flow for a user in your app (like the onboarding machine)
   * or a machine definition that represents the state of a user or entity (like a user machine or a machine for a document that might be shared across many users).
   *
   * We call this a logical machine because your actual business logic lives in machine versions.
   *
   * Once a machine exists and it has at least one version, you can launch instances of it.
   */
  public readonly machines = {
    /**
     * Retrieve a page of machine definitions.
     *
     * @param opts - options for the list operation
     * @param signal - an optional AbortSignal to abort the request
     * @returns a page of machine definitions
     */
    list: async (
      opts?: ListOptions,
      signal?: AbortSignal,
    ): Promise<ListMachinesResponse> => {
      const url = new URL(`${this.opts.apiHost}/machines`);
      if (opts?.cursor) {
        url.searchParams.set("cursor", opts.cursor);
      }

      return adaptErrors<ListMachinesResponse>(
        await this.opts.fetch(
          url,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      );
    },
    /**
     * Create a machine.
     *
     * @param machineName - the name of the machine
     * @param signal - an optional AbortSignal to abort the request
     */
    create: async (
      machineName: MachineName,
      signal?: AbortSignal,
    ): Promise<void> => {
      const req: CreateMachineRequest = {
        slug: machineName,
      };

      adaptErrors(
        await this.opts.fetch(
          `${this.opts.apiHost}/machines`,
          {
            method: "POST",
            headers: await this.headers,
            body: JSON.stringify(req),
            signal,
          },
        ),
      );
    },

    /**
     * The methods within machines.dangerous are... **DANGEROUS**.
     *
     * They are intended to be used in development or in very exceptional circumstances
     * in production.
     *
     * These methods can cause data loss.
     */
    dangerously: {
      /**
       * Deletes a machine.
       *
       * **THIS WILL OBVIOUSLY CAUSE DATA LOSS**
       *
       * Deleted machines are not recoverable and deleting a machine deletes its associated
       * versions and the migrations between them.
       *
       * Machines cannot be deleted if there are still instances of them running.
       * You may delete instances of machines using @see machineInstances.dangerously.delete.
       *
       * @param machineName - the name of the machine we are deleting an instance of
       * @param machineInstanceName - the name of the machine instance we are deleting
       * @param req - confirmation that you are permanently deleting data
       * @param signal - an optional AbortSignal to abort the request
       */
      delete: async (
        machineName: MachineName,
        req: { dangerDataWillBeDeletedForever: true },
        signal?: AbortSignal,
      ): Promise<void> => {
        const hmac = await this.opts.hmacSha256(
          new TextEncoder().encode(machineName),
          new TextEncoder().encode(machineName),
        );

        const fullReq: DeleteMachineRequest = {
          ...req,
          hmacSha256OfMachineNameWithMachineNameKey: await this.opts.base64url(
            hmac,
          ),
        };

        await adaptErrors<void>(
          await this.opts.fetch(
            `${this.opts.apiHost}/machines/${machineName}`,
            {
              method: "DELETE",
              headers: await this.headers,
              body: JSON.stringify(fullReq),
              signal,
            },
          ),
        );
      },
    },
  };

  /**
   * Machine versions API.
   *
   * Each machine definition may have many machine versions associated with it.
   *
   * The most important aspect of a machine version is your actual code for your authorizer and state machines.
   *
   * Machine versions can also provide a version specifier to help you link a version to your own systems.
   * We recommend a semantic version, timestamp, or git commit sha for a version specifier.
   *
   * Machine versions are created in a 3-step process: provisional creation to reserve an ID, code upload, and finalization.
   * You can use the convenience wrapper, `create`, to do all 3 steps in one call.
   *
   * If you want to migrate running instances from one version to another, @see machineVersionMigrations.
   */
  public readonly machineVersions = {
    /**
     * Retrieve a page of machine versions for a machine.
     *
     * @param machineName - the name of the machine we are retrieving versions for
     * @param opts - options for the list operation
     * @param signal - an optional AbortSignal to abort the request
     * @returns - a page of machine versions
     */
    list: async (
      machineName: MachineName,
      opts?: ListOptions,
      signal?: AbortSignal,
    ): Promise<ListMachineVersionsResponse> => {
      const url = new URL(`${this.opts.apiHost}/machines/${machineName}/v`);
      if (opts?.cursor) {
        url.searchParams.set("cursor", opts.cursor);
      }

      return adaptErrors<ListMachineVersionsResponse>(
        await this.opts.fetch(
          url,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      );
    },

    /**
     * Provisionally create a machine version.
     *
     * After this call, you must upload your code and finalize the machine version like this:
     *
     * ```
     * const { codeUploadFields, codeUploadUrl } = await provisionalVersionCreationResponse.json();
     * const uploadForm = new FormData();
     * for (const [key, value] of Object.entries(codeUploadFields)) {
     *   uploadForm.append(key, value as string);
     * }
     * uploadForm.set("content-type", "application/javascript");
     * uploadForm.append(
     *   "file",
     *   new Blob(["javascript-code-here"], {
     *     type: "application/javascript",
     *   }),
     *   "your-file-name.js",
     * );
     * const uploadRes = await fetch(
     *   codeUploadUrl,
     *   {
     *     method: "POST",
     *     body: uploadForm,
     *   },
     * );
     * ```
     *
     * @param machineName - the name of the machine we are adding a version to
     * @param signal - an optional AbortSignal to abort the request
     * @returns code upload fields and url to upload the machine version's code to and a signed machine version ID to use in the finalization step
     */
    provisionallyCreate: async (
      machineName: MachineName,
      gzip = false,
      signal?: AbortSignal,
    ): Promise<ProvisionallyCreateVersionResponse> =>
      adaptErrors<ProvisionallyCreateVersionResponse>(
        await this.opts.fetch(
          `${this.opts.apiHost}/machines/${machineName}/v${
            gzip ? "?gzip" : ""
          }`,
          {
            method: "POST",
            headers: await this.headers,
            signal,
          },
        ),
      ),

    /**
     * Finalize the creation of a machine version.
     *
     * Once a machine version is finalized, you may create instances from it.
     * If you want to migrate running instances from one version to another, @see machineVersionMigrations.
     * If you want all future instances to use this version by default, pass { makeCurrent: true }.
     *
     * @param machineName - the name of the machine we are finalizing a version for
     * @param signedMachineVersionId - the signed machine version ID returned from the provisional creation step
     * @param req - version information
     * @param signal - an optional AbortSignal to abort the request
     * @returns machine version ID
     */
    finalize: async (
      machineName: MachineName,
      signedMachineVersionId: string,
      req: FinalizeVersionRequest,
      signal?: AbortSignal,
    ): Promise<FinalizeVersionResponse> =>
      adaptErrors<FinalizeVersionResponse>(
        await this.opts.fetch(
          `${this.opts.apiHost}/machines/${machineName}/v/${signedMachineVersionId}`,
          {
            method: "PUT",
            headers: await this.headers,
            body: JSON.stringify(req),
            signal,
          },
        ),
      ),

    /**
     * Convenience method to create a machine version in one call.
     *
     * Once a machine version is created, you may create instances from it.
     * If you want to migrate running instances from one version to another, @see machineVersionMigrations.
     * If you want all future instances to use this version by default, pass { makeCurrent: true }.
     *
     * @param machineName - the name of the machine we are adding a version to
     * @param req - version information
     * @param signal - an optional AbortSignal to abort the request
     * @returns machine version ID
     */
    create: async (
      machineName: MachineName,
      req: NonNullable<FinalizeVersionRequest> & CodeReq,
      signal?: AbortSignal,
    ): Promise<FinalizeVersionResponse> => {
      const gzip = "gzippedCode" in req;
      const provisionalCreationRes = await this.machineVersions
        .provisionallyCreate(machineName, gzip, signal);
      const {
        codeUploadFields,
        codeUploadUrl,
        machineVersionId: signedMachineVersionId,
      } = provisionalCreationRes;

      const uploadResponse = await uploadCode(
        this.opts,
        codeUploadUrl,
        codeUploadFields,
        {
          ...req,
          fileName: `${machineName}.js`,
        },
        signal,
      );

      if (!uploadResponse.ok) {
        throw new errors.ApiError(
          "error uploading code",
          uploadResponse.status,
        );
      }

      return this.machineVersions.finalize(
        machineName,
        signedMachineVersionId,
        {
          clientInfo: req.clientInfo,
          makeCurrent: req.makeCurrent,
        },
        signal,
      );
    },
  };

  /**
   * Machine version migrations API.
   *
   * Migrations allow you to migrate running instances from one machine version to another.
   *
   * A machine version migration maps states and context from one machine version to another.
   *
   * Similarly to machine versions, machine version migrations are created in a 3-step process: provisional creation to reserve an ID, code upload, and finalization.
   *
   * However, you can use the `create` convenience wrapper to do all 3 steps in one call.
   */
  public readonly machineVersionMigrations = {
    /**
     * Provisionally create a machine version migration.
     *
     * After this call, you must upload your code and finalize the machine version migration like this:
     *
     * ```
     * const { codeUploadFields, codeUploadUrl } = await provisionalVersionMigrationCreationResponse.json();
     * const uploadForm = new FormData();
     * for (const [key, value] of Object.entries(codeUploadFields)) {
     *   uploadForm.append(key, value as string);
     * }
     * uploadForm.set("content-type", "application/javascript");
     * uploadForm.append(
     *   "file",
     *   new Blob(["javascript-code-here"], {
     *     type: "application/javascript",
     *   }),
     *   "your-file-name.js",
     * );
     * const uploadRes = await fetch(
     *   codeUploadUrl,
     *   {
     *     method: "POST",
     *     body: uploadForm,
     *   },
     * );
     * ```
     *
     * @param machineName - the name of the machine we are adding a version migration to
     * @param req - migration information
     * @param signal - an optional AbortSignal to abort the request
     * @returns code upload fields and url to upload the machine version migration's code to and a signed machine version migration ID to use in the finalization step
     */
    provisionallyCreate: async (
      machineName: MachineName,
      req: ProvisionallyCreateMachineVersionMigrationRequest,
      gzip = false,
      signal?: AbortSignal,
    ): Promise<ProvisionallyCreateMachineVersionMigrationResponse> =>
      adaptErrors<ProvisionallyCreateMachineVersionMigrationResponse>(
        await this.opts.fetch(
          `${this.opts.apiHost}/machines/${machineName}/migrations${
            gzip ? "?gzip" : ""
          }`,
          {
            method: "POST",
            headers: await this.headers,
            signal,
            body: JSON.stringify(req),
          },
        ),
      ),

    /**
     * Finalize the creation of a machine version migration.
     *
     * Once a machine version migration is finalized, it may participate in upgrade operations on existing instances.
     *
     * @param machineName - the name of the machine we are finalizing a version for
     * @param signedMachineVersionMigrationId - the signed machine version migration ID returned from the provisional creation step
     * @param signal - an optional AbortSignal to abort the request
     * @returns machine version migration ID
     */
    finalize: async (
      machineName: MachineName,
      signedMachineVersionMigrationId: string,
      signal?: AbortSignal,
    ): Promise<FinalizeMachineVersionMigrationResponse> =>
      adaptErrors<FinalizeMachineVersionMigrationResponse>(
        await this.opts.fetch(
          `${this.opts.apiHost}/machines/${machineName}/migrations/${signedMachineVersionMigrationId}`,
          {
            method: "PUT",
            headers: await this.headers,
            signal,
          },
        ),
      ),

    /**
     * Convenience method to create a machine version migration in one call.
     *
     * Once a machine version migration is finalized, it may participate in upgrade operations on existing instances.
     *
     * @param machineName - the name of the machine we are adding a version to
     * @param req - migration information
     * @param signal - an optional AbortSignal to abort the request
     * @returns machine version migration ID
     */
    create: async (
      machineName: MachineName,
      req:
        & NonNullable<ProvisionallyCreateMachineVersionMigrationRequest>
        & CodeReq,
      signal?: AbortSignal,
    ): Promise<FinalizeMachineVersionMigrationResponse> => {
      const gzip = "gzippedCode" in req;
      const provisionalCreationRes = await this.machineVersionMigrations
        .provisionallyCreate(machineName, req, gzip, signal);
      const {
        codeUploadFields,
        codeUploadUrl,
        machineVersionMigrationId: signedMachineVersionMigrationId,
      } = provisionalCreationRes;

      const uploadResponse = await uploadCode(
        this.opts,
        codeUploadUrl,
        codeUploadFields,
        {
          ...req,
          fileName:
            `${machineName}_${req.fromMachineVersionId}_to_${req.toMachineVersionId}.js`,
        },
        signal,
      );

      if (!uploadResponse.ok) {
        throw new errors.ApiError(
          "error uploading code",
          uploadResponse.status,
        );
      }
      return this.machineVersionMigrations.finalize(
        machineName,
        signedMachineVersionMigrationId,
        signal,
      );
    },
  };

  /**
   * Machine instances API.
   *
   * Think of a machine definition like a class and machine instances as, well, instances of that class.
   *
   * An instance of a machine has persistent state that preserves the state of the XState machine, including any context, history, etc.
   *
   * You can create as many instances of each machine as you'd like. Each instance is independent. It has its own name, its own state, makes its own authorization decisions, receives its own events, and handles its own delayed events.
   */
  public readonly machineInstances = {
    /**
     * Retrieve a page of machine instances for a machine.
     *
     * @param machineName - the name of the machine we are retrieving instances for
     * @param opts - options for the list operation
     * @param signal - an optional AbortSignal to abort the request
     * @returns - a page of machine instances
     */
    list: async (
      machineName: MachineName,
      opts?: ListOptions,
      signal?: AbortSignal,
    ): Promise<ListMachineInstancesResponse> => {
      const url = new URL(
        `${this.opts.apiHost}/machines/${machineName}/i`,
      );
      if (opts?.cursor) {
        url.searchParams.set("cursor", opts.cursor);
      }

      return adaptErrors<ListMachineInstancesResponse>(
        await this.opts.fetch(
          url,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      );
    },

    /**
     * Retrieve a page of transitions for a machine instance.
     *
     * @param machineName - the name of the machine we are retrieving transitions for
     * @param machineInstanceName - the name of the machine instance we are retrieving transitions for
     * @param opts - options for the list operation
     * @param signal - an optional AbortSignal to abort the request
     * @returns - a page of machine instance transitions
     */
    listTransitions: async (
      machineName: MachineName,
      machineInstanceName: MachineInstanceName,
      opts?: ListOptions,
      signal?: AbortSignal,
    ): Promise<ListMachineInstanceTransitionsResponse> => {
      const url = new URL(
        `${this.opts.apiHost}/machines/${machineName}/i/${machineInstanceName}/events`,
      );
      if (opts?.cursor) {
        url.searchParams.set("cursor", opts.cursor);
      }

      return adaptErrors<ListMachineInstanceTransitionsResponse>(
        await this.opts.fetch(
          url,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      );
    },

    /**
     * Create a machine instance.
     *
     * @param machineName - the name of the machine we are creating an instance of
     * @param req - instance information
     * @param signal - an optional AbortSignal to abort the request
     * @returns the initial state and public context of the machine after initialization
     */
    create: async (
      machineName: MachineName,
      req: CreateMachineInstanceRequest,
      signal?: AbortSignal,
    ): Promise<EnhancedState> =>
      enhanceState(
        await adaptErrors<CreateMachineInstanceResponse>(
          await this.opts.fetch(
            `${this.opts.apiHost}/machines/${machineName}`,
            {
              method: "POST",
              headers: await this.headers,
              body: JSON.stringify(req),
              signal,
            },
          ),
        ),
      ),

    /**
     * Retrieve the machine instance's state and public context
     *
     * @param machineName - the name of the machine we are retrieving an instance of
     * @param machineInstanceName - the name of the machine instance we are retrieving
     * @param signal - an optional AbortSignal to abort the request
     * @returns the current state and public context of the machine
     */
    get: async (
      machineName: MachineName,
      machineInstanceName: MachineInstanceName,
      signal?: AbortSignal,
    ): Promise<EnhancedState> =>
      enhanceState(
        await adaptErrors<GetMachineInstanceResponse>(
          await this.opts.fetch(
            `${this.opts.apiHost}/machines/${machineName}/i/${machineInstanceName}`,
            {
              method: "GET",
              headers: await this.headers,
              signal,
            },
          ),
        ),
      ),

    /**
     * Returns an XState-compatible actor that represents the machine instance.
     *
     * The actor allows for subscriptions to state and sending events.
     *
     * @param machineName - the name of the machine we are creting an actor for
     * @param machineInstanceName - the name of the machine instance we are creating an actor for
     * @param opts - options for the actor
     * @param signal - an optional AbortSignal to abort the request
     * @returns - an XState-compatible actor
     */
    getActor: async <
      TEvent extends Exclude<Event, string>,
      TState extends StateValue = any,
      TContext extends Record<string, unknown> = any,
    >(
      machineName: MachineName,
      machineInstanceName: MachineInstanceName,
      signal?: AbortSignal,
    ): Promise<Actor<TEvent, TState, TContext>> => {
      const state = await this.machineInstances.get(
        machineName,
        machineInstanceName,
        signal,
      );
      return new Actor<TEvent, TState, TContext>(
        this,
        machineName,
        machineInstanceName,
        state,
        signal,
      );
    },

    /**
     * Returns an XState-compatible actor that represents the machine instance,
     * creating the instance if it does not exist.
     *
     * The actor allows for subscriptions to state and sending events.
     *
     * @param machineName - the name of the machine we are creting an actor for
     * @param machineInstanceName - the name of the machine instance we are creating an actor for
     * @param creationParams - parameters to use when creating the machine instance if it doesn't exist OR function returning those parameters if they are expensive to calculate
     * @param opts - options for the actor
     * @param signal - an optional AbortSignal to abort the request
     * @returns - an XState-compatible actor
     */
    getOrCreateActor: async <
      TEvent extends Exclude<Event, string>,
      TState extends StateValue = any,
      TContext extends Record<string, unknown> = any,
    >(
      machineName: MachineName,
      machineInstanceName: MachineInstanceName,
      creationParams:
        | Omit<CreateMachineInstanceRequest, "slug">
        | (() => Omit<CreateMachineInstanceRequest, "slug">),
      signal?: AbortSignal,
    ): Promise<Actor<TEvent, TState, TContext>> => {
      const state = await this.machineInstances.getOrCreate(
        machineName,
        machineInstanceName,
        creationParams,
        signal,
      );
      return new Actor<TEvent, TState, TContext>(
        this,
        machineName,
        machineInstanceName,
        state,
        signal,
      );
    },

    /**
     * Send an event to a machine instance.
     *
     * @param machineName - the name of the machine we are sending an event to
     * @param instanceName - the name of the machine instance we are sending an event to
     * @param req - event information
     * @param signal - an optional AbortSignal to abort the request
     * @returns the state and public context of the machine after processing the event
     */
    sendEvent: async (
      machineName: MachineName,
      instanceName: MachineInstanceName,
      req: SendEventRequest,
      signal?: AbortSignal,
    ): Promise<EnhancedState> =>
      enhanceState(
        await adaptErrors<SendEventResponse>(
          await this.opts.fetch(
            `${this.opts.apiHost}/machines/${machineName}/i/${instanceName}/events`,
            {
              method: "POST",
              headers: await this.headers,
              body: JSON.stringify(req),
              signal,
            },
          ),
        ),
      ),

    /**
     * Update the desired machine version for an existing instance.
     *
     * The instance will not be upgraded immediately but will be upgraded
     * the next time an event is sent to it from a settled state.
     *
     * @param machineName - the name of the machine we are updating the desired version for
     * @param instanceName - the name of the machine instance we are updating the desired version for
     * @param req - desired version information
     * @param signal - an optional AbortSignal to abort the request
     *
     * @throws errors.NoMigrationPathError if there is no path through the
     * set of existing migrations from the current instance version to
     * the desired instance version.
     */
    updateDesiredVersion: async (
      machineName: MachineName,
      instanceName: MachineInstanceName,
      req: UpdateDesiredMachineInstanceVersionRequest,
      signal?: AbortSignal,
    ): Promise<void> =>
      adaptErrors<void>(
        await this.opts.fetch(
          `${this.opts.apiHost}/machines/${machineName}/i/${instanceName}/v`,
          {
            method: "PUT",
            headers: await this.headers,
            body: JSON.stringify(req),
            signal,
          },
        ),
      ),

    /**
     * Convenience method to ensure that a machine instance exists.
     *
     * If the machine exists, it will read its state. Otherwise, it will create the machine and return its state.
     *
     * @param machineName - the name of the machine we are ensuring exists
     * @param instanceName - the name of the machine instance we are ensuring exists
     * @param creationParams - parameters to use when creating the machine instance if it doesn't exist OR function returning those parameters if they are expensive to calculate
     * @param signal - an optional AbortSignal to abort the request
     * @returns the current (or initial) state and public context of the machine
     */
    getOrCreate: async (
      machineName: MachineName,
      instanceName: MachineInstanceName,
      creationParams:
        | Omit<CreateMachineInstanceRequest, "slug">
        | (() => Omit<CreateMachineInstanceRequest, "slug">),
      signal?: AbortSignal,
    ): Promise<EnhancedState> => {
      try {
        return await this.machineInstances.get(
          machineName,
          instanceName,
          signal,
        );
      } catch (instanceGetError) {
        if (instanceGetError instanceof errors.NotFoundError) {
          // create the machine if it doesn't exist
          try {
            const creationReq: Omit<CreateMachineInstanceRequest, "slug"> =
              typeof creationParams === "function"
                ? creationParams()
                : creationParams;

            return await this.machineInstances.create(machineName, {
              ...creationReq,
              slug: instanceName,
            }, signal);
          } catch (instanceCreationError) {
            if (instanceCreationError instanceof errors.ConflictError) {
              // the machine was created by another request between our first read and our attempt to create, read it
              return this.machineInstances.get(
                machineName,
                instanceName,
                signal,
              );
            }

            throw instanceCreationError;
          }
        }

        throw instanceGetError;
      }
    },

    /**
     * Subscribe to state change notifications for an instance.
     *
     * `onStateUpdate` will be invoked right after the subscription is confirmed and
     * on (almost) every state update thereafter until unsubscribe is called.
     *
     * It is possible that clients may miss some state updates (e.g. due to transitions
     * happening during reconnects) so the only assumption client code should make is that
     * onStateUpdate is called with the latest known state.
     *
     * A web socket will be established and kept open whenever at least one subscriber
     * is active.
     *
     * In non-web environments, you may need to set the WebSocket implementation the client
     * uses by passing a WebSocket option in the constructor.
     *
     * @param machineName - the name of the machine we are subscribing to an instance of
     * @param machineInstanceName - the name of the instance we are subscribing to
     * @param onStateUpdate - function to invoke with each state update
     * @param onError - function to invoke if there is an error subscribing
     * @param signal - optional AbortSignal. If aborted, we will unsubscribe.
     * @returns an unsubscribe function to be called when the subscription should be canceled
     */
    subscribe: (
      machineName: MachineName,
      machineInstanceName: MachineInstanceName,
      onStateUpdate: (stateUpdate: GetMachineInstanceResponse) => void,
      onError?: (err: errors.ApiError) => void,
      signal?: AbortSignal,
    ): Unsubscribe => {
      let wsUnsubscribe: Unsubscribe | undefined;
      let cancelSubscription: Unsubscribe | undefined;
      let isUnsubscribed = false;
      const requestId = Math.random().toString(36).slice(2);

      (async () => {
        try {
          wsUnsubscribe = await this.ensureWebSocketEstablished((msg) => {
            switch (msg.type) {
              case "error": {
                if (msg.requestId !== requestId) {
                  return;
                }

                onError?.(
                  adaptError(
                    msg.status,
                    msg.code,
                    "instance subscription error",
                  ),
                );
                return;
              }
              case "instance-update": {
                if (
                  msg.machineName !== machineName ||
                  msg.machineInstanceName !== machineInstanceName
                ) {
                  return;
                }

                onStateUpdate(enhanceState({
                  state: msg.state,
                  publicContext: msg.publicContext,
                  done: msg.done,
                  tags: msg.tags,
                }));
                return;
              }
            }
          });

          if (isUnsubscribed) {
            wsUnsubscribe();
            return;
          }

          cancelSubscription = this.ws?.persistentSend({
            type: "subscribe-to-instance",
            machineName,
            machineInstanceName,
            requestId,
          });
        } catch (err) {
          onError?.(err);
        }
      })();

      const unsubscribe = () => {
        isUnsubscribed = true;
        signal?.removeEventListener("abort", unsubscribe);
        cancelSubscription?.();
        this.ws?.send({
          type: "unsubscribe-from-instance",
          machineName,
          machineInstanceName,
          requestId,
        });
        wsUnsubscribe?.();
      };

      signal?.addEventListener("abort", unsubscribe);

      return unsubscribe;
    },

    /**
     * The methods within machineInstances.dangerous are... **DANGEROUS**.
     *
     * They are intended to be used in development or in very exceptional circumstances
     * in production.
     *
     * These methods can cause data loss and are the only mechanisms through which you
     * can cause a machine instance to enter an invalid state.
     */
    dangerously: {
      /**
       * Pauses or resumes a machine instance.
       *
       * **PAUSE WITH CARE**
       *
       * Pausing a machine instance will cause it to reject all events until it is resumed,
       * including rejecting scheduled/delayed events. Scheduled events are only retried
       * 5 times (~30 seconds apart) before they are permanently dropped so it is possible
       * to invalidate the typical guarantees that your machine provides by pausing an instance.
       *
       * @param machineName - the name of the machine we are pausing/resuming an instance of
       * @param machineInstanceName - the name of the machine instance we are pausing/resuming
       * @param req - status information
       * @param signal - an optional AbortSignal to abort the request
       */
      setStatus: async (
        machineName: MachineName,
        machineInstanceName: MachineInstanceName,
        req: SetInstanceStatusRequest,
        signal?: AbortSignal,
      ): Promise<void> =>
        adaptErrors<void>(
          await this.opts.fetch(
            `${this.opts.apiHost}/machines/${machineName}/i/${machineInstanceName}/status`,
            {
              method: "PUT",
              headers: await this.headers,
              body: JSON.stringify(req),
              signal,
            },
          ),
        ),

      /**
       * Deletes a machine instance.
       *
       * **THIS WILL OBVIOUSLY CAUSE DATA LOSS**
       *
       * Deleted machine instances are not recoverable.
       *
       * All historical transitions, scheduled events, pending upgrades, and current state
       * will be irrevocably deleted.
       *
       * @param machineName - the name of the machine we are deleting an instance of
       * @param machineInstanceName - the name of the machine instance we are deleting
       * @param req - confirmation that you are permanently deleting data
       * @param signal - an optional AbortSignal to abort the request
       */
      delete: async (
        machineName: MachineName,
        machineInstanceName: MachineInstanceName,
        req: { dangerDataWillBeDeletedForever: true },
        signal?: AbortSignal,
      ): Promise<void> => {
        const hmac = await this.opts.hmacSha256(
          new TextEncoder().encode(machineName),
          new TextEncoder().encode(machineInstanceName),
        );

        const fullReq: DeleteMachineInstanceRequest = {
          ...req,
          hmacSha256OfMachineInstanceNameWithMachineNameKey: await this.opts
            .base64url(hmac),
        };

        await adaptErrors<void>(
          await this.opts.fetch(
            `${this.opts.apiHost}/machines/${machineName}/i/${machineInstanceName}`,
            {
              method: "DELETE",
              headers: await this.headers,
              body: JSON.stringify(fullReq),
              signal,
            },
          ),
        );
      },
    },
  };

  /**
   * Logs API.
   *
   * State Backed collects logs from transitions, actions, services, authorizers, and migrations.
   * Logs are currently available approximately 1 minute after they are generated and log
   * retention depends on your plan.
   */
  public readonly logs = {
    /**
     * Retrieve a batch of up to 100 log entries.
     * Each log entry may have multiple log lines in its `log` field.
     *
     * You may receive fewer than 100 log entries (or 0 entries) due to partitioning.
     *
     * Along with the log entries, you will receive a `maxTimestamp` field indicating
     * the timestamp to use as your `from` parameter in your next call if you want to
     * retrieve the next batch of logs.
     *
     * If the returned `maxTimestamp` matches your `from` parameter, you have retrieved
     * all of the logs that are currently available.
     *
     * You should then wait 30s and try again if you want to retrieve more logs.
     *
     * @param from - the timestamp to start retrieving logs from
     * @param filter - optional filter parameters to filter the logs returned
     * @param signal - an optional AbortSignal to abort the request
     * @returns `logs` and `maxTimestamp`
     */
    retrieve: async (
      from: Date,
      filter?: {
        machineName?: MachineName;
        instanceName?: MachineInstanceName;
        machineVersionId?: MachineVersionId;
        to?: Date;
      },
      signal?: AbortSignal,
    ): Promise<LogsResponse> => {
      const url = new URL(`${this.opts.apiHost}/logs`);
      url.searchParams.set("from", from.toISOString());
      if (filter?.machineName) {
        url.searchParams.set("machine", filter.machineName);
      }
      if (filter?.instanceName) {
        url.searchParams.set("instance", filter.instanceName);
      }
      if (filter?.machineVersionId) {
        url.searchParams.set("version", filter.machineVersionId);
      }
      if (filter?.to) {
        url.searchParams.set("to", filter.to.toISOString());
      }

      return adaptErrors<LogsResponse>(
        await this.opts.fetch(
          url,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      );
    },

    /**
     * Returns an async iterator that yields log entries as they are generated,
     * polling in a sensible way for new entries.
     *
     * @see retrieve for more information on the parameters.
     *
     * If no `filter.to` is provided, the iterator will never end because it will
     * continue to look for new logs.
     *
     * Example:
     *
     * ```
     * const logs = client.logs.watch(new Date());
     * for await (const log of logs) {
     *   // do something with log
     * }
     * ```
     *
     * @param from - the timestamp to start retrieving logs from
     * @param filter - optional filter parameters to filter the logs returned
     * @param signal - an optional AbortSignal to abort the iteration. If aborted, the iterator will end and no error will be thrown.
     * @returns An AsyncIterator that yields log entries as they are generated.
     */
    watch: (
      from: Date,
      filter?: {
        machineName?: MachineName;
        instanceName?: MachineInstanceName;
        machineVersionId?: MachineVersionId;
        to?: Date;
      },
      signal?: AbortSignal,
    ): AsyncIterable<LogEntry> => {
      // deno-lint-ignore no-this-alias
      const _this = this;

      const abortPromise = signal
        ? new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            resolve(undefined);
          });
        })
        : neverSettled();

      return {
        [Symbol.asyncIterator]() {
          let logBatch: Array<LogEntry> = [];

          return {
            next: async () => {
              if (signal?.aborted) {
                return { value: undefined, done: true };
              }

              if (logBatch.length === 0) {
                if (filter?.to && from >= filter.to) {
                  return { value: undefined, done: true };
                }

                try {
                  while (true) {
                    const prevFrom = from;
                    const nextBatch = await _this.logs.retrieve(
                      prevFrom,
                      filter,
                      signal,
                    );
                    from = new Date(nextBatch.maxTimestamp);
                    if (nextBatch.logs.length > 0) {
                      logBatch = nextBatch.logs;
                      break;
                    } else if (
                      nextBatch.maxTimestamp === prevFrom.toISOString()
                    ) {
                      // we have the latest logs. wait 30s and try again
                      await Promise.race([delayPromise(30_000), abortPromise]);
                      continue;
                    }
                  }
                } catch (err) {
                  if (err.name === "AbortError") {
                    return { value: undefined, done: true };
                  }

                  throw err;
                }
              }

              return { value: logBatch.shift()!, done: false };
            },
          };
        },
      };
    },
  };

  /**
   * Administrative APIs to manage identity providers.
   *
   * An identity provider is a configuration for validating and extracting claims from JWTs
   * created by a third-party identity provider (e.g. Auth0, Supabase, etc.).
   *
   * Those claims can then be used by token providers to generate State Backed tokens.
   *
   * This token exchange allows fully-secure, end-to-end authorized requests
   * directly from client code without needing any server and without having to change
   * identity providers.
   */
  public readonly identityProviders = {
    /**
     * Retrieve a page of identity providers.
     *
     * @param opts - options for the list operation
     * @param signal - an optional AbortSignal to abort the request
     * @returns - a page of identity providers
     */
    list: async (
      opts?: ListOptions,
      signal?: AbortSignal,
    ): Promise<ListIdentityProvidersResponse> => {
      const url = new URL(`${this.opts.apiHost}/idps`);
      if (opts?.cursor) {
        url.searchParams.set("cursor", opts.cursor);
      }

      return adaptErrors<ListIdentityProvidersResponse>(
        await this.opts.fetch(
          url,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      );
    },

    /**
     * Create or update an identity provider configuration.
     *
     * Token exchange involves exchanging an identity provider-signed token for a
     * State Backed-signed token. By adding an identity provider configuration to
     * State Backed, you are instructing State Backed to trust any valid token
     * from that identity provider when evaluating whether to allow a token exchange.
     * You are also extracting the claims from that token that you want to make available
     * to your token providers to include in the State Backed token.
     *
     * For example, if you are using Auth0 as your identity provider, you can configure
     * State Backed to trust your Auth0 tokens by calling:
     *
     * ```javascript
     * client.identityProviders.upsert({
     *   aud: "https://<your-auth0-domain>.us.auth0.com/api/v2/",
     *   iss: "https://<your-auth0-domain>.us.auth0.com/",
     *   jwksUrl: "https://<your-auth0-domain>.us.auth0.com/.well-known/jwks.json",
     *   algs: ["RS256"],
     *   mapping: {
     *    "sub.$": "$.sub",
     *    "email.$": "$.email",
     *    "provider": "auth0",
     *   },
     * })
     * ```
     *
     * State Backed uses the audience (`aud`) and issuer (`iss`) claims in any tokens
     * provided for exchange to identify the identity provider to use for verification.
     *
     * In this example, token providers would be have access to `sub`, `email`, and `provider`
     * claims that they could include in the resultant State Backed token.
     *
     * Upserts may change algorithms, mappings, keys or jwksUrls.
     *
     * This endpoint requires admin access.
     *
     * @param req - identity provider configuration. At least one of `aud` and `iss` must be provided and at least one of `keys` and `jwksUrl` must be provided.
     * @param signal - an optional AbortSignal to abort the request
     */
    upsert: async (
      req: UpsertIdentityProviderRequest,
      signal?: AbortSignal,
    ): Promise<void> =>
      adaptErrors<void>(
        await this.opts.fetch(
          `${this.opts.apiHost}/idps`,
          {
            method: "POST",
            headers: await this.headers,
            body: JSON.stringify(req),
            signal,
          },
        ),
      ),

    /**
     * Delete an identity provider configuration
     *
     * @param req - identity provider configuration. At least one of `aud` and `iss` must be provided.
     * @param signal - an optional AbortSignal to abort the request
     */
    delete: async (
      req: DeleteIdentityProviderRequest,
      signal?: AbortSignal,
    ): Promise<void> =>
      adaptErrors<void>(
        await this.opts.fetch(
          `${this.opts.apiHost}/idps`,
          {
            method: "DELETE",
            headers: await this.headers,
            body: JSON.stringify(req),
            signal,
          },
        ),
      ),
  };

  /**
   * Token exchange involves exchanging an identity provider-signed token for a
   * State Backed-signed token.
   *
   * Token providers are responsible for creating State Backed tokens from a standardized
   * claim set extracted from identity provider tokens by their mappings.
   *
   * Token providers are identified by a service name.
   * You might, for instance, want a service name for each application that you host
   * with State Backed.
   *
   * Token providers also specify the State Backed key to use to sign the tokens they
   * generate and a mapping that creates the claims for the generated token.
   *
   * For example, if your identity provider mappings extract claims like this:
   *
   * ```
   * {
   *   "sub": "your-sub",
   *   "email": "your-email",
   *   "provider": "identity-provider"
   * }
   * ```
   *
   * you could create a token provider like this:
   *
   * ```javascript
   * client.tokenProviders.upsert({
   *   "keyId": "sbk_...", // ID for a previously-created State Backed key
   *   "service": "your-app", // any identifier for your token provider
   *   "mapping": {
   *     "sub.$": "$.sub",
   *     "email.$": "$.email",
   *     "provider.$": "$.provider",
   *   }
   * })
   * ```
   *
   * That token provider would allow you to exchange any of your identity provider-
   * signed tokens for a State Backed token that includes the sub, email, and provider
   * claims, all of which would be available for your use in `allowRead` and `allowWrite`
   * functions in your machine definitions.
   *
   * Upserts may change key ids and mappings.
   */
  public readonly tokenProviders = {
    /**
     * Retrieve a page of token providers.
     *
     * @param opts - options for the list operation
     * @param signal - an optional AbortSignal to abort the request
     * @returns - a page of token providers
     */
    list: async (
      opts?: ListOptions,
      signal?: AbortSignal,
    ): Promise<ListTokenProvidersResponse> => {
      const url = new URL(`${this.opts.apiHost}/token-providers`);
      if (opts?.cursor) {
        url.searchParams.set("cursor", opts.cursor);
      }

      return adaptErrors<ListTokenProvidersResponse>(
        await this.opts.fetch(
          url,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      );
    },

    /**
     * Create or update a token provider configuration.
     *
     * The mapping is an object that defines the shape of the claims that will be included in
     * any State Backed tokens generated by this token provider. The mapping may refer
     * to claims extracted from the identity provider token by suffixing the key with ".$"
     * and using a JSON path to the claim in the identity provider token.
     *
     * For example:
     *
     * ```
     * {
     *    "sub.$": "$.sub",
     *    "service": "my-service",
     * }
     * ```
     *
     * would produce a sub claim with the value of the `sub` field on the extracted claims
     * and a service claim with the constant value "my-service".
     *
     * @param req - token provider configuration
     * @param signal - an optional AbortSignal to abort the request
     */
    upsert: async (
      req: UpsertTokenProviderRequest,
      signal?: AbortSignal,
    ): Promise<void> =>
      adaptErrors<void>(
        await this.opts.fetch(
          `${this.opts.apiHost}/token-providers`,
          {
            method: "POST",
            headers: await this.headers,
            body: JSON.stringify(req),
            signal,
          },
        ),
      ),

    /**
     * Delete the token provider configuration identified by its service name.
     *
     * @param service - the service name of the token provider to delete
     * @param signal - an optional AbortSignal to abort the request
     */
    delete: async (
      service: string,
      signal?: AbortSignal,
    ): Promise<void> =>
      adaptErrors<void>(
        await this.opts.fetch(
          `${this.opts.apiHost}/token-providers/${service}`,
          {
            method: "DELETE",
            headers: await this.headers,
            signal,
          },
        ),
      ),
  };

  public readonly tokens = {
    exchange: async (
      req: TokenExchangeRequest,
      signal?: AbortSignal,
    ): Promise<string> =>
      (await adaptErrors<TokenExchangeResponse>(
        await this.opts.fetch(
          `${this.opts.apiHost}/tokens`,
          {
            method: "POST",
            headers: {
              ...this.nonAuthJSONHeaders,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
              audience:
                `https://tokens.statebacked.dev/${req.orgId}/${req.service}`,
              requested_token_type:
                "urn:ietf:params:oauth:token-type:access_token",
              subject_token: req.token,
            }).toString(),
            signal,
          },
        ),
      )).access_token,
  };

  public readonly billing = {
    get: async (
      signal?: AbortSignal,
    ): Promise<GetBillingResponse> =>
      adaptErrors<GetBillingResponse>(
        await this.opts.fetch(
          `${this.opts.apiHost}/billing`,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      ),
  };

  public readonly orgs = {
    list: async (
      opts?: ListOptions,
      signal?: AbortSignal,
    ): Promise<ListOrgsResponse> => {
      const url = new URL(`${this.opts.apiHost}/orgs`);
      if (opts?.cursor) {
        url.searchParams.set("cursor", opts.cursor);
      }

      return adaptErrors<ListOrgsResponse>(
        await this.opts.fetch(
          url,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      );
    },
  };

  public readonly keys = {
    list: async (
      opts?: ListOptions,
      signal?: AbortSignal,
    ): Promise<ListKeysResponse> => {
      const url = new URL(`${this.opts.apiHost}/keys`);
      if (opts?.cursor) {
        url.searchParams.set("cursor", opts.cursor);
      }

      return adaptErrors<ListKeysResponse>(
        await this.opts.fetch(
          url,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      );
    },
  };
}

function delayPromise(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type WSToServerMsg = api.components["schemas"]["WSToServerMsg"];
export type WSToClientMsg = api.components["schemas"]["WSToClientMsg"];

export type UpdateDesiredMachineInstanceVersionRequest = NonNullable<
  api.paths["/machines/{machineSlug}/i/{instanceSlug}/v"]["put"]["requestBody"]
>["content"]["application/json"];

export type ProvisionallyCreateMachineVersionMigrationRequest = NonNullable<
  api.paths["/machines/{machineSlug}/migrations"]["post"]["requestBody"]
>["content"]["application/json"];
export type ProvisionallyCreateMachineVersionMigrationResponse = NonNullable<
  api.paths["/machines/{machineSlug}/migrations"]["post"]["responses"]["200"]
>["content"]["application/json"];

export type FinalizeMachineVersionMigrationResponse = NonNullable<
  api.paths[
    "/machines/{machineSlug}/migrations/{signedMachineVersionMigrationId}"
  ]["put"]["responses"]["200"]
>["content"]["application/json"];

export type GetBillingResponse = NonNullable<
  api.paths["/billing"]["get"]["responses"]["200"]
>["content"]["application/json"];

/**
 * Options for list operations
 */
export type ListOptions = {
  /**
   * The cursor to use to retrieve the next page of results.
   */
  cursor?: string;
};

export type ListOrgsResponse = NonNullable<
  api.paths["/orgs"]["get"]["responses"]["200"]
>["content"]["application/json"];

export type ListKeysResponse = NonNullable<
  api.paths["/keys"]["get"]["responses"]["200"]
>["content"]["application/json"];

export type ListMachinesResponse = NonNullable<
  api.paths["/machines"]["get"]["responses"]["200"]
>["content"]["application/json"];

export type ListMachineVersionsResponse = NonNullable<
  api.paths["/machines/{machineSlug}/v"]["get"]["responses"]["200"]
>["content"]["application/json"];

export type ListMachineInstancesResponse = NonNullable<
  api.paths["/machines/{machineSlug}/i"]["get"]["responses"]["200"]
>["content"]["application/json"];

export type ListMachineInstanceTransitionsResponse = NonNullable<
  api.paths["/machines/{machineSlug}/i/{instanceSlug}/events"]["get"][
    "responses"
  ]["200"]
>["content"]["application/json"];

export type ListIdentityProvidersResponse = NonNullable<
  api.paths["/idps"]["get"]["responses"]["200"]
>["content"]["application/json"];

export type ListTokenProvidersResponse = NonNullable<
  api.paths["/token-providers"]["get"]["responses"]["200"]
>["content"]["application/json"];

export type CreateMachineRequest = NonNullable<
  api.paths["/machines"]["post"]["requestBody"]
>["content"]["application/json"];
export type ProvisionallyCreateVersionRequest = NonNullable<
  api.paths["/machines/{machineSlug}/v"]["post"]["requestBody"]
>["content"]["application/json"];
export type FinalizeVersionRequest = NonNullable<
  api.paths["/machines/{machineSlug}/v/{signedMachineVersionId}"]["put"][
    "requestBody"
  ]
>["content"]["application/json"];
export type CreateMachineInstanceRequest = NonNullable<
  api.paths["/machines/{machineSlug}"]["post"]["requestBody"]
>["content"]["application/json"];
export type SendEventRequest = NonNullable<
  api.paths["/machines/{machineSlug}/i/{instanceSlug}/events"]["post"][
    "requestBody"
  ]
>["content"]["application/json"];

export type ProvisionallyCreateVersionResponse = NonNullable<
  api.paths["/machines/{machineSlug}/v"]["post"]["responses"]["200"]
>["content"]["application/json"];
export type FinalizeVersionResponse = NonNullable<
  api.paths["/machines/{machineSlug}/v/{signedMachineVersionId}"]["put"][
    "responses"
  ]["200"]
>["content"]["application/json"];
export type CreateMachineInstanceResponse = NonNullable<
  api.paths["/machines/{machineSlug}"]["post"]["responses"]["200"]
>["content"]["application/json"];
export type SendEventResponse = NonNullable<
  api.paths["/machines/{machineSlug}/i/{instanceSlug}/events"]["post"][
    "responses"
  ]["200"]
>["content"]["application/json"];
export type GetMachineInstanceResponse = NonNullable<
  api.paths["/machines/{machineSlug}/i/{instanceSlug}"]["get"]["responses"][
    "200"
  ]
>["content"]["application/json"];

export type SetInstanceStatusRequest = NonNullable<
  api.paths["/machines/{machineSlug}/i/{instanceSlug}/status"]["put"][
    "requestBody"
  ]
>["content"]["application/json"];

export type DeleteMachineInstanceRequest = NonNullable<
  api.paths["/machines/{machineSlug}/i/{instanceSlug}"]["delete"][
    "requestBody"
  ]
>["content"]["application/json"];

export type DeleteMachineRequest = NonNullable<
  api.paths["/machines/{machineSlug}"]["delete"]["requestBody"]
>["content"]["application/json"];

export type LogsResponse = NonNullable<
  api.paths["/logs"]["get"]["responses"]["200"]
>["content"]["application/json"];

export type LogEntry = LogsResponse["logs"][number];

export type UpsertIdentityProviderRequest = NonNullable<
  api.paths["/idps"]["post"]["requestBody"]
>["content"]["application/json"];

export type DeleteIdentityProviderRequest = NonNullable<
  api.paths["/idps"]["delete"]["requestBody"]
>["content"]["application/json"];

export type UpsertTokenProviderRequest = NonNullable<
  api.paths["/token-providers"]["post"]["requestBody"]
>["content"]["application/json"];

export type TokenExchangeRequest = {
  orgId: string;
  service: string;
  token: string;
};

type TokenExchangeResponse = NonNullable<
  api.paths["/tokens"]["post"]["responses"]["200"]
>["content"]["application/json"];

export type MachineName = api.components["schemas"]["MachineSlug"];
export type MachineInstanceName =
  api.components["schemas"]["MachineInstanceSlug"];
export type SignedMachineVersionId =
  api.components["schemas"]["SignedMachineVersionId"];
export type MachineVersionId = api.components["schemas"]["MachineVersionId"];
export type Event = api.components["schemas"]["Event"];
export type EventWithPayload = api.components["schemas"]["EventWithPayload"];
export type EventWithoutPayload =
  api.components["schemas"]["EventWithoutPayload"];
export type State = api.components["schemas"]["State"];
export type StateValue = api.components["schemas"]["StateValue"];

export type Unsubscribe = () => void;

async function adaptErrors<T>(res: FetchResponseType): Promise<T> {
  if (res.ok) {
    return [201, 204].indexOf(res.status) >= 0 ? void 0 as T : res.json() as T;
  }

  let errorCode: string | undefined;
  let errorMessage = "error processing request";
  try {
    const body = await res.json() as { code?: string; error?: string };
    errorCode = body.code;
    errorMessage = body.error ?? errorMessage;
  } catch (e) {
    // swallow
  }

  throw adaptError(res.status, errorCode, errorMessage);
}

function adaptError(
  status: number,
  errorCode: string | undefined,
  errorMessage: string,
) {
  switch (status) {
    case 400:
      switch (errorCode) {
        case errors.OrgHeaderRequiredError.code:
          return new errors.OrgHeaderRequiredError(errorMessage);
        case errors.NoMigrationPathError.code:
          return new errors.NoMigrationPathError(errorMessage);
      }
      return new errors.ClientError(errorMessage, errorCode);
    case 403:
      switch (errorCode) {
        case errors.MissingOrgError.code:
          return new errors.MissingOrgError(errorMessage);
        case errors.MissingScopeError.code:
          return new errors.MissingScopeError(errorMessage);
        case errors.MissingUserError.code:
          return new errors.MissingUserError(errorMessage);
        case errors.RejectedByMachineAuthorizerError.code:
          return new errors.RejectedByMachineAuthorizerError(errorMessage);
      }
      return new errors.UnauthorizedError(errorMessage, errorCode);
    case 404:
      return new errors.NotFoundError(errorMessage, errorCode);
    case 409:
      return new errors.ConflictError(errorMessage, errorCode);
  }

  return new errors.ApiError(errorMessage, status, errorCode);
}

/**
 * Code to upload to State Backed.
 *
 * Either a string of JavaScript code or a gzipped Uint8Array of JavaScript code.
 */
export type CodeReq = { code: string } | { gzippedCode: Uint8Array };

function uploadCode(
  deps: Required<Pick<ClientOpts, "Blob" | "FormData" | "fetch">>,
  codeUploadUrl: string,
  codeUploadFields: Record<string, any>,
  req: { fileName: string } & CodeReq,
  signal?: AbortSignal,
) {
  const uploadForm = new deps.FormData();
  for (const [key, value] of Object.entries(codeUploadFields)) {
    uploadForm.append(key, value as string);
  }

  uploadForm.set("content-type", "application/javascript");
  if ("gzippedCode" in req) {
    uploadForm.set("content-encoding", "gzip");
  }

  uploadForm.append(
    "file",
    new deps.Blob(["gzippedCode" in req ? req.gzippedCode : req.code], {
      type: "application/javascript",
    }),
    req.fileName,
  );

  return deps.fetch(codeUploadUrl, {
    method: "POST",
    body: uploadForm,
    signal,
  });
}

const neverSettled = (() => {
  let p: Promise<never> | undefined;

  return () => {
    if (!p) {
      p = new Promise<never>(() => {});
    }
    return p;
  };
})();

interface Observer<T> {
  next: (value: T) => void;
  error?: (err: any) => void;
  complete?: () => void;
}

declare global {
  interface SymbolConstructor {
    readonly observable: symbol;
  }
}

const symbolObservable: typeof Symbol.observable =
  (() =>
    (typeof Symbol === "function" && Symbol.observable) ||
    "@@observable")() as any;

/**
 * An "actor" is a client-side representation of a machine instance.
 *
 * This is intended to closely mimic the notion of an XState actor and should
 * be compatible with any XState utilities that accept actors.
 */
export class Actor<
  TEvent extends Exclude<Event, string> = any,
  TState extends StateValue = any,
  TContext extends Record<string, unknown> = any,
> {
  private state: ActorState<TState, TContext>;
  private subscribers: Array<Observer<ActorState<TState, TContext>>> = [];
  private unsubscribe: Unsubscribe | undefined;

  /**
   * The actor's id ("machineName/instanceName")
   */
  public readonly id: string;

  constructor(
    private client: StateBackedClient,
    private machineName: string,
    private instanceName: string,
    state: GetMachineInstanceResponse,
    private signal?: AbortSignal,
  ) {
    this.id = `${machineName}/${instanceName}`;
    this.state = new ActorState(state);
  }

  private setState(state: ActorState<TState, TContext>) {
    this.state = state;
    for (const sub of this.subscribers) {
      sub.next(state);
    }
  }

  private reportError(err: Error) {
    for (const sub of this.subscribers) {
      sub.error?.(err);
    }
  }

  private _subscribeToRemoteState() {
    if (this.unsubscribe) {
      return;
    }

    const unsub = this.client.machineInstances.subscribe(
      this.machineName,
      this.instanceName,
      (event) => {
        this.setState(new ActorState(event));
      },
      (err) => {
        this.reportError(err);
      },
      this.signal,
    );

    this.unsubscribe = () => {
      unsub();
      this.unsubscribe = undefined;
    };
  }

  /**
   * Subscribe to the actor's state. This will call the callback with
   * the current state and any time the state changes.
   *
   * @param cb - function to call for each state update
   * @returns - a function to unsubscribe from state updates
   */
  public subscribe(
    next: (value: ActorState<TState, TContext>) => void,
    error?: (error: any) => void,
    complete?: () => void,
  ): Subscription;
  public subscribe(
    observer: Observer<ActorState<TState, TContext>>,
  ): Subscription;
  public subscribe(
    nextOrObserver:
      | Observer<ActorState<TState, TContext>>
      | ((value: ActorState<TState, TContext>) => void),
    error?: (error: any) => void,
    complete?: () => void,
  ): Subscription {
    const observer = typeof nextOrObserver === "function"
      ? {
        next: nextOrObserver,
        error,
        complete,
      }
      : nextOrObserver;

    this.subscribers.push(observer);
    if (!this.unsubscribe) {
      this._subscribeToRemoteState();
    }

    return {
      unsubscribe: () => {
        this.subscribers = this.subscribers.filter((sub) => sub !== observer);
        if (this.subscribers.length === 0) {
          this.unsubscribe?.();
        }
      },
    };
  }

  /**
   * Send an event to the actor.
   *
   * @param event - the event to send
   */
  public send(event: TEvent | ExtractType<TEvent> | TEvent["type"]) {
    this.client.machineInstances.sendEvent(
      this.machineName,
      this.instanceName,
      { event },
      this.signal,
    ).catch((err) => {
      this.reportError(err);
    });
  }

  /**
   * Get the current state.
   *
   * @returns the current state of the instance.
   */
  public getSnapshot() {
    return this.state;
  }

  public [symbolObservable]() {
    return this;
  }
}

type ExtractType<T> = T extends { type: infer U } ? U : never;

export interface Subscription {
  unsubscribe(): void;
}

/**
 * The state of an actor.
 *
 * This is intended to closely mimic an XState State object.
 *
 * There are some differences:
 *  - events are not considered public so we remove _event, event, and events
 *  - we do not yet have any concept of next events so we remove nextEvents and can
 *  - actions, activities, and children are removed
 *  - we do not include history in the public interface
 *  - meta is considered private for now, so we do not include it
 *  - the only top-level key of context is public and it includes only the publicContext
 *  - we do not support changed
 */
export class ActorState<
  TState extends StateValue = any,
  TPublicContext extends Record<string, unknown> = any,
> {
  /**
   * The context of the instance.
   *
   * The only key is public and it includes only the publicContext.
   */
  public context: { public: TPublicContext };

  /**
   * Has the instance reached a final state?
   */
  public done: boolean;

  /**
   * The tags of the current states of the instance.
   */
  public tags: Set<string>;

  /**
   * The current state value of the instance.
   */
  public value: TState;

  constructor(private machineState: GetMachineInstanceResponse) {
    this.value = machineState.state as TState;
    this.context = {
      public: machineState.publicContext as TPublicContext,
    };

    this.done = machineState.done;

    this.tags = new Set(machineState.tags);
  }

  /**
   * Does the current state include the provided tag?
   */
  public hasTag(tag: string) {
    return this.tags.has(tag);
  }

  /**
   * Get the current state value as an array of strings.
   */
  public toStrings(): Array<string> {
    return toStrings(this.value);
  }

  /**
   * Does the current state value match the provided state descriptor?
   *
   * If the current state is { a: { b: "c" } }, the following all "match":
   *  - "a"
   *  - "a.b"
   *  - "a.b.c"
   *  - ["a"]
   *  - ["a", "b"]
   *  - ["a", "b", "c"]
   *  - { a: "b" }
   *  - { a: { b: "c" } }
   */
  public matches(state: AnyStateDescriptorFrom<TState>) {
    return matchesState(state, this.value);
  }
}

// from https://github.com/statelyai/xstate/blob/main/packages/core/src/utils.ts

/**
 * Returns whether the childStateId is a substate of the parentStateId.
 * If the current state is { a: { b: "c" } }, the following all "match":
 *  - "a"
 *  - "a.b"
 *  - "a.b.c"
 *  - ["a"]
 *  - ["a", "b"]
 *  - ["a", "b", "c"]
 *  - { a: "b" }
 *  - { a: { b: "c" } }
 *
 * @param parentStateId - object, array of strings, or string representing the parent state id
 * @param childStateId - object, or string representing the child state id
 */
export function matchesState(
  parentStateId: StateValue | Array<string> | undefined,
  childStateId: StateValue | undefined,
): boolean {
  if (typeof parentStateId === "undefined") {
    return typeof childStateId === "undefined";
  }

  if (typeof childStateId === "undefined") {
    return true;
  }

  const parentStateValue = toStateValue(parentStateId);
  const childStateValue = toStateValue(childStateId);

  if (isString(childStateValue)) {
    if (isString(parentStateValue)) {
      return childStateValue === parentStateValue;
    }

    // Parent more specific than child
    return false;
  }

  if (isString(parentStateValue)) {
    return parentStateValue in childStateValue;
  }

  return Object.keys(parentStateValue).every((key) => {
    if (!(key in childStateValue)) {
      return false;
    }

    return matchesState(parentStateValue[key], childStateValue[key]);
  });
}

function isString(value: any): value is string {
  return typeof value === "string";
}

// from https://github.com/statelyai/xstate/blob/main/packages/core/src/utils.ts
function toStateValue(
  stateValue: StateValue | string[],
): StateValue {
  if (Array.isArray(stateValue)) {
    return pathToStateValue(stateValue);
  }

  if (typeof stateValue !== "string") {
    return stateValue as StateValue;
  }

  const statePath = stateValue.split(".");

  return pathToStateValue(statePath);
}

// from https://github.com/statelyai/xstate/blob/main/packages/core/src/utils.ts
function pathToStateValue(statePath: string[]): StateValue {
  if (statePath.length === 1) {
    return statePath[0];
  }

  const value: StateValue & {} = {};
  let marker = value;

  for (let i = 0; i < statePath.length - 1; i++) {
    if (i === statePath.length - 2) {
      marker[statePath[i]] = statePath[i + 1];
    } else {
      marker[statePath[i]] = {};
      marker = marker[statePath[i]] as any;
    }
  }

  return value;
}

/**
 * Takes a state shape (e.g. { a: "b"}) and adds all state paths to it
 * e.g. {a: "b"} | "a" | "a.b"
 *
 * Useful for generating a type that accepts any state descriptor for a given state
 */
type AnyStateDescriptorFrom<TState extends StateValue> = TState | Paths<TState>;

/**
 * Generates a type that accepts any path through the provided object type.
 */
type Paths<T> = T extends string ? T : {
  [K in keyof T]: K extends string ? K | `${K}.${Paths<T[K]>}`
    : never;
}[keyof T];
