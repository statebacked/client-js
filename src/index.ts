import * as errors from "./errors.ts";
import * as api from "./gen-api.ts";

export { errors };

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
};

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
  private readonly opts: ClientOpts;
  private readonly token: Promise<string>;

  constructor(
    /**
     * JWT generated using @statebacked/token and signed with an API key from `smply keys create`.
     * Or a function returning a promise for that token.
     */
    token: string | (() => Promise<string>),
    /**
     * Options for the client.
     */
    opts?: ClientOpts,
  ) {
    this.token = typeof token === "string"
      ? Promise.resolve(token)
      : token().catch((err) => {
        throw new errors.UnauthorizedError(
          "failed to retrieve token",
          undefined,
          err,
        );
      });
    this.opts = {
      apiHost: opts?.apiHost ?? "https://api.statebacked.dev",
      orgId: opts?.orgId,
    };
  }

  private get headers() {
    return this.token.then((token) => ({
      "content-type": "application/json",
      "authorization": `Bearer ${token}`,
      ...(this.opts.orgId ? { "x-statebacked-org-id": this.opts.orgId } : {}),
    }));
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
        await fetch(
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
        await fetch(
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
        await fetch(
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
        await fetch(
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
        await fetch(
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
    ): Promise<CreateMachineInstanceResponse> =>
      adaptErrors<CreateMachineInstanceResponse>(
        await fetch(
          `${this.opts.apiHost}/machines/${machineName}`,
          {
            method: "POST",
            headers: await this.headers,
            body: JSON.stringify(req),
            signal,
          },
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
    ): Promise<GetMachineInstanceResponse> =>
      adaptErrors<GetMachineInstanceResponse>(
        await fetch(
          `${this.opts.apiHost}/machines/${machineName}/i/${machineInstanceName}`,
          {
            method: "GET",
            headers: await this.headers,
            signal,
          },
        ),
      ),

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
    ): Promise<SendEventResponse> =>
      adaptErrors<SendEventResponse>(
        await fetch(
          `${this.opts.apiHost}/machines/${machineName}/i/${instanceName}/events`,
          {
            method: "POST",
            headers: await this.headers,
            body: JSON.stringify(req),
            signal,
          },
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
        await fetch(
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
    ): Promise<GetMachineInstanceResponse> => {
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
        await fetch(
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
                      await new Promise((resolve) =>
                        setTimeout(resolve, 30_000)
                      );
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
}

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

export type LogsResponse = NonNullable<
  api.paths["/logs"]["get"]["responses"]["200"]
>["content"]["application/json"];

export type LogEntry = LogsResponse["logs"][number];

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

async function adaptErrors<T>(res: Response): Promise<T> {
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

  switch (res.status) {
    case 400:
      switch (errorCode) {
        case errors.OrgHeaderRequiredError.code:
          throw new errors.OrgHeaderRequiredError(errorMessage);
        case errors.NoMigrationPathError.code:
          throw new errors.NoMigrationPathError(errorMessage);
      }
      throw new errors.ClientError(errorMessage, errorCode);
    case 403:
      switch (errorCode) {
        case errors.MissingOrgError.code:
          throw new errors.MissingOrgError(errorMessage);
        case errors.MissingScopeError.code:
          throw new errors.MissingScopeError(errorMessage);
        case errors.MissingUserError.code:
          throw new errors.MissingUserError(errorMessage);
        case errors.RejectedByMachineAuthorizerError.code:
          throw new errors.RejectedByMachineAuthorizerError(errorMessage);
      }
      throw new errors.UnauthorizedError(errorMessage, errorCode);
    case 404:
      throw new errors.NotFoundError(errorMessage, errorCode);
    case 409:
      throw new errors.ConflictError(errorMessage, errorCode);
  }

  throw new errors.ApiError(errorMessage, res.status, errorCode);
}

/**
 * Code to upload to State Backed.
 *
 * Either a string of JavaScript code or a gzipped Uint8Array of JavaScript code.
 */
export type CodeReq = { code: string } | { gzippedCode: Uint8Array };

function uploadCode(
  codeUploadUrl: string,
  codeUploadFields: Record<string, any>,
  req: { fileName: string } & CodeReq,
  signal?: AbortSignal,
) {
  const uploadForm = new FormData();
  for (const [key, value] of Object.entries(codeUploadFields)) {
    uploadForm.append(key, value as string);
  }

  uploadForm.set("content-type", "application/javascript");
  if ("gzippedCode" in req) {
    uploadForm.set("content-encoding", "gzip");
  }

  uploadForm.append(
    "file",
    new Blob(["gzippedCode" in req ? req.gzippedCode : req.code], {
      type: "application/javascript",
    }),
    req.fileName,
  );

  return fetch(codeUploadUrl, {
    method: "POST",
    body: uploadForm,
    signal,
  });
}
