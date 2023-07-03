import * as svc from "../gen";
import * as errors from "./errors";

export { errors };

svc.OpenAPI.CREDENTIALS = "include";
svc.OpenAPI.WITH_CREDENTIALS = true;

export const config = (token: string) => {
  svc.OpenAPI.TOKEN = token;
};

export const machines = {
  create: (machineName: string, signal?: AbortSignal): Promise<void> =>
    withStructuredErrors(
      withAbort(
        svc.MachinesService.postMachines({
          requestBody: {
            slug: machineName,
          },
        }),
        signal
      )
    ),
};

export const machineVersions = {
  provisionallyCreateVersion: (
    machineName: MachineSlug,
    signal?: AbortSignal
  ): Promise<ProvisionallyCreateVersionResponse> =>
    withStructuredErrors(
      withAbort(
        svc.MachineVersionsService.postMachinesV({
          machineSlug: machineName,
          requestBody: {},
        }),
        signal
      )
    ),

  finalizeVersion: (
    machineName: MachineSlug,
    signedMachineVersionId: SignedMachineVersionId,
    req: FinalizeVersionRequest,
    signal?: AbortSignal
  ): Promise<FinalizeVersionResponse> =>
    withStructuredErrors(
      withAbort(
        svc.MachineVersionsService.putMachinesV({
          machineSlug: machineName,
          signedMachineVersionId,
          requestBody: req,
        }),
        signal
      )
    ),

  createVersion: async (
    machineName: MachineSlug,
    req: NonNullable<FinalizeVersionRequest> & { code: string },
    signal?: AbortSignal
  ): Promise<FinalizeVersionResponse> => {
    const provisionalCreationRes =
      await machineVersions.provisionallyCreateVersion(machineName, signal);
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
      `${machineName}.js`
    );

    await fetch(codeUploadUrl, {
      method: "POST",
      body: uploadForm,
      signal,
    });

    return machineVersions.finalizeVersion(
      machineName,
      signedMachineVersionId,
      {
        clientInfo: req.clientInfo,
        makeCurrent: req.makeCurrent,
      },
      signal
    );
  },
};

export const machineInstances = {
  create: (
    machineName: MachineSlug,
    instanceName: MachineInstanceSlug,
    req: CreateMachineInstanceRequest,
    signal?: AbortSignal
  ): Promise<State> =>
    withStructuredErrors(
      withAbort(
        svc.MachineInstancesService.postMachines({
          machineSlug: machineName,
          requestBody: {
            slug: instanceName,
            context: req?.context,
            machineVersionId: req?.machineVersionId,
          },
        }),
        signal
      )
    ),

  sendEvent: (
    machineName: MachineSlug,
    instanceName: MachineInstanceSlug,
    req: NonNullable<SendEventRequest>,
    signal?: AbortSignal
  ): Promise<State> =>
    withStructuredErrors(
      withAbort(
        svc.MachineInstancesService.postMachinesIEvents({
          machineSlug: machineName,
          instanceSlug: instanceName,
          requestBody: {
            event: req.event,
          },
        }),
        signal
      )
    ),
};

export type FinalizeVersionRequest = Parameters<
  typeof svc.MachineVersionsService.putMachinesV
>[0]["requestBody"];
export type CreateMachineInstanceRequest = Parameters<
  typeof svc.MachineInstancesService.postMachines
>[0]["requestBody"];
export type SendEventRequest = Parameters<
  typeof svc.MachineInstancesService.postMachinesIEvents
>[0]["requestBody"];

export type State = svc.State;
export type ProvisionallyCreateVersionResponse = Awaited<
  ReturnType<typeof svc.MachineVersionsService.postMachinesV>
>;
export type FinalizeVersionResponse = Awaited<
  ReturnType<typeof svc.MachineVersionsService.putMachinesV>
>;

export type MachineSlug = svc.MachineSlug;
export type MachineInstanceSlug = svc.MachineInstanceSlug;
export type SignedMachineVersionId = svc.SignedMachineVersionId;
export type MachineVersionId = svc.MachineVersionId;
export type Event = svc.Event;
export type EventWithPayload = svc.EventWithPayload;
export type EventWithoutPayload = svc.EventWithoutPayload;

function withAbort<T>(
  cancellablePromise: svc.CancelablePromise<T>,
  signal?: AbortSignal
) {
  if (signal) {
    signal.addEventListener("abort", () => cancellablePromise.cancel());
  }
  return cancellablePromise;
}

async function withStructuredErrors<T>(promise: Promise<T>) {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof svc.ApiError) {
      let fallback: Error = e;
      for (const Err of Object.values(errors)) {
        if (e.status !== Err.status) {
          continue;
        }

        if ("code" in Err && e.body?.code === Err.code) {
          throw new Err(e.body.error, e);
        }

        fallback = new Err(e.body?.error ?? e.message, e.body?.code, e);
      }

      throw fallback;
    }
    throw e;
  }
}
