// Client side of the go-live gate: a single opener, registered by the
// <GoLiveSetupHost> mounted in the root layout. authFetch calls
// requestGoLiveSetup() when a go-live route answers GO_LIVE_SETUP_CODE.
//
// Resolves true when the member finished the step (the caller then retries the
// original request), false when they closed it or no host is mounted. Only one
// sheet is ever open: concurrent callers share the same answer.

type Opener = () => Promise<boolean>;

let opener: Opener | null = null;
let inFlight: Promise<boolean> | null = null;

export function registerGoLiveSetupOpener(fn: Opener): () => void {
  opener = fn;
  return () => {
    if (opener === fn) opener = null;
  };
}

export function requestGoLiveSetup(): Promise<boolean> {
  if (!opener) return Promise.resolve(false);
  if (!inFlight) {
    inFlight = opener().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
