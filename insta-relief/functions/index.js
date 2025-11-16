const functions = require("firebase-functions");
const admin = require("firebase-admin");
const {Anthropic} = require("@anthropic-ai/sdk");

admin.initializeApp();

const db = admin.firestore();

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
    const err = await response.json();
    throw new Error(`SMTP2GO error: ${JSON.stringify(err)}`);
  }

  return response.json();
}

exports.disaster = functions.https.onCall(async (request, context) => {
  const zip = request.data.zip;
  if (!zip) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Zip code is required"
    );
  }

  console.log(`Looking for users in ${zip}`);

  const smtpConfig = functions.config().smtp2go || {};
  if (!smtpConfig.api_key) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Missing SMTP API key"
    );
  }

  const userSnap = await db
    .collection("users")
    .where("zip", "==", zip)
    .where("status", "==", "ACTIVE")
    .get();

  if (userSnap.empty) {
    return { message: `No active users in ${zip}` };
  }

  const result = [];
  const errors = [];

  for (const user of userSnap.docs) {
    const userData = user.data();
    const email = userData.email;
    const name =
      userData.name ||
      userData.firstName ||
      email.split("@")[0];

    try {
      await user.ref.update({
        balance: (userData.balance || 0) + 100,
        status: "PAID",
        lastPayout: new Date().toISOString(),
      });

      await sendEmail(
        smtpConfig.api_key,
        [`${name} <${email}>`],
        "Disaster Alert <your@email>",
        "🚨 Flood Alert - Emergency Fund Released",
        `<h2>Flood Alert</h2><p>$100 added.</p>`,
        `Flood Alert: $100 added.`
      );

      result.push(email);
    } catch (err) {
      errors.push({ email, error: err.message });
    }
  }

  return {
    message: `Payouts sent to ${result.length} user(s).`,
    emails: result,
    errors: errors.length ? errors : undefined,
  };
});

// ===================================================================
// ⭐ NEW — CLAUDE AI ADMIN AGENT
// ===================================================================

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

exports.adminAgent = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");

  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet",
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `
            You are the Admin Automation Agent.
            You help create fake disaster scenarios,
            analyze data, and support admin workflows.
            Always output clean JSON when possible.
          `
        },
        {
          role: "user",
          content: query
        }
      ]
    });

    return res.json({ response: response.content });

  } catch (error) {
    console.error("Claude Error:", error);
    return res.status(500).json({ error: error.message });
  }
});
