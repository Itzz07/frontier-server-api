require("dotenv").config(); // Load environment variables from .env file
const serviceAccount = require("./serviceAccountKey.json");
const admin = require("firebase-admin");
// const serviceAccount = require("./serviceAccountKey.json");
// const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
// const serviceAccount = {
//   type: process.env.GOOGLE_TYPE,
//   project_id: process.env.GOOGLE_PROJECT_ID,
//   private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
//   private_key: privateKey,
//   client_email: process.env.GOOGLE_CLIENT_EMAIL,
//   client_id: process.env.GOOGLE_CLIENT_ID,
//   auth_uri: process.env.GOOGLE_AUTH_URI,
//   token_uri: process.env.GOOGLE_TOKEN_URI,
//   auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
//   client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
//   universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
// };
// const { startScheduler } = require('./scheduler');
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const port = 5000;

app.use(express.json());
app.use(bodyParser.json());

// Initialize Firebase Admin with service account credentials
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.DATABASE_URL, // Use environment variable for database URL
});

// Enable CORS for specified origins and methods
// Enable CORS for all routes
// app.use(cors());
app.use(
  cors({
    origin: [
      "https://frontierpaymentdashboard.netlify.app",
      "https://frontierpaymentinit.netlify.app", 
      "http://localhost:5173", 
      "http://localhost:5174"
    ],
    methods: ["GET", "POST", "PUT", "OPTIONS", "DELETE"],
    allowedHeaders: ["Content-Type"],
  })
);

// Define getToken function to fetch token from external API
const getToken = async () => {
  try {
    const response = await axios.post(
      "https://payboss.bgsgroup.co.zm/api/v1/process-request",
      {
        service: "Authenticate",
        data: {
          authID: "frontier",
          authPassword: "l70q7xJBZLSaN4$A7unC",
        },
      }
    );

    return response.data;
  } catch (error) {
    console.log("Error fetching token:", error);
    throw error;
  }
};

app.get("/", (req, res) => {
  res.send("Server is on and ready");
});

// Route for fetching token
app.post("/get-token", async (req, res) => {
  try {
    const token = await getToken();
    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint for charging the card on online CheckOut
app.post("/charge-card", async (req, res) => {
  try {
    const {
      authToken,
      externalReference,
      data: {
        authScheme,
        resultURL,
        storeCard,
        cofAgreementID,
        firstName,
        lastName,
        email,
        phone,
        narration,
        currency,
        amount,
      },
    } = req.body;

    console.log("Received request:", req.body);

    const chargeCardResponse = await axios.post(
      "https://payboss.bgsgroup.co.zm/api/v1/process-request",
      {
        service: "ChargeCard",
        externalReference,
        data: {
          authScheme: authScheme,
          resultURL: resultURL,
          storeCard: storeCard,
          cofAgreementID: cofAgreementID,
          firstName: firstName,
          lastName: lastName,
          email: email,
          phone: phone,
          narration: narration,
          currency: currency,
          amount: amount,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    console.log("Charge card response:", chargeCardResponse.data);

    const db = admin.firestore();
    const paymentDataRef = db.collection("clients").doc();

    // while(chargeCardResponse.data.code == 'Success' && chargeCardResponse.data.status == 'Success'){
    // Create a document in Firestore with the payment details
    await paymentDataRef.set({
      firstName,
      surName: lastName,
      email,
      phone,
      tokenId: "",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      externalReference,
      paybossRef: "",
      status: "",
      amount: amount,
      collectionDate: "",
    });
    //   break;
    // }

    console.log("Payment data stored successfully.");

    res.json(chargeCardResponse.data);
  } catch (error) {
    console.error("Error charging card:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint for charging the card on file
app.post("/charge-card-on-file", async (req, res) => {
  try {
    // Print the request body received
    console.log("Received request body Api:", req.body);

    // Check if req.body exists and has the correct structure
    if (!req.body || typeof req.body !== "object") {
      throw new Error("Invalid request body: Missing or invalid data object");
    }

    // Destructure the required properties from the request body
    const { authToken, externalReference, data } = req.body;

    // Check if the required properties exist
    if (!authToken || !externalReference || !data) {
      throw new Error("Invalid request body: Missing required properties");
    }

    // Destructure data properties
    const {
      authScheme,
      cofTokenRerenceID,
      firstName,
      lastName,
      email,
      phone,
      narration,
      currency,
      amount,
    } = data;

    // Check if the required data properties exist
    if (
      !authScheme ||
      !cofTokenRerenceID ||
      !firstName ||
      !lastName ||
      !email ||
      !phone ||
      !narration ||
      !currency ||
      !amount
    ) {
      throw new Error("Invalid request body: Missing required data properties");
    }

    // Convert amount to float
    const floatAmount = parseFloat(amount);

    // Make the request to the payment gateway
    const chargeCardResponse = await axios.post(
      "https://payboss.bgsgroup.co.zm/api/v1/process-request",
      {
        service: "ChargeCard",
        externalReference,
        data: {
          authScheme,
          cofTokenRerence: cofTokenRerenceID,
          firstName,
          lastName,
          email,
          phone,
          narration,
          currency,
          amount: floatAmount, // Use the converted float amount
        },
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    // Log the response from the payment gateway
    console.log("Charge card response Api:", chargeCardResponse.data);

    // Send the response back to the client
    res.json(chargeCardResponse.data);
  } catch (error) {
    // Handle any errors that occur during processing
    console.error("Error charging card on file:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint for querying transaction status
app.post("/query-transaction-status", async (req, res) => {
  try {
    console.log("Received request body query-transaction Api:", req.body);
    // Destructure the required properties from the request body
    const { authToken, externalReference, data } = req.body;

    // Check if the required properties exist
    if (!externalReference || !data || !data.paybossRef) {
      throw new Error("Invalid request body: Missing required properties");
    }

    // Make the request to query transaction status
    const queryTransactionResponse = await axios.post(
      "https://payboss.bgsgroup.co.zm/api/v1/process-request",
      {
        service: "QueryTransaction",
        externalReference,
        data: {
          paybossRef: data.paybossRef,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    // Log the response from the query transaction status endpoint
    console.log("Query transaction response:", queryTransactionResponse.data);

    // Send the response back to the client
    res.json(queryTransactionResponse.data);
  } catch (error) {
    // Handle any errors that occur during processing
    console.error("Error querying transaction status:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const cron = require("node-cron"); // Import the cron module
const { checkEntriesAndCharge } = require("./scheduler");

// cron.schedule('*/30 * * * * *', () => {
// cron.schedule('0,30 9-17 * * *', () => {
// cron.schedule('*/30 * 9-17 * * *', () => {
cron.schedule('*/30 * * * * *', () => {
  console.log(
    `Running scheduler at ${new Date().toISOString().split("T")[0]}...`
  );
  checkEntriesAndCharge();
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});
