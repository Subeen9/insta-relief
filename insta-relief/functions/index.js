const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

// Emulator setup
// if (process.env.FIREBASE_EMULATOR_HUB) {
//   process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8094";
//   console.log("Connected Firestore to local emulator on 127.0.0.1:8094");
// }

const db = admin.firestore();

// if (process.env.FIRESTORE_EMULATOR_HOST) {
//   db.settings({ host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
// }

// Send email with SMTP2GO
async function sendEmail(apiKey, to, sender, subject, htmlBody, textBody) {
  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Smtp2go-Api-Key": apiKey,
    },
    body: JSON.stringify({
      to,
      sender,
      subject,
      html_body: htmlBody,
      text_body: textBody,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`SMTP2GO API error: ${JSON.stringify(errorData)}`);
  }

  return response.json();
}

// Cloud Function (onCall)
exports.disaster = functions.https.onCall(async (request, context) => {
  const zip = request.data.zip;
  if (!zip) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Zip code is required"
    );
  }

  console.log(`Searching for users in ZIP ${zip}, status=ACTIVE`);

  // SMTP config
  const smtpConfig = functions.config().smtp2go || {};
  if (!smtpConfig.api_key) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Missing SMTP2GO API key"
    );
  }

  // Get user snapshots
  const userRef = db.collection("users");
  const userSnap = await userRef
    .where("zip", "==", zip)
    .where("status", "==", "ACTIVE")
    .get();

  console.log(`Found ${userSnap.size} user(s)`);

  if (userSnap.empty) {
    return { message: `No active user found in ${zip}` };
  }

  const result = [];
  const errors = [];

  for (const user of userSnap.docs) {
    const userData = user.data();
    const email = userData.email;

    const name =
      userData.name ||
      userData.firstName ||
      (typeof email === "string" ? email.split("@")[0] : "Customer");

    console.log(`Processing payout for ${email}`);

    try {
      // Update user balance + mark as paid
      await user.ref.update({
        balance: (userData.balance || 0) + 100,
        status: "PAID",
        lastPayout: new Date().toISOString(),
      });

      // Send email
      const emailResponse = await sendEmail(
        smtpConfig.api_key,
        [`${name} <${email}>`],
        "Disaster Alert <subin.bista@selu.edu>",
        "🚨 Flood Alert - Emergency Fund Released",
        `
          <h2 style="color:red;">🚨 Flood Alert</h2>
          <p>Dear ${name},</p>
          <p>Your micro-insurance policy has been triggered for ZIP <b>${zip}</b>.</p>
          <p><strong>$100 has been released to your emergency fund.</strong></p>
          <p>Current balance: $${(userData.balance || 0) + 100}</p>
          <p>Stay safe,<br/>Disaster Alert System</p>
        `,
        `Dear ${name},\n\nYour policy has been triggered for ZIP ${zip}. $100 has been released to your emergency fund.\n\nCurrent balance: $${(userData.balance || 0) + 100}\n\nStay safe.`
      );

      console.log(`Email sent to ${email}`, emailResponse);
      result.push(email);
    } catch (err) {
      console.error(`❌ Failed to process ${email}:`, err);
      errors.push({
        email,
        error: err.message || "Unknown error",
      });
    }
  }

  return {
    message: `Triggered payouts for ${result.length} user(s).`,
    emails: result,
    errors: errors.length > 0 ? errors : undefined,
  };
});
