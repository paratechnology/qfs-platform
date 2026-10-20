import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { assertSameOrigin, clientIp, parseJson, rateLimit, rateLimitByIp } from "../lib/api/helpers";
import { registerSchema, documentSchema, reviewSchema } from "../lib/validators";
import { loginUser } from "../lib/services/auth";
import { createUser, resetDb } from "./helpers";

function req(headers: Record<string, string>, method = "POST", body?: unknown) {
  return new NextRequest("http://localhost:3000/api/x", {
    method,
    headers: { host: "localhost:3000", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("CSRF — same-origin enforcement", () => {
  it("blocks a cross-site Origin", () => {
    expect(() => assertSameOrigin(req({ origin: "https://evil.example" }))).toThrowError(
      /Cross-origin/
    );
  });

  it("blocks a cross-site Referer when Origin is absent", () => {
    expect(() => assertSameOrigin(req({ referer: "https://evil.example/form" }))).toThrowError(
      /Cross-origin/
    );
  });

  it("blocks Sec-Fetch-Site: cross-site", () => {
    expect(() => assertSameOrigin(req({ "sec-fetch-site": "cross-site" }))).toThrowError(
      /Cross-origin/
    );
  });

  it("allows same-origin and non-browser clients", () => {
    expect(() => assertSameOrigin(req({ origin: "http://localhost:3000" }))).not.toThrow();
    expect(() => assertSameOrigin(req({}))).not.toThrow();
  });
});

describe("request hardening", () => {
  it("rejects oversized bodies before parsing", async () => {
    const big = req({ "content-length": "999999" }, "POST", { a: 1 });
    await expect(parseJson(big)).rejects.toMatchObject({ status: 413 });
  });

  it("parses normal bodies", async () => {
    const r = req({ "content-length": "7" }, "POST", { a: 1 });
    await expect(parseJson(r)).resolves.toEqual({ a: 1 });
  });

  it("prefers the proxy-set real IP over a spoofable forwarded header", () => {
    const r = req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2", "x-real-ip": "9.9.9.9" });
    expect(clientIp(r)).toBe("9.9.9.9");
  });

  it("throttles a key after the limit", () => {
    const key = `test:${Math.random()}`;
    rateLimit(key, 2, 60_000);
    rateLimit(key, 2, 60_000);
    expect(() => rateLimit(key, 2, 60_000)).toThrowError(/Too many requests/);
  });

  it("uses a tight per-IP limit but a generous shared bucket when no IP is known", () => {
    const kind = `ip:${Math.random()}`;
    const known = req({ "x-real-ip": "203.0.113.7" });
    rateLimitByIp(kind, known, 2, 60_000);
    rateLimitByIp(kind, known, 2, 60_000);
    expect(() => rateLimitByIp(kind, known, 2, 60_000)).toThrowError(/Too many requests/);

    // No proxy headers -> everyone shares "unknown", which must not lock out the site.
    const shared = req({});
    for (let i = 0; i < 10; i++) rateLimitByIp(kind, shared, 2, 60_000);
  });
});

describe("password policy", () => {
  const base = {
    firstName: "Ama",
    lastName: "Serwaa",
    email: "ama@test.qfs",
    confirmPassword: "Strong1234!",
    country: "Ghana",
    phone: "+233 20 000 0000",
  };

  const bad: [string, string][] = [
    ["short", "Ab1!efgh"],
    ["no digit", "StrongPassword!"],
    ["no letter", "1234567890!"],
    ["over 72 bytes", "a".repeat(60) + "1!" + "b".repeat(20)],
  ];

  for (const [label, password] of bad) {
    it(`rejects a password that is ${label}`, () => {
      const r = registerSchema.safeParse({ ...base, password, confirmPassword: password });
      expect(r.success).toBe(false);
    });
  }

  it("accepts a compliant password", () => {
    const r = registerSchema.safeParse({ ...base, password: "Strong1234!", confirmPassword: "Strong1234!" });
    expect(r.success).toBe(true);
  });
});

describe("URL scheme allowlist", () => {
  const doc = { code: "gh", title: "Guide", flagPath: "/flags/gh.png", fileUrl: "/docs/a.pdf" };

  it("rejects javascript: and protocol-relative URLs", () => {
    expect(
      reviewSchema.safeParse({ userName: "Ama", rating: 5, text: "Solid platform", avatarUrl: "javascript:alert(1)" }).success
    ).toBe(false);
    expect(documentSchema.safeParse({ ...doc, flagPath: "//evil.example/f.png" }).success).toBe(false);
    expect(documentSchema.safeParse({ ...doc, fileUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("accepts site-relative and https URLs", () => {
    expect(
      reviewSchema.safeParse({ userName: "Ama", rating: 5, text: "Solid platform", avatarUrl: "/avatars/avatar1.jpg" }).success
    ).toBe(true);
    expect(documentSchema.safeParse(doc).success).toBe(true);
    expect(documentSchema.safeParse({ ...doc, fileUrl: "https://x.example/a.pdf" }).success).toBe(true);
  });
});

describe("login", () => {
  it("returns an identical error for unknown email and wrong password", async () => {
    const user = await createUser("Real User", "real@test.qfs");
    const missing = await loginUser({ email: "nobody@test.qfs", password: "Wrong1234!" }).catch((e) => e);
    const wrong = await loginUser({ email: user.email, password: "Wrong1234!" }).catch((e) => e);
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(missing.message).toBe(wrong.message);
  });

  it("authenticates the right password and refuses a suspended account", async () => {
    const user = await createUser("Real User", "real2@test.qfs");
    await expect(loginUser({ email: user.email, password: "Test12345!" })).resolves.toMatchObject({ id: user.id });

    const { prisma } = await import("../lib/db");
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    await expect(loginUser({ email: user.email, password: "Test12345!" })).rejects.toMatchObject({
      status: 403,
    });
  });
});
