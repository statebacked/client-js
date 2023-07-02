import * as svc from "../gen";

svc.OpenAPI.CREDENTIALS = "include";
svc.OpenAPI.WITH_CREDENTIALS = true;

export const config = (token: string) => {
    svc.OpenAPI.TOKEN = token;
};

export const machines = {
    create: (machineName: string, signal?: AbortSignal) => withAbort(svc.MachinesService.postMachines({
        requestBody: {
            slug: machineName,
        }
    }), signal),
};

export const machineVersions = {
    provisionallyCreateVersion: (machineName: svc.MachineSlug, signal?: AbortSignal) => withAbort(svc.MachineVersionsService.postMachinesV({
        machineSlug: machineName,
        requestBody: {}
    }), signal),

    finalizeVersion: (
        machineName: svc.MachineSlug,
        signedMachineVersionId: svc.SignedMachineVersionId,
        req: FinalizeVersionRequest,
        signal?: AbortSignal
    ) => withAbort(svc.MachineVersionsService.putMachinesV({
        machineSlug: machineName,
        signedMachineVersionId,
        requestBody: req,
    }), signal),

    createVersion: async (
        machineName: svc.MachineSlug,
        req: NonNullable<FinalizeVersionRequest> & { code: string },
        signal?: AbortSignal
    ) => {
        const provisionalCreationRes = await machineVersions.provisionallyCreateVersion(machineName, signal);
        const { codeUploadFields, codeUploadUrl, machineVersionId: signedMachineVersionId } = provisionalCreationRes;

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

        await fetch(
            codeUploadUrl,
            {
                method: "POST",
                body: uploadForm,
                signal,
            },
        );

        return machineVersions.finalizeVersion(
            machineName,
            signedMachineVersionId,
            {
                clientInfo: req.clientInfo,
                makeCurrent: req.makeCurrent,
            },
            signal,
        );
    }
};

export const machineInstances = {
    create: (
        machineName: svc.MachineSlug,
        instanceName: svc.MachineInstanceSlug,
        req: CreateMachineInstanceRequest,
        signal?: AbortSignal
    ) => withAbort(svc.MachineInstancesService.postMachines({
        machineSlug: machineName,
        requestBody: {
            slug: instanceName,
            context: req?.context,
            machineVersionId: req?.machineVersionId,
        }
    }), signal),

    sendEvent: (
        machineName: svc.MachineSlug,
        instanceName: svc.MachineInstanceSlug,
        req: NonNullable<SendEventRequest>,
        signal?: AbortSignal
    ) => withAbort(svc.MachineInstancesService.postMachinesIEvents({
        machineSlug: machineName,
        instanceSlug: instanceName,
        requestBody: {
            event: req.event,
        }
    }), signal),
};

export type FinalizeVersionRequest = Parameters<typeof svc.MachineVersionsService.putMachinesV>[0]["requestBody"];
export type CreateMachineInstanceRequest = Parameters<typeof svc.MachineInstancesService.postMachines>[0]["requestBody"];
export type SendEventRequest = Parameters<typeof svc.MachineInstancesService.postMachinesIEvents>[0]["requestBody"];

function withAbort<T>(cancellablePromise: svc.CancelablePromise<T>, signal?: AbortSignal) {
    if (signal) {
        signal.addEventListener("abort", () => cancellablePromise.cancel());
    }
    return cancellablePromise;
}
