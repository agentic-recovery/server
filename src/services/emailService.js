/**
 * services/emailService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Nodemailer-based email service with responsive HTML templates.
 *
 * Supported emails:
 *   - welcomeUser(user)
 *   - welcomeProvider(provider)
 *   - bookingConfirmedUser(user, request, provider)
 *   - newJobProvider(provider, request)
 *   - statusUpdateUser(user, request, status)
 *   - statusUpdateProvider(provider, request, status)
 *
 * Set SMTP_* env vars. Falls back to Ethereal (test) when not configured.
 */

const nodemailer = require("nodemailer");

// ─── Transporter (lazy init) ──────────────────────────────────────────────────

let _transporter = null;

const getTransporter = async () => {
  if (_transporter) return _transporter;

  if (process.env.SMTP_HOST) {
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log("[email] SMTP transporter ready");
  } else {
    // Auto Ethereal test account — emails viewable at https://ethereal.email
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log("[email] Using Ethereal test transporter:", testAccount.user);
  }

  return _transporter;
};

// ─── Brand constants ──────────────────────────────────────────────────────────

const BRAND = {
  name:    process.env.EMAIL_FROM_NAME || "AI Recovery",
  from:    process.env.EMAIL_FROM_ADDRESS || "no-reply@airecovery.co.uk",
  primary: "#5B5BD6",
  dark:    "#0A0A1A",
  light:   "#F4F4FF",
};

// ─────────────────────────────────────────────────────────────────────────────
//  HTML template helpers
// ─────────────────────────────────────────────────────────────────────────────

const baseLayout = (title, bodyContent) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:${BRAND.dark};padding:28px 32px;text-align:center;">
            <div style="display:inline-flex;align-items:center;gap:8px;">
              <div style="width:36px;height:36px;background:${BRAND.primary};border-radius:8px;display:inline-block;line-height:36px;text-align:center;font-size:18px;">⚡</div>
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">${BRAND.name}</span>
            </div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px;">
            ${bodyContent}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f8ff;padding:20px 32px;border-top:1px solid #e8e8f0;text-align:center;">
            <p style="margin:0;color:#888;font-size:12px;line-height:1.6;">
              © ${new Date().getFullYear()} ${BRAND.name} · Roadside Recovery Platform<br />
              <a href="#" style="color:${BRAND.primary};text-decoration:none;">Unsubscribe</a> ·
              <a href="#" style="color:${BRAND.primary};text-decoration:none;">Privacy Policy</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

const h1 = (text) => `<h1 style="margin:0 0 8px;color:#0A0A1A;font-size:24px;font-weight:700;letter-spacing:-0.4px;">${text}</h1>`;
const p  = (text) => `<p  style="margin:0 0 16px;color:#444;font-size:15px;line-height:1.7;">${text}</p>`;
const btn = (text, href = "#") => `
  <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
    <tr><td style="border-radius:8px;background:${BRAND.primary};">
      <a href="${href}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">${text}</a>
    </td></tr>
  </table>`;

const infoCard = (rows) => `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
    style="background:#f8f8ff;border-radius:8px;border:1px solid #e4e4f0;margin:20px 0;overflow:hidden;">
    ${rows.map(([label, value]) => `
      <tr>
        <td style="padding:10px 16px;color:#666;font-size:13px;font-weight:600;width:40%;border-bottom:1px solid #eeeefc;">${label}</td>
        <td style="padding:10px 16px;color:#222;font-size:13px;border-bottom:1px solid #eeeefc;">${value}</td>
      </tr>`).join("")}
  </table>`;

const statusBadge = (status) => {
  const colors = {
    accepted:   ["#ECFDF5", "#059669", "✅ Accepted"],
    on_the_way: ["#EFF6FF", "#2563EB", "🚗 On the Way"],
    completed:  ["#F0FDF4", "#16A34A", "🎉 Completed"],
    cancelled:  ["#FEF2F2", "#DC2626", "❌ Cancelled"],
    matched:    ["#EEF2FF", "#4F46E5", "🔍 Matched"],
  };
  const [bg, color, label] = colors[status] || ["#F3F4F6", "#374151", status];
  return `<span style="display:inline-block;padding:4px 12px;background:${bg};color:${color};border-radius:20px;font-size:13px;font-weight:600;">${label}</span>`;
};

// ─────────────────────────────────────────────────────────────────────────────
//  Email templates
// ─────────────────────────────────────────────────────────────────────────────

const templates = {

  welcomeUser: (user) => ({
    subject: `Welcome to ${BRAND.name}, ${user.name}! 👋`,
    html: baseLayout(`Welcome to ${BRAND.name}`, `
      ${h1(`Hi ${user.name}, welcome aboard!`)}
      ${p("You're now set up with <strong>AI Recovery</strong> — the fastest way to get roadside help when you need it.")}
      ${p("Next time you break down, open the chat and tell us what happened. Our AI will find the nearest provider and have help on the way in minutes.")}
      ${btn("Open the App")}
      ${p('If you have any questions, reply to this email — we\'re happy to help.')}
    `),
  }),

  welcomeProvider: (provider) => ({
    subject: `Welcome to ${BRAND.name} Provider Network! ⚡`,
    html: baseLayout(`Welcome, ${provider.companyName}`, `
      ${h1(`Welcome, ${provider.companyName}!`)}
      ${p("Your account has been created and is currently <strong>pending verification</strong>. Our team will review your documentation and approve your account shortly.")}
      ${infoCard([
        ["Company",  provider.companyName],
        ["Email",    provider.email],
        ["Status",   "Pending Verification"],
      ])}
      ${p("Once approved, you'll start receiving job requests matched by our AI engine — no manual bidding, no missed jobs.")}
      ${btn("Go to Dashboard")}
    `),
  }),

  bookingConfirmedUser: (user, request, provider) => ({
    subject: `Booking Confirmed — Help is on the way! ✅`,
    html: baseLayout("Booking Confirmed", `
      ${h1("Your booking is confirmed!")}
      ${p("Great news — we've matched you with a recovery provider. They'll be in touch shortly.")}
      ${infoCard([
        ["Reference",    request._id.toString().slice(-8).toUpperCase()],
        ["Provider",     provider.companyName],
        ["Contact",      provider.contactNumber || "—"],
        ["Vehicle",      request.vehicleType],
        ["Location",     request.userLocation?.address || "Shared via app"],
        ["Estimated ETA", `${request.providerETA || "—"} minutes`],
        ["Price",        request.finalPrice ? `£${request.finalPrice}` : "TBC"],
      ])}
      ${p("If your situation changes or you need to cancel, please contact the provider directly using the number above.")}
    `),
  }),

  newJobProvider: (provider, request) => ({
    subject: `New Job Request — ${request.vehicleType} near ${request.userLocation?.address || "your area"}`,
    html: baseLayout("New Job Request", `
      ${h1("You have a new job request! 🔔")}
      ${p("The AI has matched you with a breakdown request in your service area.")}
      ${infoCard([
        ["Job ID",     request._id.toString().slice(-8).toUpperCase()],
        ["Vehicle",    request.vehicleType],
        ["Urgency",    request.urgencyLevel],
        ["Location",   request.userLocation?.address || "GPS coordinates shared"],
        ["Price",      request.finalPrice ? `£${request.finalPrice}` : "Negotiated"],
        ["Distance",   request.distanceKm ? `${request.distanceKm} km` : "—"],
      ])}
      ${btn("View in Dashboard")}
      ${p("Log in to your dashboard to accept or decline. Auto-expires in 10 minutes.")}
    `),
  }),

  statusUpdateUser: (user, request, newStatus) => {
    const messages = {
      accepted:   { title: "Provider Accepted! 🙌",         body: "Your recovery provider has accepted the job and will contact you shortly.",                emoji: "✅" },
      on_the_way: { title: "Help is On the Way! 🚗",        body: `Your driver is on the way. Estimated arrival: ${request.providerETA || "—"} minutes.`,     emoji: "🚗" },
      completed:  { title: "Job Completed! 🎉",             body: "Your recovery is complete. We hope everything went smoothly. Thank you for using AI Recovery!", emoji: "🎉" },
      cancelled:  { title: "Job Cancelled",                 body: "Your recovery request has been cancelled. Please contact us if you still need help.",        emoji: "❌" },
    };
    const { title, body, emoji } = messages[newStatus] || { title: "Update", body: `Status: ${newStatus}`, emoji: "ℹ️" };
    return {
      subject: `${emoji} ${title} — Job #${request._id.toString().slice(-8).toUpperCase()}`,
      html: baseLayout(title, `
        <div style="text-align:center;padding:16px 0;">
          <span style="font-size:48px;">${emoji}</span>
        </div>
        ${h1(title)}
        ${p(body)}
        ${infoCard([
          ["Job Reference", request._id.toString().slice(-8).toUpperCase()],
          ["Status",        statusBadge(newStatus)],
          ["Vehicle",       request.vehicleType],
        ])}
      `),
    };
  },

  statusUpdateProvider: (provider, request, newStatus) => ({
    subject: `Job #${request._id.toString().slice(-8).toUpperCase()} status: ${newStatus}`,
    html: baseLayout("Job Status Update", `
      ${h1(`Job #${request._id.toString().slice(-8).toUpperCase()} Updated`)}
      ${p(`The status of this job has been updated to:`)}
      <div style="text-align:center;padding:12px;">${statusBadge(newStatus)}</div>
      ${infoCard([
        ["Job ID",   request._id.toString().slice(-8).toUpperCase()],
        ["Vehicle",  request.vehicleType],
        ["Location", request.userLocation?.address || "—"],
        ["Price",    request.finalPrice ? `£${request.finalPrice}` : "—"],
      ])}
    `),
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
//  Public send helpers
// ─────────────────────────────────────────────────────────────────────────────

const send = async (to, templateData) => {
  try {
    const transport = await getTransporter();
    const info = await transport.sendMail({
      from:    `"${BRAND.name}" <${BRAND.from}>`,
      to,
      subject: templateData.subject,
      html:    templateData.html,
    });
    console.log(`[email] Sent "${templateData.subject}" to ${to} — id: ${info.messageId}`);
    if (info.envelope && nodemailer.getTestMessageUrl && nodemailer.getTestMessageUrl(info)) {
      console.log(`[email] Preview: ${nodemailer.getTestMessageUrl(info)}`);
    }
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
};

// ─── Admin email templates ────────────────────────────────────────────────────

const adminTemplates = {
  providerApproved: (provider) => ({
    subject: "✅ Your AI Recovery Provider Account is Approved!",
    html: baseLayout("Account Approved", `
      ${h1(`Welcome aboard, ${provider.companyName}!`)}
      ${p("Great news — your provider account has been <strong>approved</strong> by our team. You can now log in and start receiving job requests.")}
      ${btn("Go to Dashboard")}
      ${p("If you have any questions, please contact support.")}
    `),
  }),

  providerRejected: (provider, reason) => ({
    subject: "Account Verification Update — AI Recovery",
    html: baseLayout("Account Update", `
      ${h1("Verification Unsuccessful")}
      ${p(`Hi ${provider.companyName}, unfortunately your provider account verification was <strong>not approved</strong>.`)}
      ${infoCard([["Reason", reason || "Documentation did not meet our requirements."]])}
      ${p("Please update your documents and contact support if you believe this is an error.")}
    `),
  }),

  accountBlocked: (name, role) => ({
    subject: "⚠️ Your AI Recovery Account Has Been Suspended",
    html: baseLayout("Account Suspended", `
      ${h1("Account Suspended")}
      ${p(`Hi ${name}, your ${role} account has been <strong>temporarily suspended</strong> by our admin team.`)}
      ${p("Please contact support at support@airecovery.co.uk for more information or to appeal this decision.")}
    `),
  }),

  accountUnblocked: (name, role) => ({
    subject: "✅ Your AI Recovery Account Has Been Reinstated",
    html: baseLayout("Account Reinstated", `
      ${h1("Account Reinstated")}
      ${p(`Hi ${name}, your ${role} account has been <strong>reinstated</strong>. You can now log in and use the platform as normal.`)}
      ${btn("Log In Now")}
    `),
  }),
};

const sendProviderApproved  = (provider)         => send(provider.email, adminTemplates.providerApproved(provider));
const sendProviderRejected  = (provider, reason) => send(provider.email, adminTemplates.providerRejected(provider, reason));
const sendAccountBlocked    = (email, name, role)=> send(email, adminTemplates.accountBlocked(name, role));
const sendAccountUnblocked  = (email, name, role)=> send(email, adminTemplates.accountUnblocked(name, role));

const sendWelcomeUser     = (user)                           => send(user.email,     templates.welcomeUser(user));
const sendWelcomeProvider = (provider)                       => send(provider.email, templates.welcomeProvider(provider));
const sendBookingConfirmedUser = (user, request, provider)   => send(user.email,     templates.bookingConfirmedUser(user, request, provider));
const sendNewJobProvider  = (provider, request)              => send(provider.email, templates.newJobProvider(provider, request));
const sendStatusUpdateUser     = (user, request, status)     => send(user.email,     templates.statusUpdateUser(user, request, status));
const sendStatusUpdateProvider = (provider, request, status) => send(provider.email, templates.statusUpdateProvider(provider, request, status));

module.exports = {
  sendWelcomeUser,
  sendWelcomeProvider,
  sendBookingConfirmedUser,
  sendNewJobProvider,
  sendStatusUpdateUser,
  sendStatusUpdateProvider,
  sendProviderApproved,
  sendProviderRejected,
  sendAccountBlocked,
  sendAccountUnblocked,
};
