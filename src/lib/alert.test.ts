import { expect, test, vi } from "vitest";
import { alertBody, reportIntegrity } from "./alert";

const A = { event: "asset_object_missing", slug: "slug000000000000000001", version: 3, codeId: "abc123" };

test("alertBody carries only safe fields — no raw code or URL shape", () => {
  const body = alertBody(A);
  expect(JSON.parse(body)).toEqual({ level: "error", ...A });
  expect(body).not.toMatch(/\?code=/);       // never a share URL
  expect(body).not.toContain("http");        // no URL at all
});

test("reportIntegrity always console.errors; dispatches the webhook only when configured + waitUntil given", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const scheduled: Promise<unknown>[] = [];
  const waitUntil = (p: Promise<unknown>) => scheduled.push(p);

  reportIntegrity({}, A, waitUntil);                                    // no webhook configured
  expect(scheduled).toHaveLength(0);
  reportIntegrity({ ALERT_WEBHOOK_URL: "https://hook.test/x" }, A);     // no waitUntil (can't dispatch safely)
  expect(scheduled).toHaveLength(0);
  expect(spy).toHaveBeenCalledTimes(2);                                 // console path fires either way

  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
  reportIntegrity({ ALERT_WEBHOOK_URL: "https://hook.test/x" }, A, waitUntil);
  expect(scheduled).toHaveLength(1);
  expect(fetchSpy).toHaveBeenCalledWith("https://hook.test/x", expect.objectContaining({ method: "POST" }));
  spy.mockRestore();
  fetchSpy.mockRestore();
});
