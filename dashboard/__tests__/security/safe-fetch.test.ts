import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSafeWebhookUrlSync,
  ipFamily,
  isBlockedAddress,
  signPayload,
  WebhookError,
} from "../../lib/server/safe-fetch";

const ACCEPT = [
  "https://hooks.zapier.com/hooks/catch/123/abc",
  "https://hook.us1.make.com/xyz",
  "https://example.com",
  "https://example.com:443/path?x=1",
  "https://8.8.8.8/hook",
  "https://[2606:4700:4700::1111]/hook",
];

const REJECT: [string, string][] = [
  ["http://hooks.zapier.com/x", "https"],
  ["ftp://example.com/x", "https"],
  ["https://user:pw@example.com/x", "credentials"],
  ["https://example.com:8443/x", "port"],
  ["https://localhost/x", "local"],
  ["https://LOCALHOST/x", "local"],
  ["https://foo.local/x", "local"],
  ["https://db.internal/x", "local"],
  ["https://1.0.0.127.in-addr.arpa/x", "local"],
  ["https://127.0.0.1/x", "private"],
  ["https://127.9.9.9/x", "private"],
  ["https://10.1.2.3/x", "private"],
  ["https://172.16.0.1/x", "private"],
  ["https://172.31.255.255/x", "private"],
  ["https://192.168.1.1/x", "private"],
  ["https://169.254.169.254/latest/meta-data/", "private"],
  ["https://100.64.0.1/x", "private"],
  ["https://0.0.0.0/x", "private"],
  ["https://224.0.0.1/x", "private"],
  ["https://255.255.255.255/x", "private"],
  ["https://2130706433/x", "private"], // 127.0.0.1 as a decimal literal
  ["https://0x7f000001/x", "private"], // 127.0.0.1 as hex
  ["https://[::1]/x", "private"],
  ["https://[::]/x", "private"],
  ["https://[fc00::1]/x", "private"],
  ["https://[fd12:3456::1]/x", "private"],
  ["https://[fe80::1]/x", "private"],
  ["https://[::ffff:127.0.0.1]/x", "private"], // IPv4-mapped v6
  ["https://[::ffff:7f00:1]/x", "private"], // IPv4-mapped v6, hex form
  ["https://[::ffff:169.254.169.254]/x", "private"],
  ["https://[64:ff9b::7f00:1]/x", "private"], // NAT64 embedded loopback
  ["not a url", "valid"],
  ["", "string"],
];

describe("assertSafeWebhookUrlSync", () => {
  beforeEach(() => {
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
  });

  it.each(ACCEPT)("accepts %s", (url) => {
    expect(assertSafeWebhookUrlSync(url)).toBeInstanceOf(URL);
  });

  it.each(REJECT)("rejects %s (%s)", (url, reason) => {
    expect(() => assertSafeWebhookUrlSync(url)).toThrow(WebhookError);
    expect(() => assertSafeWebhookUrlSync(url)).toThrow(new RegExp(reason, "i"));
  });

  it("rejects URLs over 2048 chars", () => {
    expect(() => assertSafeWebhookUrlSync(`https://example.com/${"a".repeat(2048)}`)).toThrow(
      WebhookError
    );
  });

  it("accepts IPv4-mapped v6 of a public address", () => {
    expect(assertSafeWebhookUrlSync("https://[::ffff:8.8.8.8]/x")).toBeInstanceOf(URL);
  });
});

describe("WEBHOOK_ALLOWED_HOSTS", () => {
  const prev = process.env.WEBHOOK_ALLOWED_HOSTS;
  afterEach(() => {
    if (prev === undefined) delete process.env.WEBHOOK_ALLOWED_HOSTS;
    else process.env.WEBHOOK_ALLOWED_HOSTS = prev;
  });

  it("enforces exact and suffix matches when set", () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = "hooks.zapier.com, make.com";
    expect(assertSafeWebhookUrlSync("https://hooks.zapier.com/a")).toBeInstanceOf(URL);
    expect(assertSafeWebhookUrlSync("https://hook.us1.make.com/a")).toBeInstanceOf(URL);
    expect(assertSafeWebhookUrlSync("https://make.com/a")).toBeInstanceOf(URL);
    expect(() => assertSafeWebhookUrlSync("https://zapier.com/a")).toThrow(/ALLOWED_HOSTS/);
    expect(() => assertSafeWebhookUrlSync("https://notmake.com/a")).toThrow(/ALLOWED_HOSTS/);
    expect(() => assertSafeWebhookUrlSync("https://make.com.evil.io/a")).toThrow(/ALLOWED_HOSTS/);
  });

  it("still blocks private addresses even when allowlisted", () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = "127.0.0.1";
    expect(() => assertSafeWebhookUrlSync("https://127.0.0.1/a")).toThrow(/private/);
  });
});

describe("ipFamily", () => {
  it("detects literals", () => {
    expect(ipFamily("1.2.3.4")).toBe(4);
    expect(ipFamily("[::1]")).toBe(6);
    expect(ipFamily("::ffff:1.2.3.4")).toBe(6);
    expect(ipFamily("example.com")).toBe(0);
    expect(ipFamily("1.2.3")).toBe(0);
    expect(ipFamily("1:2:3")).toBe(0);
  });
});

describe("isBlockedAddress", () => {
  it("classifies resolved addresses", () => {
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("169.254.0.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fe80::abcd")).toBe(true);
    expect(isBlockedAddress("::ffff:192.168.0.1")).toBe(true);
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("example.com")).toBe(false);
  });
});

describe("signPayload", () => {
  it("is a deterministic HMAC-SHA256 over ts.body", async () => {
    const a = await signPayload("secret", "1700000000000", '{"a":1}');
    const b = await signPayload("secret", "1700000000000", '{"a":1}');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    // Cross-check against node:crypto.
    const { createHmac } = await import("node:crypto");
    expect(createHmac("sha256", "secret").update('1700000000000.{"a":1}').digest("hex")).toBe(a);
    expect(await signPayload("other", "1700000000000", '{"a":1}')).not.toBe(a);
    expect(await signPayload("secret", "1700000000001", '{"a":1}')).not.toBe(a);
  });
});
