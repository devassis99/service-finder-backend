import { env } from "../config/env";
import { fetchWithRateLimitRetry } from "./provider-fetch";

/**
 * Sends transactional email via Resend's plain REST API directly with
 * fetch — one call site, so raw HTTP beats pulling in a whole SDK.
 *
 * Falls back to logging to the server console when RESEND_API_KEY isn't
 * set: lets anything that sends email be exercised locally/in CI without
 * a real Resend account or verified sending domain. Throws in that case
 * only if NODE_ENV is "production", so a real deploy never silently
 * "succeeds" at sending an email nobody receives.
 */
/**
 * Whether a real provider is configured.
 *
 * Callers need this because the dev fallback below *succeeds* without
 * sending anything, so "sendEmail didn't throw" does not mean "it
 * arrived". Anything that reports delivery back to a user has to tell the
 * two apart, or the UI cheerfully says "Sent" about an email that only
 * ever existed in a terminal.
 */
export function emailDeliveryConfigured(): boolean {
  return !!env.RESEND_API_KEY;
}

/** What actually happened — "logged" means the dev fallback printed it to the console instead. */
export type EmailOutcome = "sent" | "logged";

export async function sendEmail(to: string, subject: string, html: string): Promise<EmailOutcome> {
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === "production") {
      throw new Error("Email provider is not configured (missing RESEND_API_KEY)");
    }
    // Subject and recipient only by default. The body is ~40 lines of
    // inline-styled table markup that a terminal can't render anyway, and
    // printing it buries whatever the caller logged alongside it — the
    // a sign-in link, for instance. EMAIL_DEBUG_HTML=1 brings it
    // back for when you're working on the template itself.
    console.log(`[email:dev] To: ${to} — Subject: ${subject}`);
    if (env.EMAIL_DEBUG_HTML === "1") console.log(html);
    return "logged";
  }

  // Rides out Resend's 10-a-second limit — see provider-fetch.ts.
  const response = await fetchWithRateLimitRetry("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to, subject, html }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Failed to send email via Resend (${response.status}): ${detail}`);
  }

  return "sent";
}

/**
 * Escapes text destined for an HTML email body.
 *
 * Everything interpolated into a template below is user- or
 * operator-supplied — a person's name, a business's name — so it goes
 * through here first. An apostrophe in "Jordan O'Neill" is the common
 * case; a `<` in a business name is the one that would matter.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The back office's own colours (service-finder-frontend-bo's
 * src/styles/index.css), inlined — email clients strip <style> blocks and
 * know nothing about CSS variables.
 */
const BRAND = {
  page: "#EFEBE4",
  surface: "#FDFBF7",
  ink: "#16150F",
  muted: "#57534A",
  border: "#E2DCD2",
  accent: "#0E7C66",
  onAccent: "#FFFFFF",
};

/** The back office's typefaces, with the fallbacks most email clients will actually use. */
const SANS = "'Libre Franklin',Helvetica,Arial,sans-serif";
const MONO = "'Roboto Mono',Menlo,Consolas,monospace";

export interface EmailTemplate {
  /** Large heading inside the card — the one thing the reader should take away. */
  heading: string;
  /** Body paragraphs, in order. Plain text; escaped for you. */
  paragraphs: string[];
  /** Optional primary action. */
  action?: { label: string; url: string };
  /** Small print under the action — an expiry note, a "didn't expect this?" line. */
  footnote?: string;
}

/**
 * Wraps a message in the app's letterhead: wordmark, a card, one primary
 * button, and a footer.
 *
 * Built as a table with inline styles on purpose. Email clients are not
 * browsers — Outlook renders through Word, Gmail strips `<style>` blocks
 * and anything it thinks is layout — so flexbox, classes and CSS
 * variables are all unavailable, and a table with inline attributes is
 * still the only thing that lands the same way everywhere.
 *
 * Nothing calls this yet — it is here so the first module that sends
 * email starts from the letterhead rather than a bare `<p>`.
 */
export function renderEmail({ heading, paragraphs, action, footnote }: EmailTemplate): string {
  const body = paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:${BRAND.ink};">${escapeHtml(text)}</p>`,
    )
    .join("");

  const button = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
         <tr><td style="border-radius:999px;background:${BRAND.accent};">
           <a href="${action.url}" style="display:inline-block;padding:14px 24px;font-family:${SANS};font-size:15px;font-weight:600;color:${BRAND.onAccent};text-decoration:none;">${escapeHtml(action.label)}</a>
         </td></tr>
       </table>`
    : "";

  // The raw URL is printed under the button as well: plenty of clients
  // mangle or strip links, and a copy-pasteable address is the difference
  // between "this email is broken" and a five-second workaround.
  const fallbackLink = action
    ? `<p style="margin:16px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${BRAND.muted};word-break:break-all;">Or paste this into your browser:<br />${action.url}</p>`
    : "";

  const small = footnote
    ? `<p style="margin:20px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${BRAND.muted};">${escapeHtml(footnote)}</p>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${BRAND.page};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr><td style="padding:0 4px 18px;">
          <span style="font-family:${SANS};font-size:22px;font-weight:700;letter-spacing:-0.04em;color:${BRAND.ink};">ServiceFinder</span>
          <span style="font-family:${MONO};font-size:10px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.accent};">&nbsp;Backoffice</span>
        </td></tr>
        <tr><td style="background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:20px;padding:32px;">
          <h1 style="margin:0 0 18px;font-family:${SANS};font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-0.03em;color:${BRAND.ink};">${escapeHtml(heading)}</h1>
          ${body}
          ${button}
          ${fallbackLink}
          ${small}
        </td></tr>
        <tr><td style="padding:18px 4px 0;">
          <p style="margin:0;font-family:${SANS};font-size:11px;line-height:1.5;color:${BRAND.muted};">Sent by ServiceFinder. If you weren&#39;t expecting this, you can ignore it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
