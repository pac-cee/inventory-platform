import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The actions reach the API; the markup is what is under test.
vi.mock("../actions", () => ({
  verifyEmailAction: vi.fn(),
  resendVerificationAction: vi.fn(),
}));

import { VerifyForm } from "./verify-form";

/**
 * The token has to be submitted with the form.
 *
 * It was briefly rendered as a sibling of the <form> rather than a child, so
 * pressing "Verify email" posted nothing and the page answered its own valid
 * link with "Missing verification token."
 */
describe("VerifyForm", () => {
  /** The markup between <form …> and </form>, which is what gets submitted. */
  function verifyFormBody(html: string): string {
    const start = html.indexOf("<form");
    expect(start).toBeGreaterThanOrEqual(0);
    return html.slice(start, html.indexOf("</form>", start));
  }

  it("carries the token inside the form it submits", () => {
    const html = renderToStaticMarkup(<VerifyForm token="tok-123" />);
    expect(verifyFormBody(html)).toContain('name="token"');
    expect(verifyFormBody(html)).toContain('value="tok-123"');
  });

  it("offers the verify button only when there is a token", () => {
    expect(renderToStaticMarkup(<VerifyForm token="tok-123" />)).toContain("Verify email");
    const none = renderToStaticMarkup(<VerifyForm arrivedFrom="signup" />);
    expect(none).not.toContain(">Verify email<");
    expect(none).toContain("administrator");
  });

  it("keeps the resend form available with no token at all", () => {
    // Without this an unverified account can never sign in.
    const html = renderToStaticMarkup(<VerifyForm />);
    expect(html).toContain("Resend verification email");
  });
});
