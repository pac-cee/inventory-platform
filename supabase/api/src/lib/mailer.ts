import { Resend } from "resend";
import { env } from "../env.js";

/** Escape a string for safe interpolation into HTML email bodies.
 *  DB-controlled values (item/location names) must pass through this before
 *  being embedded in markup, otherwise a crafted name renders as live HTML in
 *  an admin's inbox. Exported for unit testing. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Mailer — Resend-backed transactional email.
//
// Behaviour when EMAIL_API_KEY / EMAIL_FROM are not set:
//   • Local dev  → logs a warning and skips the send (no crash).
//   • Production → throws immediately so a misconfigured deploy is obvious.
//
// Usage:
//   import { sendPasswordResetEmail } from "./lib/mailer.js";
//   await sendPasswordResetEmail({ to: user.email, resetUrl });
// ---------------------------------------------------------------------------

/**
 * Whether a missing mail key is a fault or a choice.
 *
 * NODE_ENV cannot answer this: the Doppler dev config sets it to "production"
 * too, so keying off it made dev throw on every send the moment mail was
 * deliberately switched off there. DOPPLER_ENVIRONMENT does distinguish them
 * ("dev" vs "prd"). Anything that sets neither is assumed deployed, so a real
 * misconfiguration still fails loudly rather than quietly dropping mail.
 *
 * Exported for unit testing.
 */
export function mailIsRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const environment = env.DOPPLER_ENVIRONMENT?.trim();
  if (environment) return environment === "prd";
  return env.NODE_ENV === "production";
}

let _client: Resend | null = null;

function getClient(): Resend {
  if (!_client) {
    _client = new Resend(env.emailApiKey);
  }
  return _client;
}

/** Raw send primitive — use the named helpers below instead. */
export async function sendMail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  // Guard: if keys are blank, warn in dev and bail; throw in production.
  if (!env.emailApiKey || !env.emailFrom) {
    const msg =
      "Mailer: EMAIL_API_KEY or EMAIL_FROM is not set. " +
      "Add them to .env (local) or Doppler prd_api (production).";
    if (mailIsRequired()) {
      throw new Error(msg);
    }
    // Mail is off here on purpose. Log enough to follow the flow — the subject
    // says which mail it was, and any link is in the caller's own logging.
    console.warn(`[mailer] mail is disabled — not sending "${subject}" to ${to}`);
    return;
  }

  const { error } = await getClient().emails.send({
    from: env.emailFrom,
    to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Mailer: Resend returned an error — ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Named template helpers
// ---------------------------------------------------------------------------

/** E2: password-reset link email. */
export async function sendPasswordResetEmail({
  to,
  resetUrl,
  expiresInMinutes = 60,
}: {
  to: string;
  resetUrl: string;
  expiresInMinutes?: number;
}): Promise<void> {
  await sendMail({
    to,
    subject: "Reset your Verlet Inventory password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1a1a2e">Password reset</h2>
        <p>We received a request to reset the password for your Verlet Inventory account.</p>
        <p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:12px 24px;background:#6c63ff;color:#fff;
                    border-radius:6px;text-decoration:none;font-weight:600">
            Reset password
          </a>
        </p>
        <p style="color:#666;font-size:13px">
          This link expires in ${expiresInMinutes} minutes and can only be used once.
          If you did not request a reset, ignore this email — your password is unchanged.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">Verlet Robotics · Internal Inventory</p>
      </div>
    `,
  });
}

/** E3: email-verification link sent on signup. */
export async function sendVerificationEmail({
  to,
  verifyUrl,
}: {
  to: string;
  verifyUrl: string;
}): Promise<void> {
  await sendMail({
    to,
    subject: "Verify your Verlet Inventory email",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1a1a2e">Verify your email</h2>
        <p>Thanks for signing up. Click below to confirm your email address and activate your account.</p>
        <p>
          <a href="${verifyUrl}"
             style="display:inline-block;padding:12px 24px;background:#6c63ff;color:#fff;
                    border-radius:6px;text-decoration:none;font-weight:600">
            Verify email
          </a>
        </p>
        <p style="color:#666;font-size:13px">
          This link expires in 24 hours. If you did not create an account, ignore this email.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">Verlet Robotics · Internal Inventory</p>
      </div>
    `,
  });
}

/** E4: low-stock alert sent to admins when an item drops below 25% capacity. */
export async function sendLowStockAlert({
  to,
  itemName,
  quantity,
  capacity,
  locationName,
}: {
  to: string;
  itemName: string;
  quantity: number;
  capacity: number;
  locationName: string;
}): Promise<void> {
  const pct = capacity > 0 ? Math.round((quantity / capacity) * 100) : 0;
  const safeItem = escapeHtml(itemName);
  const safeLocation = escapeHtml(locationName);
  await sendMail({
    to,
    // Raw name: the subject is a plaintext header, so escaping here would render
    // the entities literally ("Widget &amp; Co"). The HTML body below is where
    // escaping matters.
    subject: `⚠ Low stock alert — ${itemName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#c0392b">⚠ Low stock alert</h2>
        <p>
          <strong>${safeItem}</strong> at <strong>${safeLocation}</strong>
          is running low and needs attention.
        </p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr>
            <td style="padding:8px;border:1px solid #eee;color:#666">Current qty</td>
            <td style="padding:8px;border:1px solid #eee;font-weight:600">${quantity}</td>
          </tr>
          <tr>
            <td style="padding:8px;border:1px solid #eee;color:#666">Capacity</td>
            <td style="padding:8px;border:1px solid #eee;font-weight:600">${capacity}</td>
          </tr>
          <tr>
            <td style="padding:8px;border:1px solid #eee;color:#666">Level</td>
            <td style="padding:8px;border:1px solid #eee;font-weight:600;color:#c0392b">${pct}%</td>
          </tr>
        </table>
        <p style="color:#666;font-size:13px">
          You will not receive another alert for this item until it recovers above 25% and
          drops below threshold again.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">Verlet Robotics · Internal Inventory</p>
      </div>
    `,
  });
}

/**
 * "Your account is ready — set a password."
 *
 * Sent when an admin creates an account. Deliberately not a verification mail:
 * clicking through both proves the address and sets the password, so nobody has
 * to pass a temporary one along by hand.
 */
export async function sendInviteEmail({
  to,
  setPasswordUrl,
}: {
  to: string;
  setPasswordUrl: string;
}): Promise<void> {
  await sendMail({
    to,
    subject: "Your Verlet Inventory account is ready",
    html: `
      <p>An account has been created for you on Verlet Inventory.</p>
      <p>Choose a password to finish setting it up:</p>
      <p><a href="${setPasswordUrl}">Set your password</a></p>
      <p>This link can be used once and expires. If it has lapsed, use
         &ldquo;Forgot password&rdquo; on the sign-in page to get a new one.</p>
      <p>If you were not expecting this, you can ignore it — the account cannot
         be used until a password is set.</p>
    `,
  });
}

/**
 * "Your account has been approved."
 *
 * Sent when an admin lets a self-registered account in. Until this arrives the
 * person has no way of telling an unapproved account from a broken one.
 */
export async function sendAccountApprovedEmail({
  to,
  fullName,
  signInUrl,
}: {
  to: string;
  fullName?: string | null;
  signInUrl: string;
}): Promise<void> {
  const greeting = fullName?.trim() ? `Hello ${escapeHtml(fullName.trim())},` : "Hello,";
  await sendMail({
    to,
    subject: "Your Verlet Inventory account is approved",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1a1a2e">Account approved</h2>
        <p>${greeting}</p>
        <p>An administrator has approved your Verlet Inventory account. You can sign in now
           with the email and password you registered with.</p>
        <p>
          <a href="${signInUrl}"
             style="display:inline-block;padding:12px 24px;background:#6c63ff;color:#fff;
                    border-radius:6px;text-decoration:none;font-weight:600">
            Sign in
          </a>
        </p>
        <p style="color:#666;font-size:13px">
          Forgotten the password you chose? Use &ldquo;Forgot password&rdquo; on the sign-in page.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">Verlet Robotics · Internal Inventory</p>
      </div>
    `,
  });
}

/**
 * "An account has been created for you", carrying the password the admin set.
 *
 * Note this puts a working credential in an inbox, where it stays. Prefer
 * sendInviteEmail, which lets the person choose their own password and proves
 * the address at the same time; this exists for when an admin sets one
 * directly. The wording pushes hard towards changing it on first sign-in.
 */
export async function sendAccountCreatedEmail({
  to,
  fullName,
  password,
  signInUrl,
}: {
  to: string;
  fullName?: string | null;
  password: string;
  signInUrl: string;
}): Promise<void> {
  const greeting = fullName?.trim() ? `Hello ${escapeHtml(fullName.trim())},` : "Hello,";
  await sendMail({
    to,
    subject: "Your Verlet Inventory account has been created",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1a1a2e">Your account is ready</h2>
        <p>${greeting}</p>
        <p>An administrator has created a Verlet Inventory account for you. Sign in with:</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr>
            <td style="padding:8px;border:1px solid #eee;color:#666">Email</td>
            <td style="padding:8px;border:1px solid #eee;font-weight:600">${escapeHtml(to)}</td>
          </tr>
          <tr>
            <td style="padding:8px;border:1px solid #eee;color:#666">Password</td>
            <td style="padding:8px;border:1px solid #eee;font-family:monospace;font-weight:600">${escapeHtml(password)}</td>
          </tr>
        </table>
        <p>
          <a href="${signInUrl}"
             style="display:inline-block;padding:12px 24px;background:#6c63ff;color:#fff;
                    border-radius:6px;text-decoration:none;font-weight:600">
            Sign in
          </a>
        </p>
        <p style="color:#c0392b;font-size:13px">
          <strong>Change this password once you are in</strong> — Settings &rsaquo; Password.
          Anyone who reads this email can use it until you do.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">Verlet Robotics · Internal Inventory</p>
      </div>
    `,
  });
}

/**
 * "An administrator changed your password", carrying the new one.
 *
 * Sent whether or not the person asked for it: an unexplained password change
 * is exactly the thing someone needs to be told about, so the mail doubles as
 * the alert. Same caveat as sendAccountCreatedEmail about the inbox copy.
 */
export async function sendPasswordChangedByAdminEmail({
  to,
  fullName,
  password,
  signInUrl,
}: {
  to: string;
  fullName?: string | null;
  password: string;
  signInUrl: string;
}): Promise<void> {
  const greeting = fullName?.trim() ? `Hello ${escapeHtml(fullName.trim())},` : "Hello,";
  await sendMail({
    to,
    subject: "Your Verlet Inventory password was changed",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1a1a2e">Your password was changed</h2>
        <p>${greeting}</p>
        <p>An administrator has set a new password on your Verlet Inventory account.
           Your new password is:</p>
        <p style="font-family:monospace;font-size:16px;font-weight:600;padding:12px;
                  background:#f5f5f5;border-radius:6px">${escapeHtml(password)}</p>
        <p>
          <a href="${signInUrl}"
             style="display:inline-block;padding:12px 24px;background:#6c63ff;color:#fff;
                    border-radius:6px;text-decoration:none;font-weight:600">
            Sign in
          </a>
        </p>
        <p style="color:#c0392b;font-size:13px">
          <strong>Change it once you are in</strong> — Settings &rsaquo; Password.
          If you were not expecting this change, tell an administrator now.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">Verlet Robotics · Internal Inventory</p>
      </div>
    `,
  });
}

/**
 * "Did you ask to change your password?" — confirm or refuse.
 *
 * Sent when someone submits a new password on the reset page. Nothing has
 * changed at this point: the password only takes effect when the owner of this
 * inbox confirms, which is what makes it safe to let an unauthenticated form
 * choose one. The refuse link is given equal weight on purpose — if this mail
 * is a surprise, that is the useful button.
 */
export async function sendPasswordChangeConfirmEmail({
  to,
  confirmUrl,
  denyUrl,
  expiresInMinutes = 60,
}: {
  to: string;
  confirmUrl: string;
  denyUrl: string;
  expiresInMinutes?: number;
}): Promise<void> {
  await sendMail({
    to,
    subject: "Confirm your Verlet Inventory password change",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#1a1a2e">Confirm your new password</h2>
        <p>Someone entered a new password for your Verlet Inventory account.
           <strong>Nothing has changed yet.</strong> Confirm below and the new
           password takes effect straight away.</p>
        <p>
          <a href="${confirmUrl}"
             style="display:inline-block;padding:12px 24px;background:#6c63ff;color:#fff;
                    border-radius:6px;text-decoration:none;font-weight:600">
            Yes, change my password
          </a>
        </p>
        <p style="margin-top:20px">
          Not you?
          <a href="${denyUrl}" style="color:#c0392b;font-weight:600">Refuse this change</a>
          — the request is cancelled and your current password keeps working.
        </p>
        <p style="color:#666;font-size:13px">
          This expires in ${expiresInMinutes} minutes and can only be used once.
          Ignoring it also leaves your password unchanged.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">Verlet Robotics · Internal Inventory</p>
      </div>
    `,
  });
}

// ---------------------------------------------------------------------------
// Loans: due-back reminders and the managers' digest
// ---------------------------------------------------------------------------

export interface LoanLine {
  itemName: string;
  quantity: number;
  /** "Due Fri 31 Oct", "Overdue · 3 days" — already worded for a person. */
  when: string;
  /** Digest only: who has it. */
  person?: string;
}

function loanRows(lines: LoanLine[], withPerson: boolean): string {
  return lines
    .map(
      (l) => `<tr>
        <td style="padding:6px 8px;border:1px solid #eee">${escapeHtml(l.itemName)}${withPerson && l.person ? `<br/><span style="color:#888;font-size:12px">${escapeHtml(l.person)}</span>` : ""}</td>
        <td style="padding:6px 8px;border:1px solid #eee;text-align:center">${l.quantity}</td>
        <td style="padding:6px 8px;border:1px solid #eee">${escapeHtml(l.when)}</td>
      </tr>`,
    )
    .join("");
}

function loanSection(title: string, colour: string, lines: LoanLine[], withPerson = false): string {
  if (lines.length === 0) return "";
  return `
    <h3 style="color:${colour};margin:20px 0 6px;font-size:15px">${escapeHtml(title)}</h3>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <tr style="background:#fafafa;color:#666;text-align:left">
        <th style="padding:6px 8px;border:1px solid #eee">Item</th>
        <th style="padding:6px 8px;border:1px solid #eee">Qty</th>
        <th style="padding:6px 8px;border:1px solid #eee">When</th>
      </tr>
      ${loanRows(lines, withPerson)}
    </table>`;
}

/** One person's reminder: what is due tomorrow, due today, and overdue. */
export async function sendLoanReminderEmail({
  to,
  name,
  dueTomorrow,
  dueToday,
  overdue,
}: {
  to: string;
  name: string;
  dueTomorrow: LoanLine[];
  dueToday: LoanLine[];
  overdue: LoanLine[];
}): Promise<void> {
  const subject = overdue.length
    ? `Equipment overdue — ${overdue.length} item${overdue.length === 1 ? "" : "s"} to return`
    : dueToday.length
      ? "Equipment due back today"
      : "Equipment due back tomorrow";
  await sendMail({
    to,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto">
        <h2 style="margin-bottom:4px">Equipment to bring back</h2>
        <p>Hi ${escapeHtml(name || "there")}, these are the things you have out that need your attention.</p>
        ${loanSection("Overdue", "#c0392b", overdue)}
        ${loanSection("Due today", "#d68910", dueToday)}
        ${loanSection("Due tomorrow", "#555", dueTomorrow)}
        <p style="color:#666;font-size:13px;margin-top:20px">
          Need longer? Open the item in the app and choose <strong>Change date</strong>, so everyone knows when it will be back.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">Verlet Robotics · Internal Inventory</p>
      </div>
    `,
  });
}

/** The managers' daily digest: everything overdue, and everything due today. */
export async function sendLoanDigestEmail({
  to,
  overdue,
  dueToday,
}: {
  to: string;
  overdue: LoanLine[];
  dueToday: LoanLine[];
}): Promise<void> {
  await sendMail({
    to,
    subject: `Equipment digest — ${overdue.length} overdue, ${dueToday.length} due today`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto">
        <h2 style="margin-bottom:4px">Equipment out — daily digest</h2>
        <p>Who still has equipment that is late or due back today.</p>
        ${loanSection("Overdue", "#c0392b", overdue, true)}
        ${loanSection("Due today", "#d68910", dueToday, true)}
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px">Verlet Robotics · Internal Inventory</p>
      </div>
    `,
  });
}
