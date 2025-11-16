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
  // ✅ FIXED: Use process.env only (Firebase Functions v7)
  const smtpApiKey = process.env.SMTP2GO_API_KEY;

  if (!smtpApiKey) {
    console.error("❌ SMTP API key missing!");
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
  if (Date.now() - lastSent < 3000 * 60 * 1000) {
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
// 5. ENHANCED Claude AI Admin Agent
// -----------------------------------------------------

// ✅ FIXED: Use process.env only (Firebase Functions v7)
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
        description: "THE MAIN TOOL - Automatically updates balances AND prepares catastrophe trigger. Use this when admin wants to trigger a disaster event.",
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
      console.log(`🔧 Executing: ${toolName}`, toolInput);

      switch (toolName) {
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
          
          console.log(`🚀 AUTO-TRIGGERING: ${type} for ZIPs ${zipCodes.join(", ")}`);

          // STEP 1: Update all balances in Firestore
          const balanceUpdates = [];
          const errors = [];
          
          for (const zip of zipCodes) {
            const snapshot = await db.collection("users").where("zip", "==", zip).get();

            for (const doc of snapshot.docs) {
              const userData = doc.data();
              const oldBalance = userData.balance || 0;
              const newBalance = oldBalance + amount;

              try {
                // Update balance in Firestore
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

                console.log(`✅ Balance updated: ${userData.email} $${oldBalance} → $${newBalance}`);
              } catch (error) {
                errors.push({
                  email: userData.email,
                  error: error.message
                });
                console.error(`❌ Failed to update ${userData.email}:`, error);
              }
            }
          }

          // STEP 2: Prepare catastrophe trigger data
          const usersWithWallet = balanceUpdates.filter(u => u.hasWallet);
          const usersWithoutWallet = balanceUpdates.filter(u => !u.hasWallet);
          
          const estimatedCost = usersWithWallet.length * amount;
          const estimatedSOL = estimatedCost / 100;

          const finalDescription = description || 
            `${type} disaster affecting ZIP codes: ${zipCodes.join(", ")}. Emergency relief payout of $${amount} per affected user. Balances have been pre-credited in Firestore.`;

          return {
            action: "AUTO_CATASTROPHE_TRIGGERED",
            
            // Balance update results
            balanceUpdateData: {
              success: true,
              updated: balanceUpdates.length,
              failed: errors.length,
              totalAdded: balanceUpdates.length * amount,
              updates: balanceUpdates,
              errors: errors.length > 0 ? errors : null,
              message: `✅ Updated ${balanceUpdates.length} users' balances in Firestore. Added $${amount} per user.`
            },

            // Catastrophe form data (for Phantom trigger)
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
              affectedUsers: usersWithWallet.slice(0, 10) // First 10 for preview
            },

            // Summary message
            message: usersWithWallet.length > 0 
              ? `✅ READY TO EXECUTE!\n\n` +
                `Balance Updates:\n` +
                `• ${balanceUpdates.length} users updated in Firestore\n` +
                `• $${balanceUpdates.length * amount} total added to balances\n\n` +
                `Phantom Trigger:\n` +
                `• ${usersWithWallet.length} users ready to receive SOL\n` +
                `• ${estimatedSOL} SOL needed ($${estimatedCost})\n` +
                `• ${usersWithoutWallet.length} users without wallets (skipped)\n\n` +
                `Next: Click the button to open pre-filled dialog and trigger Phantom!`
              : `⚠️ Balance updated for ${balanceUpdates.length} users, but NONE have Phantom wallets connected. Cannot send SOL.`
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
              type: data.type,
              location: data.location,
              zipCodes: data.zipCodes,
              amount: data.amount,
              totalAffected: data.totalAffected,
              successfulPayouts: data.successfulPayouts,
              createdAt: data.createdAt,
              createdBy: data.createdBy
            });
          });

          return { events, count: events.length };
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

CRITICAL WORKFLOW:
When admin wants to trigger a catastrophe (e.g., "flood in ZIP 70401 with $100"):
1. Use auto_trigger_catastrophe tool
2. This automatically:
   - Updates ALL user balances in Firestore
   - Prepares catastrophe trigger form
   - Calculates costs
3. Return the prepared data for admin approval

Your capabilities:
- Auto-update user balances in Firestore
- Auto-fill catastrophe forms
- Analyze user data
- Review catastrophe history

Platform details:
- Users have Phantom wallet addresses
- Balances tracked in Firestore (USD)
- SOL payments via Phantom (1 SOL = $100)
- Statuses: ACTIVE or PAID

Be proactive and clear in your responses.`,
        tools,
        messages
      });

      messages.push({ role: "assistant", content: response.content });

      const toolUse = response.content.find(block => block.type === "tool_use");

      if (toolUse) {
        const toolResult = await executeToolCall(toolUse.name, toolUse.input);

        // Store important results
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
    console.error("❌ AI Agent Error:", error);
    return res.status(500).json({ error: error.message });
  }
});