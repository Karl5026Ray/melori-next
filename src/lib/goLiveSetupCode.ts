// Shared between the server gate and the client. When a go-live route answers
// 403 with this code, the caller has not finished the one-time go-live step
// (a mobile number on file, verified once SMS verification is live). authFetch
// recognises it, opens the go-live sheet, and retries the request when the
// member finishes. Any other 403 is passed through untouched.
export const GO_LIVE_SETUP_CODE = "go_live_setup_required";
