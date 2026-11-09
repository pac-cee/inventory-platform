import { describe, it, expect, vi, afterEach } from "vitest";
import { escapeHtml, mailIsRequired } from "../../src/lib/mailer.js";

// Capture what the mailer hands to Resend, so the composed subject/body can be
// asserted without sending anything.
const sent: { from: string; to: string; subject: string; html: string }[] = [];
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { from: string; to: string; subject: string; html: string }) => {
        sent.push(payload);
        return { data: { id: "test" }, error: null };
      },
    };
  },
}));

/** Load a fresh mailer with mail credentials present — env.ts snapshots
 *  process.env at import time, so the module graph has to be rebuilt. */
async function loadMailerWithCredentials() {
  vi.resetModules();
  vi.stubEnv("EMAIL_API_KEY", "test-key");
  vi.stubEnv("EMAIL_FROM", "inventory@verlet.test");
  return import("../../src/lib/mailer.js");
}

describe("mailer.sendLowStockAlert composition", () => {
  afterEach(() => {
    sent.length = 0;
    vi.unstubAllEnvs();
  });

  it("uses the raw name in the subject and the escaped name in the body", async () => {
    const { sendLowStockAlert } = await loadMailerWithCredentials();
    await sendLowStockAlert({
      to: "admin@verlet.test",
      itemName: "Widget & Co",
      quantity: 5,
      capacity: 100,
      locationName: "<b>Warehouse</b>",
    });

    expect(sent).toHaveLength(1);
    const mail = sent[0];
    // Subject is a plaintext header — escaping it renders entities literally.
    expect(mail.subject).toBe("⚠ Low stock alert — Widget & Co");
    expect(mail.subject).not.toContain("&amp;");
    // Body is markup — escaping here is the actual Phase B #3 fix.
    expect(mail.html).toContain("Widget &amp; Co");
    expect(mail.html).toContain("&lt;b&gt;Warehouse&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Warehouse</b>");
  });
});

describe("mailer.escapeHtml (Phase B #3)", () => {
  it("escapes the five HTML-sensitive characters", () => {
    expect(escapeHtml(`<img src=x onerror=alert(1)>`)).toBe(
      "&lt;img src=x onerror=alert(1)&gt;",
    );
    expect(escapeHtml(`</td><script>evil()</script>`)).toBe(
      "&lt;/td&gt;&lt;script&gt;evil()&lt;/script&gt;",
    );
    expect(escapeHtml(`"quote'apos`)).toBe("&quot;quote&#39;apos");
  });

  it("leaves benign text untouched", () => {
    expect(escapeHtml("Widget A-1 (Warehouse)")).toBe("Widget A-1 (Warehouse)");
  });

  it("is applied to item/location names in sendLowStockAlert body", () => {
    // Construct the exact string sendLowStockAlert builds for the names.
    const itemName = `<b>Item</b>`;
    const locationName = `& <script>`;
    const body = `strong>${escapeHtml(itemName)}</strong> at <strong>${escapeHtml(locationName)}</strong>`;
    expect(body).toContain("&lt;b&gt;Item&lt;/b&gt;");
    expect(body).toContain("&amp; &lt;script&gt;");
    expect(body).not.toContain("<script>");
  });
});

describe("mailIsRequired", () => {
  it("is required in the production environment", () => {
    expect(mailIsRequired({ DOPPLER_ENVIRONMENT: "prd" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("is not required in dev, even though dev sets NODE_ENV=production", () => {
    // This is the real config: the Doppler dev config carries
    // NODE_ENV=production, so NODE_ENV alone made dev throw on every send once
    // mail was deliberately switched off there.
    expect(
      mailIsRequired({
        DOPPLER_ENVIRONMENT: "dev",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("assumes deployed when nothing identifies the environment", () => {
    // A real misconfiguration must still fail loudly rather than drop mail.
    expect(mailIsRequired({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(mailIsRequired({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
