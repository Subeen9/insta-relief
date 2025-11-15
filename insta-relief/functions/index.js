const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const logger = require("firebase-functions/logger");

// Optional: controls cost
setGlobalOptions({ maxInstances: 5 });

exports.helloWorld = onRequest((req, res) => {
  logger.info("HelloWorld function was called!");

  res.status(200).send("Hello from Firebase Functions!");
});

exports.testJson = onRequest((req, res) => {
  res.json({
    message: "Firebase functions working!",
    time: new Date().toISOString(),
  });
});
