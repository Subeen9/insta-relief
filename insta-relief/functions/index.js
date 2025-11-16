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
// 2. SMTP Email Utility
// -----------------------------------------------------
async function sendEmail(apiKey, to, sender, subject, htmlBody, textBody) {
  console.log('📬 Sending email via SMTP2GO...');
  
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

  const responseData = await response.json();
  
  if (!response.ok) {
    const errorDetail = responseData.data ? JSON.stringify(responseData.data) : JSON.stringify(responseData);
    throw new Error(`SMTP2GO error (${response.status}): ${errorDetail}`);
  }

  console.log('✉️ SMTP2GO Response:', JSON.stringify(responseData));
  return responseData;
}

// -----------------------------------------------------
// 3. Core Payout & Alert Helpers
// -----------------------------------------------------

function shouldSendPayout(severity) {
  const sev = (severity || "").toLowerCase();
  return sev === "extreme" || sev === "severe";
}

function mapAreaToZips(areaDesc) {
  if (!areaDesc) return [];
  const area = areaDesc.toLowerCase();
  return Object.entries(zipToCounty)
    .filter(([key, value]) => area.includes(key.toLowerCase()))
    .map(([key, zip]) => zip);
}

async function handleUserAlert(doc, alert, pay) {
  console.log('=== ENTERING handleUserAlert ===');
  
  // Get API key from environment variable only (functions.config() deprecated in v7+)
  const smtpApiKey = process.env.SMTP2GO_API_KEY;
  
  console.log('🔑 SMTP API Key Status:', smtpApiKey ? '✓ Found' : '✗ Missing');

  if (!smtpApiKey) {
    const errorMsg = "❌ SMTP API key missing! Set SMTP2GO_API_KEY in .env file";
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  const user = doc.data();
  console.log('👤 Processing user:', user.email);
  
  const name = user.name || user.email.split("@")[0];

  const {
    event,
    severity,
    headline,
    description,
    areaDesc,
    id: alertId
  } = alert.properties;

  console.log('📋 Alert details:', { event, severity, alertId });

  // Rate limit check
  const lastSent = user.lastAlertTimestamp || 0;
  const thirtyMinutes = 30 * 60 * 1000;
  const timeSinceLastAlert = Date.now() - lastSent;
  
  console.log('⏰ Rate limit check:', {
    lastSent: lastSent ? new Date(lastSent).toISOString() : 'Never',
    timeSinceLastMins: Math.round(timeSinceLastAlert / 60000),
    willSkip: timeSinceLastAlert < thirtyMinutes
  });
  
  if (timeSinceLastAlert < thirtyMinutes) {
    console.log(`⏳ SKIPPING ${user.email} (rate limited - last alert ${Math.round(timeSinceLastAlert / 60000)} mins ago)`);
    return;
  }

  console.log(`📧 Preparing email for ${user.email}`);

  let subject = `⚠️ Weather Alert: ${event} (${severity})`;
  let html = `
    <h2 style="color:red;">${headline}</h2>
    <p>${description}</p>
    <p><b>Severity:</b> ${severity}</p>
    <p><b>Area:</b> ${areaDesc}</p>
  `;

  if (pay) {
    subject = `🚨 Emergency Fund Released: ${event}`;
    html += `<p><strong>$100 has been released to your emergency fund.</strong></p>`;
    console.log(`💰 Processing payout for ${user.email}`);
    
    await db.runTransaction(async (t) => {
      const snap = await t.get(doc.ref);
      const balance = snap.data().balance || 0;
      t.update(doc.ref, {
        balance: balance + 100,
        status: "PAID",
        lastPayout: new Date().toISOString(),
      });
    });
    console.log(`✅ Payout completed for ${user.email}`);
  }

  console.log(`📝 Updating lastAlertTimestamp for ${user.email}`);
  await doc.ref.update({
    lastAlertTimestamp: Date.now(),
    lastAlertId: alertId,
  });

  console.log(`📤 Sending email to ${user.email}...`);
  
  const result = await sendEmail(
    smtpApiKey,
    [`${name} <${user.email}>`],
    "Disaster Alert <niraj.bhatta@selu.edu>",
    subject,
    html,
    `${event} alert (${severity}) in ${areaDesc}. ${description}`
  );
  
  console.log(`✅ Email sent successfully to ${user.email}`);
  console.log('=== EXITING handleUserAlert ===');
}

async function handleZipAlert(zip, alert, pay) {
  console.log(`🔍 Looking up users for ZIP ${zip}...`);
  
  const users = await db.collection("users")
    .where("zip", "==", zip)
    .where("status", "==", "ACTIVE")
    .get();

  if (users.empty) {
    console.log(`ℹ️ No active users found for ZIP ${zip}`);
    return;
  }

  console.log(`👥 Found ${users.size} user(s) for ZIP ${zip}`);

  const results = await Promise.allSettled(
    users.docs.map(doc => handleUserAlert(doc, alert, pay))
  );

  // Log results
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      console.log(`✅ User ${index + 1} processed successfully`);
    } else {
      console.error(`❌ User ${index + 1} failed:`, result.reason?.message || result.reason);
    }
  });

  console.log(`✅ ZIP ${zip} processed (${users.size} users)`);
}

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

    const processed = await db.collection("processedAlerts").doc(alertId).get();
    if (processed.exists) {
      console.log(`⏭️ Skipping known alert: ${alertId}`);
      continue;
    }

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
// 4. Exported Cloud Functions
// -----------------------------------------------------

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
        timestamp: new Date().toISOString()
      });
    }
  });

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
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
  });

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
            : "Never",
          canReceiveAlert: !data.lastAlertTimestamp || 
            (Date.now() - data.lastAlertTimestamp > 30 * 60 * 1000)
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

exports.disaster = functions.https.onCall(async (data, context) => {
    const { zip, severity = "Extreme" } = data;

    if (!zip) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "ZIP code is required"
      );
    }

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
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: `You are the Admin Automation Agent. You help create fake disaster scenarios, analyze data, and support admin workflows. Always output clean JSON when possible.\n\nQuery: ${query}`
          }
        ]
      });

      const responseText = response.content.map(block => block.text).join('\n');
      
      return res.json({ response: responseText });

    } catch (error) {
      console.error("Claude Error:", error);
      return res.status(500).json({ error: error.message });
    }
  });