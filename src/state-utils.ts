import * as api from "./gen-api.ts";

export type EnhancedState = api.components["schemas"]["State"] & {
  states: Array<string>;
};

export const enhanceState = (
  state: Omit<api.components["schemas"]["State"], "states">,
): EnhancedState => ({
  ...state,
  states: toStrings(state.state),
});

// adapted from XState: https://github.com/statelyai/xstate/blob/main/packages/core/src/State.ts#L290
export const toStrings = (
  stateValue: api.components["schemas"]["StateValue"] | undefined,
  delimiter = ".",
): string[] => {
  if (typeof stateValue === "string") {
    return [stateValue];
  }

  if (typeof stateValue === "undefined") {
    return [];
  }

  const valueKeys = Object.keys(stateValue);

  return valueKeys.concat(
    ...valueKeys.map((key) =>
      toStrings(stateValue[key], delimiter).map(
        (s) => key + delimiter + s,
      )
    ),
  );
};
