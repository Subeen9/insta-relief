const dotenv = require("dotenv");
dotenv.config();

const fetch = require("node-fetch");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Anthropic } = require("@anthropic-ai/sdk");
const zipToCounty = require("./data/zip_to_county.json");

// Initialization
admin.initializeApp();
const db = admin.firestore();

// -----------------------------------------------------
// 2. SMTP Email Utility (Defined Inline)
// -----------------------------------------------------
/**
 * Sends an email using the SMTP2GO API.
 * This replaces the imported sendEmail from "./utils/email".
 */
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
    // Use the error message from the response if available
    const errorDetail = err.data ? JSON.stringify(err.data) : JSON.stringify(err);
    throw new Error(`SMTP2GO error: ${errorDetail}`);
  }

  return response.json();
}

// -----------------------------------------------------
// 3. Core Payout & Alert Helpers
// -----------------------------------------------------

/**
 * Helper: Should we send payout?
 */
function shouldSendPayout(severity) {
  const sev = (severity || "").toLowerCase();
  return sev === "extreme" || sev === "severe";
}

/**
 * Convert NOAA areaDesc → list of ZIPs
 */
function mapAreaToZips(areaDesc) {
  if (!areaDesc) return [];

  const area = areaDesc.toLowerCase();

  // NOTE: This assumes zipToCounty maps county names (keys) to ZIPs (values).
  // If zipToCounty maps ZIPs (keys) to county names (values), the filter logic needs adjustment.
  // Assuming the original logic intended to check if the areaDesc includes a known key (ZIP or County name)
  return Object.entries(zipToCounty)
    .filter(([key, value]) => area.includes(key.toLowerCase())) // Filter by key (County/Area name)
    .map(([key, zip]) => zip); // Map to the ZIP code (value)
}

/**
 * Process a single user for a given alert
 */
async function handleUserAlert(doc, alert, pay) {
  // Use process.env for the key, as it's the standard way to access Firebase Environment configuration
  const smtpApiKey = functions.config().smtp2go?.api_key || process.env.SMTP2GO_API_KEY;

  if (!smtpApiKey) {
    console.error("❌ SMTP API key missing! Configure with: firebase functions:config:set smtp2go.api_key=YOUR_KEY");
    return;
  }

  const user = doc.data();
  const name = user.name || user.email.split("@")[0];

  const {
    event,
    severity,
    headline,
    description,
    areaDesc,
    id: alertId
  } = alert.properties;

  // Prevent user spam — only 1 alert every 30 mins
  const lastSent = user.lastAlertTimestamp || 0;
  if (Date.now() - lastSent < 30 * 60 * 1000) {
    console.log(`⏳ Skipping ${user.email} (rate limited)`);
    return;
  }

  let subject = `⚠️ Weather Alert: ${event} (${severity})`;
  let html = `
    <h2 style="color:red;">${headline}</h2>
    <p>${description}</p>
    <p><b>Severity:</b> ${severity}</p>
    <p><b>Area:</b> ${areaDesc}</p>
  `;

  // Use Firestore transaction for payout updates
  if (pay) {
    subject = `🚨 Emergency Fund Released: ${event}`;
    html += `<p><strong>$100 has been released to your emergency fund.</strong></p>`;

    await db.runTransaction(async (t) => {
      const snap = await t.get(doc.ref);
      const balance = snap.data().balance || 0;
      t.update(doc.ref, {
        balance: balance + 100,
        status: "PAID",
        lastPayout: new Date().toISOString(),
      });
    });
  }

  // Update "last alert info" to prevent spam
  await doc.ref.update({
    lastAlertTimestamp: Date.now(),
    lastAlertId: alertId,
  });

  try {
    await sendEmail(
      smtpApiKey,
      [`${name} <${user.email}>`],
      "Disaster Alert <subin.bista@selu.edu>",
      subject,
      html,
      `${event} alert (${severity}) in ${areaDesc}. ${description}`
    );
    console.log(`✅ Email sent to ${user.email}`);
  } catch (err) {
    console.error("❌ Email failed for " + user.email, err.message);
  }
}

/**
 * Process all users in a ZIP for one alert
 */
async function handleZipAlert(zip, alert, pay) {
  const users = await db.collection("users")
    .where("zip", "==", zip)
    .where("status", "==", "ACTIVE")
    .get();

  if (users.empty) {
    console.log(`ℹ️ No active users found for ZIP ${zip}`);
    return;
  }

  // Parallel + fault-tolerant email sending
  await Promise.allSettled(
    users.docs.map(doc => handleUserAlert(doc, alert, pay))
  );

  console.log(`✅ ZIP ${zip} processed (${users.size} users)`);
}

/**
 * Shared logic for NOAA fetch and cron
 */
async function fetchNoaaAlertsHandler() {
  console.log("🌤️ Fetching NOAA active alerts…");

  const resp = await fetch("https://api.weather.gov/alerts/active");
  if (!resp.ok) {
    throw new Error(`NOAA API returned ${resp.status}: ${resp.statusText}`);
  }

  const data = await resp.json();
  
  if (!data.features || data.features.length === 0) {
    console.log("ℹ️ No active alerts from NOAA");
    return { message: "No active alerts", alertsProcessed: 0 };
  }

  console.log(`📋 Found ${data.features.length} active alerts`);
  let processedCount = 0;

  for (const alert of data.features) {
    const { id: alertId, severity, areaDesc } = alert.properties;

    // Prevent duplicate payouts/emails
    const processed = await db.collection("processedAlerts").doc(alertId).get();
    if (processed.exists) {
      console.log(`⏭️ Skipping known alert: ${alertId}`);
      continue;
    }

    // Mark alert as processed early (avoid race conditions)
    await db.collection("processedAlerts").doc(alertId).set({
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      severity,
      areaDesc
    });

    const zips = mapAreaToZips(areaDesc);
    console.log(`📍 Alert ${alertId} mapped to ${zips.length} ZIPs`);

    for (const zip of zips) {
      const pay = shouldSendPayout(severity);
      await handleZipAlert(zip, alert, pay);
    }
    
    processedCount++;
  }

  return { 
    message: `Processed ${processedCount} new alerts`, 
    alertsProcessed: processedCount 
  };
}


// -----------------------------------------------------
// 4. Exported Cloud Functions (HTTP & Callable)
// -----------------------------------------------------

/**
 * HTTP trigger - Fetches real NOAA alerts and sends emails
 */
exports.fetchNoaaAlerts = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  try {
    console.log("🚀 fetchNoaaAlerts HTTP endpoint called");
    const result = await fetchNoaaAlertsHandler();
    res.status(200).json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error in fetchNoaaAlerts:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DEMO ENDPOINT - Simulate a disaster for any ZIP code
 * Usage: GET/POST with ?zip=70401&severity=Extreme
 */
exports.simulateDisaster = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  try {
    const zip = req.query.zip || req.body?.zip || "70401"; 
    const severity = req.query.severity || req.body?.severity || "Extreme";
    const event = req.query.event || req.body?.event || "Hurricane";

    console.log(`🎭 Simulating ${event} (${severity}) for ZIP ${zip}`);

    const fakeAlert = {
      properties: {
        id: "demo-" + Date.now(),
        event: event,
        severity: severity,
        areaDesc: zipToCounty[zip] || `Area for ZIP ${zip}`,
        headline: `${event} Warning - Emergency Alert System Activated`,
        description: `This is a SIMULATED ${event} alert for demonstration purposes. A ${severity.toLowerCase()} weather event has been detected in your area.`,
      },
    };

    const pay = shouldSendPayout(severity);
    await handleZipAlert(zip, fakeAlert, pay);

    res.status(200).json({
      success: true,
      message: `Simulated ${event} alert processed for ZIP ${zip}`,
      payoutSent: pay,
      severity: severity,
      affectedZip: zip,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Error in simulateDisaster:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * TEST ENDPOINT - Check which users would be notified for a ZIP
 */
exports.checkUsers = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  try {
    const zip = req.query.zip || "70401";
    
    const users = await db.collection("users")
      .where("zip", "==", zip)
      .where("status", "==", "ACTIVE")
      .get();

    const userList = users.docs.map(doc => {
      const data = doc.data();
      return {
        email: data.email,
        name: data.name,
        balance: data.balance || 0,
        lastAlert: data.lastAlertTimestamp 
          ? new Date(data.lastAlertTimestamp).toISOString() 
          : "Never"
      };
    });

    res.status(200).json({
      success: true,
      zip: zip,
      userCount: userList.length,
      users: userList,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Error in checkUsers:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});


/**
 * Manual simulation (callable from frontend) - Handles both versions of the logic
 */
exports.disaster = functions.https.onCall(async (data, context) => {
  const { zip, severity = "Extreme" } = data;

  if (!zip) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "ZIP code is required"
    );
  }

  // --- LOGIC FROM THE FIRST BLOCK (Handle NOAA Style) ---
  const fakeAlert = {
    properties: {
      id: "sim-" + Date.now(),
      event: data.event || "Simulated Disaster",
      severity,
      areaDesc: data.areaDesc || zipToCounty[zip] || "Unknown",
      headline: data.headline || `Test Alert for ZIP ${zip}`,
      description: data.description || "Simulated alert.",
    },
  };

  const pay = shouldSendPayout(severity);
  await handleZipAlert(zip, fakeAlert, pay);

  return {
    message: `Simulated alert processed for ZIP ${zip} and payout sent: ${pay}`,
    payoutSent: pay,
  };
});


// -----------------------------------------------------
// 5. Claude AI Admin Agent
// -----------------------------------------------------

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

exports.adminAgent = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

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

    // The response content is an array of content blocks; extract the text.
    const responseText = response.content.map(block => block.text).join('\n');
    
    return res.json({ response: responseText });

  } catch (error) {
    console.error("Claude Error:", error);
    return res.status(500).json({ error: error.message });
  }
});