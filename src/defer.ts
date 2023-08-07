export function defer(): [() => void, Promise<void>] {
  let resolve: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return [resolve!, promise];
}
