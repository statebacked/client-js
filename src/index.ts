import * as errors from "./errors.ts";
import * as api from "./gen-api.ts";

export { errors };

export type ClientOpts = {
  basePath?: string;
  orgId?: string;
};

export class StateBackedClient {
  private readonly opts: ClientOpts;

  constructor(private readonly token: string, opts: ClientOpts) {
    this.opts = {
      basePath: opts.basePath ?? "https://api.statebacked.dev",
      orgId: opts.orgId,
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
          `${this.opts.basePath}/machines`,
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
      adaptErrors(
        await fetch(
          `${this.opts.basePath}/machines/${machineName}/v`,
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
      adaptErrors(
        await fetch(
          `${this.opts.basePath}/machines/${machineName}/v/${signedMachineVersionId}`,
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

  public readonly instances = {
    create: async (
      machineName: MachineName,
      req: CreateMachineInstanceRequest,
      signal?: AbortSignal,
    ): Promise<CreateMachineInstanceResponse> =>
      adaptErrors(
        await fetch(
          `${this.opts.basePath}/machines/${machineName}`,
          {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(req),
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
      adaptErrors(
        await fetch(
          `${this.opts.basePath}/machines/${machineName}/i/${instanceName}/events`,
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

async function adaptErrors(res: Response) {
  if (res.ok) {
    return res.json();
  }

  let errorCode: string | undefined;
  let errorMessage = "error processing request";
  try {
    const body = await res.json();
    errorCode = body.code;
    errorMessage = body.error;
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
