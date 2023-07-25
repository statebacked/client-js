import * as errors from "./errors.ts";
import * as api from "./gen-api.ts";

export { errors };

export type ClientOpts = {
  apiHost?: string;
  orgId?: string;
};

export class StateBackedClient {
  private readonly opts: ClientOpts;

  constructor(private readonly token: string, opts?: ClientOpts) {
    this.opts = {
      apiHost: opts?.apiHost ?? "https://api.statebacked.dev",
      orgId: opts?.orgId,
    };
  }

  private get headers() {
    return {
      "content-type": "application/json",
      "authorization": `Bearer ${this.token}`,
      ...(this.opts.orgId ? { "x-statebacked-org-id": this.opts.orgId } : {}),
    };
  }

  public readonly machines = {
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
            headers: this.headers,
            body: JSON.stringify(req),
            signal,
          },
        ),
      );
    },
  };

  public readonly machineVersions = {
    provisionallyCreate: async (
      machineName: MachineName,
      signal?: AbortSignal,
    ): Promise<ProvisionallyCreateVersionResponse> =>
      adaptErrors<ProvisionallyCreateVersionResponse>(
        await fetch(
          `${this.opts.apiHost}/machines/${machineName}/v`,
          {
            method: "POST",
            headers: this.headers,
            signal,
          },
        ),
      ),

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
            headers: this.headers,
            body: JSON.stringify(req),
            signal,
          },
        ),
      ),

    createVersion: async (
      machineName: MachineName,
      req: NonNullable<FinalizeVersionRequest> & { code: string },
      signal?: AbortSignal,
    ): Promise<FinalizeVersionResponse> => {
      const provisionalCreationRes = await this.machineVersions
        .provisionallyCreate(machineName, signal);
      const {
        codeUploadFields,
        codeUploadUrl,
        machineVersionId: signedMachineVersionId,
      } = provisionalCreationRes;

      const uploadForm = new FormData();
      for (const [key, value] of Object.entries(codeUploadFields)) {
        uploadForm.append(key, value as string);
      }
      uploadForm.set("content-type", "application/javascript");
      uploadForm.append(
        "file",
        new Blob([req.code], {
          type: "application/javascript",
        }),
        `${machineName}.js`,
      );

      await fetch(codeUploadUrl, {
        method: "POST",
        body: uploadForm,
        signal,
      });

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

  public readonly machineVersionMigrations = {
    provisionallyCreate: async (
      machineName: MachineName,
      req: ProvisionallyCreateMachineVersionMigrationRequest,
      signal?: AbortSignal,
    ): Promise<ProvisionallyCreateMachineVersionMigrationResponse> =>
      adaptErrors<ProvisionallyCreateMachineVersionMigrationResponse>(
        await fetch(
          `${this.opts.apiHost}/machines/${machineName}/migrations`,
          {
            method: "POST",
            headers: this.headers,
            signal,
            body: JSON.stringify(req),
          },
        ),
      ),

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
            headers: this.headers,
            signal,
          },
        ),
      ),

    createVersionMigration: async (
      machineName: MachineName,
      req: NonNullable<ProvisionallyCreateMachineVersionMigrationRequest> & {
        code: string;
      },
      signal?: AbortSignal,
    ): Promise<FinalizeMachineVersionMigrationResponse> => {
      const provisionalCreationRes = await this.machineVersionMigrations
        .provisionallyCreate(machineName, req, signal);
      const {
        codeUploadFields,
        codeUploadUrl,
        machineVersionMigrationId: signedMachineVersionMigrationId,
      } = provisionalCreationRes;

      const uploadForm = new FormData();
      for (const [key, value] of Object.entries(codeUploadFields)) {
        uploadForm.append(key, value as string);
      }
      uploadForm.set("content-type", "application/javascript");
      uploadForm.append(
        "file",
        new Blob([req.code], {
          type: "application/javascript",
        }),
        `${machineName}_${req.fromMachineVersionId}_to_${req.toMachineVersionId}.js`,
      );

      await fetch(codeUploadUrl, {
        method: "POST",
        body: uploadForm,
        signal,
      });

      return this.machineVersionMigrations.finalize(
        machineName,
        signedMachineVersionMigrationId,
        signal,
      );
    },
  };

  public readonly machineInstances = {
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
            headers: this.headers,
            body: JSON.stringify(req),
            signal,
          },
        ),
      ),

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
            headers: this.headers,
            signal,
          },
        ),
      ),

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
            headers: this.headers,
            body: JSON.stringify(req),
            signal,
          },
        ),
      ),
  };
}

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
    return res.json() as T;
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
      if (errorCode === errors.OrgHeaderRequiredError.code) {
        throw new errors.OrgHeaderRequiredError(errorMessage);
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
