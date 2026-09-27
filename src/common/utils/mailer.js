'use strict';

const nodemailer = require('nodemailer');
const config     = require('../../config');
const logger     = require('../logger');

// ─── Transporter ─────────────────────────────────────────────────────────────
// Created lazily so missing SMTP config doesn't crash startup.

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const { host, port, secure, user, pass } = config.email;

  if (!user || !pass) {
    logger.warn('SMTP credentials not configured — emails will not be sent');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return _transporter;
}

// ─── Send helper ─────────────────────────────────────────────────────────────

async function sendMail({ to, subject, html, text }) {
  const transporter = getTransporter();

  if (!transporter) {
    logger.warn({ to, subject }, 'Email skipped — SMTP not configured');
    return { skipped: true };
  }

  const info = await transporter.sendMail({
    from: config.email.from,
    to,
    subject,
    text,
    html,
  });

  logger.info({ to, subject, messageId: info.messageId }, 'Email sent');
  return info;
}

// ─── Templates ───────────────────────────────────────────────────────────────

async function sendPasswordResetByAdmin({ to, fullName, newPassword, resetBy }) {
  const subject = 'Your CPIMS password has been reset';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#166534;padding:28px 32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:rgba(255,255,255,0.15);border-radius:10px;width:40px;height:40px;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;font-weight:900;color:#ffffff;">C</span>
                  </td>
                  <td style="padding-left:12px;">
                    <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">CPIMS</p>
                    <p style="margin:0;font-size:11px;color:#86efac;">Coffee Production &amp; Inventory Management</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Password Reset</h1>
              <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Hi ${fullName},</p>
              <p style="margin:0 0 24px;font-size:14px;color:#334155;line-height:1.6;">
                Your CPIMS account password has been reset by an administrator (<strong>${resetBy}</strong>).
                Use the temporary password below to sign in, then change it immediately.
              </p>

              <!-- Password box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#16a34a;">Temporary Password</p>
                    <p style="margin:0;font-size:22px;font-weight:700;font-family:monospace;letter-spacing:0.12em;color:#14532d;">${newPassword}</p>
                  </td>
                </tr>
              </table>

              <!-- Warning -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
                    <p style="margin:0;font-size:13px;color:#92400e;">
                      ⚠ <strong>Change this password</strong> after your first login. Do not share it with anyone.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#94a3b8;">
                If you did not expect this email or believe it was sent in error, contact your system administrator immediately.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">
                © ${new Date().getFullYear()} CPIMS · This is an automated message, do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Hi ${fullName},\n\nYour CPIMS password has been reset by an administrator (${resetBy}).\n\nTemporary password: ${newPassword}\n\nPlease sign in and change your password immediately.\n\nCPIMS`;

  return sendMail({ to, subject, html, text });
}

async function sendForgotPassword({ to, fullName, resetUrl, expiresInMinutes }) {
  const subject = 'Reset your CPIMS password';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <tr>
            <td style="background:#166534;padding:28px 32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:rgba(255,255,255,0.15);border-radius:10px;width:40px;height:40px;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;font-weight:900;color:#ffffff;">C</span>
                  </td>
                  <td style="padding-left:12px;">
                    <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">CPIMS</p>
                    <p style="margin:0;font-size:11px;color:#86efac;">Coffee Production &amp; Inventory Management</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Reset Your Password</h1>
              <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Hi ${fullName},</p>
              <p style="margin:0 0 24px;font-size:14px;color:#334155;line-height:1.6;">
                We received a request to reset the password for your CPIMS account.
                Click the button below to choose a new password.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}"
                      style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;font-size:12px;color:#94a3b8;word-break:break-all;">${resetUrl}</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
                    <p style="margin:0;font-size:13px;color:#92400e;">
                      ⚠ This link expires in <strong>${expiresInMinutes} minutes</strong>.
                      If you didn't request a password reset, ignore this email — your password won't change.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">
                © ${new Date().getFullYear()} CPIMS · This is an automated message, do not reply.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Hi ${fullName},\n\nReset your CPIMS password by visiting:\n${resetUrl}\n\nThis link expires in ${expiresInMinutes} minutes.\n\nIf you didn't request this, ignore this email.\n\nCPIMS`;

  return sendMail({ to, subject, html, text });
}

module.exports = { sendMail, sendPasswordResetByAdmin, sendForgotPassword };