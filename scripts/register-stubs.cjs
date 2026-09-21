/**
 * Register stubs so smoke scripts can import server action graphs outside Next.
 */
const Module = require("module");
const path = require("path");
const stub = path.join(__dirname, "empty-stub.cjs");

const STUBS = new Set([
  "server-only",
  "next/cache",
  "next/headers",
  "next/navigation",
]);

const orig = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (STUBS.has(request)) return stub;
  return orig.call(this, request, parent, isMain, options);
};
