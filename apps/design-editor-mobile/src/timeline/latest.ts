// The native reads cannot be cancelled, so ask for one at a time and keep only the newest request that arrives meanwhile.
export function singleFlight<A, T>(
  run: (arg: A) => Promise<T>,
  done: (value: T, arg: A) => void,
  failed: (error: unknown, arg: A) => void = () => undefined,
): (arg: A) => void {
  let running = false;
  let waiting: { arg: A } | undefined;
  const start = (arg: A) => {
    running = true;
    run(arg)
      .then(
        v => { if (!waiting) done(v, arg); },
        e => { if (!waiting) failed(e, arg); },
      )
      .finally(() => {
        running = false;
        const next = waiting;
        waiting = undefined;
        if (next) start(next.arg);
      });
  };
  return arg => {
    if (running) waiting = { arg };
    else start(arg);
  };
}
