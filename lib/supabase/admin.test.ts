import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example-ref.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "publishable-test-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  class Redirect extends Error {
    to: string;
    constructor(to: string) {
      super(`NEXT_REDIRECT ${to}`);
      this.to = to;
    }
  }
  return { Redirect, serviceClient: { role: "service" } };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal", () => ({ requireSuperadmin: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => h.serviceClient) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(), createBrowserClient: vi.fn() }));

import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { requireSuperadmin } from "@/lib/dal";
import * as admin from "@/lib/supabase/admin";

const gate = vi.mocked(requireSuperadmin);
const create = vi.mocked(createClient);

beforeEach(() => {
  vi.clearAllMocks();
  gate.mockResolvedValue({ userId: "11111111-1111-4111-8111-111111111111", email: null });
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("adminDb", () => {
  it("is the module's only export", () => {
    expect(Object.keys(admin)).toEqual(["adminDb"]);
  });

  it("builds nothing when the caller is not a superadmin", async () => {
    for (const to of ["/login", "/not-authorized"]) {
      gate.mockRejectedValueOnce(new h.Redirect(to));
      await expect(admin.adminDb()).rejects.toMatchObject({ to });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("checks the caller before building the client, on every call", async () => {
    await admin.adminDb();
    await admin.adminDb();
    expect(gate).toHaveBeenCalledTimes(2);
    expect(gate.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
  });

  it("uses supabase-js with the service key and no session, never the cookie client", async () => {
    expect(await admin.adminDb()).toBe(h.serviceClient);
    expect(create).toHaveBeenCalledExactlyOnceWith(
      "https://example-ref.supabase.co",
      "service-test-key",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    expect(createServerClient).not.toHaveBeenCalled();
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("checks the caller even before the key, so a non-admin learns nothing about config", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    gate.mockRejectedValueOnce(new h.Redirect("/login"));
    await expect(admin.adminDb()).rejects.toMatchObject({ to: "/login" });
  });

  it("throws when the service key is missing or empty", async () => {
    for (const value of [undefined, ""]) {
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", value);
      await expect(admin.adminDb()).rejects.toThrow(/not set/);
    }
    expect(create).not.toHaveBeenCalled();
  });
});
