import assert from "node:assert/strict";
import { getSupabaseAdmin } from "../src/lib/supabase/admin";

process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const originalWebSocket = globalThis.WebSocket;
Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: undefined });

try {
  assert.doesNotThrow(() => getSupabaseAdmin());
  console.log("Supabase admin client initializes without a global WebSocket");
} finally {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: originalWebSocket,
  });
}
