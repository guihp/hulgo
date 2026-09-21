/**
 * Live smoke: dotenv + service Supabase + mock advogado auth.
 * Run: npx tsx --require ./scripts/register-smoke-live.cjs scripts/smoke-assistente-live.ts
 */
const Module = require("module");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const stub = path.join(__dirname, "empty-stub.cjs");
const cacheStub = path.join(__dirname, "next-cache-stub.cjs");
const serverMock = path.join(__dirname, "smoke-supabase-server.cjs");
const authMock = path.join(__dirname, "smoke-auth-advogado.cjs");

const STUBS = new Map([
  ["server-only", stub],
  ["next/cache", cacheStub],
  ["next/headers", stub],
  ["next/navigation", stub],
]);

function isAuthModule(resolved) {
  const n = resolved.replace(/\\/g, "/");
  return (
    n.endsWith("/lib/actions/auth.ts") ||
    n.endsWith("/lib/actions/auth.js") ||
    n.includes("/lib/actions/auth.")
  );
}

function isServerModule(resolved) {
  const n = resolved.replace(/\\/g, "/");
  return (
    n.endsWith("/lib/supabase/server.ts") ||
    n.endsWith("/lib/supabase/server.js") ||
    n.includes("/lib/supabase/server.")
  );
}

const orig = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (STUBS.has(request)) return STUBS.get(request);
  const resolved = orig.call(this, request, parent, isMain, options);
  if (isServerModule(resolved)) return serverMock;
  if (isAuthModule(resolved)) return authMock;
  return resolved;
};
