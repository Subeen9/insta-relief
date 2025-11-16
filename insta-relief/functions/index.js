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
  console.log('Sending email via SMTP2GO...');
  
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

  console.log('SMTP2GO Response:', JSON.stringify(responseData));
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
  
  const smtpApiKey = process.env.SMTP2GO_API_KEY;
  
  console.log('SMTP API Key Status:', smtpApiKey ? 'Found' : 'Missing');

  if (!smtpApiKey) {
    const errorMsg = "SMTP API key missing! Set SMTP2GO_API_KEY in .env file";
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  const user = doc.data();
  console.log('Processing user:', user.email);
  
  const name = user.name || user.email.split("@")[0];

  const {
    event,
    severity,
    headline,
    description,
    areaDesc,
    id: alertId
  } = alert.properties;

  console.log('Alert details:', { event, severity, alertId });

  // Rate limit check
  const lastSent = user.lastAlertTimestamp || 0;
  const thirtyMinutes = 30 * 60 * 1000;
  const timeSinceLastAlert = Date.now() - lastSent;
  
  console.log('Rate limit check:', {
    lastSent: lastSent ? new Date(lastSent).toISOString() : 'Never',
    timeSinceLastMins: Math.round(timeSinceLastAlert / 60000),
    willSkip: timeSinceLastAlert < thirtyMinutes
  });
  
  if (timeSinceLastAlert < thirtyMinutes) {
    console.log(`SKIPPING ${user.email} (rate limited)`);
    return;
  }

  console.log(`Preparing email for ${user.email}`);

  let subject = `Weather Alert: ${event} (${severity})`;
  let html = `
    <h2 style="color:red;">${headline}</h2>
    <p>${description}</p>
    <p><b>Severity:</b> ${severity}</p>
    <p><b>Area:</b> ${areaDesc}</p>
  `;

  if (pay) {
    subject = `Emergency Fund Released: ${event}`;
    html += `<p><strong>$100 has been released to your emergency fund.</strong></p>`;
    console.log(`Processing payout for ${user.email}`);
    
    await db.runTransaction(async (t) => {
      const snap = await t.get(doc.ref);
      const balance = snap.data().balance || 0;
      t.update(doc.ref, {
        balance: balance + 100,
        status: "PAID",
        lastPayout: new Date().toISOString(),
      });
    });
    console.log(`Payout completed for ${user.email}`);
  }

  console.log(`Updating lastAlertTimestamp for ${user.email}`);
  await doc.ref.update({
    lastAlertTimestamp: Date.now(),
    lastAlertId: alertId,
  });

  console.log(`Sending email to ${user.email}...`);
  
  await sendEmail(
    smtpApiKey,
    [`${name} <${user.email}>`],
    "Disaster Alert <niraj.bhatta@selu.edu>",
    subject,
    html,
    `${event} alert (${severity}) in ${areaDesc}. ${description}`
  );
  
  console.log(`Email sent successfully to ${user.email}`);
}

async function handleZipAlert(zip, alert, pay) {
  console.log(`Looking up users for ZIP ${zip}...`);
  
  const users = await db.collection("users")
    .where("zip", "==", zip)
    .where("status", "==", "ACTIVE")
    .get();

  if (users.empty) {
    console.log(`No active users found for ZIP ${zip}`);
    return;
  }

  console.log(`Found ${users.size} user(s) for ZIP ${zip}`);

  const results = await Promise.allSettled(
    users.docs.map(doc => handleUserAlert(doc, alert, pay))
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      console.log(`User ${index + 1} processed successfully`);
    } else {
      console.error(`User ${index + 1} failed:`, result.reason?.message || result.reason);
    }
  });

  console.log(`ZIP ${zip} processed (${users.size} users)`);
}

async function fetchNoaaAlertsHandler() {
  console.log("Fetching NOAA active alerts…");

  const resp = await fetch("https://api.weather.gov/alerts/active");
  if (!resp.ok) {
    throw new Error(`NOAA API returned ${resp.status}: ${resp.statusText}`);
  }

  const data = await resp.json();
  
  if (!data.features || data.features.length === 0) {
    console.log("No active alerts from NOAA");
    return { message: "No active alerts", alertsProcessed: 0 };
  }

  console.log(`Found ${data.features.length} active alerts`);
  let processedCount = 0;

  for (const alert of data.features) {
    const { id: alertId, severity, areaDesc } = alert.properties;

    const processed = await db.collection("processedAlerts").doc(alertId).get();
    if (processed.exists) {
      console.log(`Skipping known alert: ${alertId}`);
      continue;
    }

    await db.collection("processedAlerts").doc(alertId).set({
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      severity,
      areaDesc
    });

    const zips = mapAreaToZips(areaDesc);
    console.log(`Alert ${alertId} mapped to ${zips.length} ZIPs`);

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
    console.log("fetchNoaaAlerts HTTP endpoint called");
    const result = await fetchNoaaAlertsHandler();
    res.status(200).json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in fetchNoaaAlerts:", error);
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

    console.log(`Simulating ${event} (${severity}) for ZIP ${zip}`);

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
    console.error("Error in simulateDisaster:", error);
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
    console.error("Error in checkUsers:", error);
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

exports.sendCatastropheEmail = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  try {
    const { userEmail, userName, catastropheType, amount, location } = req.body;

    if (!userEmail || !userName || !catastropheType || !amount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: userEmail, userName, catastropheType, amount"
      });
    }

    const smtpApiKey = process.env.SMTP2GO_API_KEY;
    
    if (!smtpApiKey) {
      throw new Error("SMTP API key missing");
    }

    console.log(`Sending catastrophe email to ${userEmail}`);

    const subject = `Emergency Relief Payment Received - ${catastropheType}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color:#4CAF50;">Emergency Relief Payment Received</h2>
        <p>Dear ${userName},</p>
        <p>Your emergency relief payment has been successfully processed and deposited to your Phantom wallet.</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 5px 0;"><b>Disaster Type:</b> ${catastropheType}</p>
          <p style="margin: 5px 0;"><b>Location:</b> ${location}</p>
          <p style="margin: 5px 0;"><b>Amount Received:</b> <span style="color: #4CAF50; font-size: 18px; font-weight: bold;">$${amount}</span></p>
        </div>
        
        <p>The funds are now available in your connected Phantom wallet and can be used immediately.</p>
        
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          Stay safe,<br>
          <b>Insta-Relief Team</b>
        </p>
      </div>
    `;

    await sendEmail(
      smtpApiKey,
      [`${userName} <${userEmail}>`],
      "Insta-Relief Emergency <niraj.bhatta@selu.edu>",
      subject,
      html,
      `Emergency relief payment of $${amount} received for ${catastropheType} disaster in ${location}.`
    );

    console.log(`Catastrophe email sent successfully to ${userEmail}`);

    res.status(200).json({
      success: true,
      message: `Email sent to ${userEmail}`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error sending catastrophe email:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// -----------------------------------------------------
// 5. AI Admin Agent with Simulator Access
// -----------------------------------------------------

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

exports.adminAgent = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === 'OPTIONS') {
    res.status(204).send("");
    return;
  }

  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    // AI Tools
    const tools = [
      {
        name: "get_platform_config",
        description: "Get platform configuration including available catastrophe types, active ZIP codes, and example scenarios.",
        input_schema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_users_by_zip",
        description: "Get all users in specific ZIP code(s) with their balance and wallet info.",
        input_schema: {
          type: "object",
          properties: {
            zipCodes: {
              type: "array",
              items: { type: "string" },
              description: "Array of ZIP codes to query"
            }
          },
          required: ["zipCodes"]
        }
      },
      {
        name: "auto_trigger_catastrophe",
        description: "Trigger a catastrophe event - updates balances AND prepares Phantom wallet form. After admin confirms, blockchain payment will be sent and THEN emails will go out automatically.",
        input_schema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Catastrophe type (Flood, Hurricane, Earthquake, etc.)"
            },
            location: {
              type: "string",
              description: "Location description"
            },
            zipCodes: {
              type: "array",
              items: { type: "string" },
              description: "Affected ZIP codes"
            },
            amount: {
              type: "number",
              description: "Payout amount per user in USD"
            },
            description: {
              type: "string",
              description: "Event description (optional - AI generates if not provided)"
            }
          },
          required: ["type", "location", "zipCodes", "amount"]
        }
      },
      {
        name: "get_user_analytics",
        description: "Get platform analytics - user counts, balances, status breakdown.",
        input_schema: {
          type: "object",
          properties: {
            zip: { 
              type: "string", 
              description: "Optional: filter by specific ZIP" 
            }
          }
        }
      },
      {
        name: "get_recent_catastrophes",
        description: "Get history of recent catastrophe events.",
        input_schema: {
          type: "object",
          properties: {
            limit: { 
              type: "number", 
              description: "Number of events to return (default: 10)" 
            }
          }
        }
      }
    ];

    // Tool Execution
    async function executeToolCall(toolName, toolInput) {
      console.log(`Executing: ${toolName}`, toolInput);

      switch (toolName) {
        case "get_platform_config": {
          const usersSnapshot = await db.collection("users").get();
          const activeZips = new Set();
          const zipStats = {};
          
          usersSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.zip) {
              activeZips.add(data.zip);
              if (!zipStats[data.zip]) {
                zipStats[data.zip] = { total: 0, withWallet: 0 };
              }
              zipStats[data.zip].total++;
              if (data.walletAddress) {
                zipStats[data.zip].withWallet++;
              }
            }
          });

          const recentCatastrophes = await db.collection("catastrophes")
            .orderBy("createdAt", "desc")
            .limit(20)
            .get();
          
          const usedTypes = new Set();
          recentCatastrophes.forEach(doc => {
            const data = doc.data();
            if (data.type) usedTypes.add(data.type);
          });

          const catastropheTypes = [
            { type: "Flood", emoji: "", description: "Flooding event" },
            { type: "Hurricane", emoji: "", description: "Hurricane storm" },
            { type: "Earthquake", emoji: "", description: "Seismic activity" },
            { type: "Wildfire", emoji: "", description: "Forest fire" },
            { type: "Tornado", emoji: "", description: "Tornado event" },
            { type: "Winter Storm", emoji: "", description: "Severe winter weather" },
            { type: "Drought", emoji: "", description: "Extended drought" }
          ];

          return {
            catastropheTypes,
            activeZips: Array.from(activeZips).sort(),
            zipStats,
            recentlyUsedTypes: Array.from(usedTypes),
            totalUsers: usersSnapshot.size,
            suggestedAmounts: [50, 100, 150, 200, 250, 500]
          };
        }

        case "get_users_by_zip": {
          const { zipCodes } = toolInput;
          const allUsers = [];
          
          for (const zip of zipCodes) {
            const snapshot = await db.collection("users").where("zip", "==", zip).get();
            
            snapshot.forEach(doc => {
              const data = doc.data();
              allUsers.push({
                id: doc.id,
                name: data.name || `${data.firstName} ${data.lastName}`,
                email: data.email,
                policyId: data.policyId,
                status: data.status,
                balance: data.balance || 0,
                walletAddress: data.walletAddress || null,
                zip: data.zip
              });
            });
          }

          return { 
            users: allUsers, 
            count: allUsers.length,
            zipCodes: zipCodes
          };
        }

        case "auto_trigger_catastrophe": {
          const { type, location, zipCodes, amount, description } = toolInput;
          
          console.log(`AUTO-TRIGGERING: ${type} for ZIPs ${zipCodes.join(", ")}`);

          const balanceUpdates = [];
          const errors = [];
          
          for (const zip of zipCodes) {
            const snapshot = await db.collection("users")
              .where("zip", "==", zip)
              .where("status", "==", "ACTIVE")
              .get();

            for (const doc of snapshot.docs) {
              const userData = doc.data();
              const oldBalance = userData.balance || 0;
              const newBalance = oldBalance + amount;

              try {
                await doc.ref.update({
                  balance: newBalance,
                  lastBalanceUpdate: new Date().toISOString(),
                  lastBalanceReason: `${type} disaster relief - Admin triggered`
                });

                balanceUpdates.push({
                  userId: doc.id,
                  email: userData.email,
                  name: userData.name || `${userData.firstName} ${userData.lastName}`,
                  oldBalance,
                  newBalance,
                  added: amount,
                  zip: userData.zip,
                  hasWallet: !!userData.walletAddress,
                  walletAddress: userData.walletAddress
                });

                console.log(`Balance updated: ${userData.email} $${oldBalance} → $${newBalance}`);
              } catch (error) {
                errors.push({
                  email: userData.email,
                  error: error.message
                });
                console.error(`Failed to update ${userData.email}:`, error);
              }
            }
          }

          const usersWithWallet = balanceUpdates.filter(u => u.hasWallet);
          const usersWithoutWallet = balanceUpdates.filter(u => !u.hasWallet);
          
          const estimatedCost = usersWithWallet.length * amount;
          const estimatedSOL = estimatedCost / 100;

          const finalDescription = description || 
            `${type} disaster affecting ZIP codes: ${zipCodes.join(", ")}. Emergency relief payout of $${amount} per affected user. Balances have been pre-credited in Firestore.`;

          return {
            action: "AUTO_CATASTROPHE_TRIGGERED",
            
            balanceUpdateData: {
              success: true,
              updated: balanceUpdates.length,
              failed: errors.length,
              totalAdded: balanceUpdates.length * amount,
              updates: balanceUpdates,
              errors: errors.length > 0 ? errors : null,
              message: `Updated ${balanceUpdates.length} users' balances in Firestore. Added $${amount} per user.`
            },

            catastropheData: {
              formData: {
                type,
                location,
                zipCodes: zipCodes.join(", "),
                amount: amount.toString(),
                description: finalDescription
              },
              analysis: {
                totalUsers: balanceUpdates.length,
                usersWithWallet: usersWithWallet.length,
                usersWithoutWallet: usersWithoutWallet.length,
                estimatedCost,
                estimatedSOL: estimatedSOL.toFixed(4),
                affectedZipCodes: zipCodes,
                readyToExecute: usersWithWallet.length > 0
              },
              affectedUsers: usersWithWallet.slice(0, 10)
            },

            message: usersWithWallet.length > 0 
              ? `READY TO EXECUTE!

Balance Updates:
• ${balanceUpdates.length} users updated in Firestore
• $${balanceUpdates.length * amount} total added to balances

Phantom Trigger:
• ${usersWithWallet.length} users ready to receive SOL
• ${estimatedSOL} SOL needed ($${estimatedCost})
• ${usersWithoutWallet.length} users without wallets (skipped)

Next: Click the button to open pre-filled dialog and trigger Phantom!`
              : `
Balance updated for ${balanceUpdates.length} users, but NONE have Phantom wallets connected. Cannot send SOL.`
          };
        }

        case "get_user_analytics": {
          let query = db.collection("users");
          if (toolInput.zip) {
            query = query.where("zip", "==", toolInput.zip);
          }

          const snapshot = await query.get();
          const stats = {
            total: snapshot.size,
            byStatus: {},
            byZip: {},
            balances: { 
              total: 0, 
              average: 0, 
              min: Infinity, 
              max: -Infinity 
            },
            withWallet: 0,
            withoutWallet: 0
          };

          snapshot.forEach(doc => {
            const data = doc.data();
            stats.byStatus[data.status] = (stats.byStatus[data.status] || 0) + 1;
            stats.byZip[data.zip] = (stats.byZip[data.zip] || 0) + 1;
            const balance = data.balance || 0;
            stats.balances.total += balance;
            stats.balances.min = Math.min(stats.balances.min, balance);
            stats.balances.max = Math.max(stats.balances.max, balance);
            if (data.walletAddress) stats.withWallet++;
            else stats.withoutWallet++;
          });

          stats.balances.average = stats.total > 0 ? stats.balances.total / stats.total : 0;
          if (stats.balances.min === Infinity) stats.balances.min = 0;
          if (stats.balances.max === -Infinity) stats.balances.max = 0;

          return stats;
        }

        case "get_recent_catastrophes": {
          const limit = toolInput.limit || 10;
          
          const snapshot = await db.collection("catastrophes")
            .orderBy("createdAt", "desc")
            .limit(limit)
            .get();

          const events = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            events.push({
              id: doc.id,
              type: data.type || "Unknown",
              location: data.location || "Unknown",
              zipCodes: data.zipCodes || [],
              amount: data.amount || 0,
              amountSOL: data.amountSOL || 0,
              totalAffected: data.totalAffected || 0,
              successfulPayouts: data.successfulPayouts || 0,
              failedPayouts: data.failedPayouts || 0,
              emailsSent: data.emailsSent || 0,
              createdAt: data.createdAt || new Date().toISOString(),
              createdBy: data.createdBy || "Unknown",
              description: data.description || ""
            });
          });

          return { 
            events, 
            count: events.length,
            summary: {
              totalEvents: events.length,
              totalPayouts: events.reduce((sum, e) => sum + (e.successfulPayouts || 0), 0),
              totalFailed: events.reduce((sum, e) => sum + (e.failedPayouts || 0), 0),
              totalEmailsSent: events.reduce((sum, e) => sum + (e.emailsSent || 0), 0)
            }
          };
        }

        default:
          return { error: `Unknown tool: ${toolName}` };
      }
    }

    // AI Agentic Loop
    const messages = [{ role: "user", content: query }];
    let continueLoop = true;
    let iterationCount = 0;
    const maxIterations = 10;
    let responseData = {};

    while (continueLoop && iterationCount < maxIterations) {
      iterationCount++;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        system: `You are the AI Admin Assistant for Insta-Relief disaster insurance platform.

        FORMATTING CATASTROPHE EVENTS:
        When showing catastrophe events, YOU MUST DISPLAY THE ACTUAL NUMBERS.
        Do NOT leave numeric values blank.
        
        For each event, use this format:
        
        Event NUMBER:
          Type = VALUE
          Location = VALUE
          Date = VALUE
          ZIP Codes = VALUE
          Amount USD = NUMBER
          Amount SOL = NUMBER
          Total Affected = NUMBER
          Successful Payouts = NUMBER
          Failed Payouts = NUMBER
          Emails Sent = NUMBER
          Triggered By = VALUE
        
        The numbers MUST appear.

        Be proactive, clear, and helpful in your responses.`,
        tools,
        messages
      });

      const toolUse = response.content.find(block => block.type === "tool_use");

      if (toolUse) {
        messages.push({ role: "assistant", content: response.content });
        
        const toolResult = await executeToolCall(toolUse.name, toolUse.input);

        if (toolUse.name === "auto_trigger_catastrophe") {
          responseData = {
            catastropheData: toolResult.catastropheData,
            balanceUpdateData: toolResult.balanceUpdateData,
            action: toolResult.action
          };
        }

        messages.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(toolResult)
          }]
        });

        continueLoop = true;
      } else {
        messages.push({ role: "assistant", content: response.content });
        continueLoop = false;

        const textBlock = response.content.find(block => block.type === "text");
        
        return res.json({
          response: textBlock ? textBlock.text : "Action completed",
          toolsUsed: iterationCount - 1,
          ...responseData
        });
      }
    }

    if (iterationCount >= maxIterations) {
      return res.status(500).json({ error: "Max iterations reached" });
    }

  } catch (error) {
    console.error("AI Agent Error:", error);
    return res.status(500).json({ error: error.message });
  }
});
