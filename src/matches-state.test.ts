import {
  assert,
  assertFalse,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { matchesState } from "./index.ts";

Deno.test("matchesState", () => {
  assert(matchesState("a", "a"));
  assert(matchesState("a.b", "a.b"));
  assert(matchesState("a.b", { a: "b" }));
  assert(matchesState("a", { a: "b" }));
  assert(matchesState(["a", "b"], { a: "b" }));
  assert(matchesState({ a: "b" }, { a: "b" }));
  assert(matchesState({ a: "b" }, { a: { b: "c" } }));

  assertFalse(matchesState("a", "b"));
  assertFalse(matchesState("a.b", "a.c"));
  assertFalse(matchesState("a.b", { a: "c" }));
  assertFalse(matchesState("a", { c: "b" }));
  assertFalse(matchesState(["a", "b"], { a: "c" }));
  assertFalse(matchesState({ a: "b" }, { a: "c" }));
  assertFalse(matchesState({ a: "b" }, { a: { c: "c" } }));
});
