// require('dotenv').config(); // Load environment variables from .env file
require("dotenv").config();

// const cron = require('node-cron');
const axios = require("axios");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin").firestore;
// const serviceAccount = require("./serviceAccountKey.json");
const cors = require("cors");
const bodyParser = require("body-parser");

// Initialize Firebase Admin SDK
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
//   databaseURL: process.env.FIREBASE_DATABASE_URL,
// });

// Define Firestore database reference
const db = admin.firestore();

// Define endpoint URLs
const getTokenEndpoint = "https://frontier-server-api-1.onrender.com/get-token";
const chargeCardEndpoint =
  "https://frontier-server-api-1.onrender.com/charge-card-on-file";
const QueryTransactionStatusEndpoint =
  "https://frontier-server-api-1.onrender.com/query-transaction-status";

// Define cron schedule (every day at midnight)
// const cronSchedule = process.env.CRON_SCHEDULE;// Minute: 0, Hour: 0 (midnight), Every day

// const cronSchedule = '*/30 * * * * *'; // Run every 30 seconds

// Function to get authentication token
const getToken = async () => {
  try {
    console.log("Fetching authentication token...");
    const response = await axios.post(
      getTokenEndpoint,
      {},
      {
        headers: {
          "Content-Type": "application/json",
        },
        mode: "cors",
      }
    );

    console.log("Authentication token received:", response.data.token);

    if (response.data.success) {
      return response.data.token;
    } else {
      throw new Error(
        "Error getting authentication token: " + response.data.error
      );
    }
  } catch (error) {
    throw new Error("Error getting authentication token: " + error.message);
  }
};

// Function to charge card on file
const chargeCardOnFile = async (authToken, data, attempt = 1) => {
  try {
    const response = await axios.post(chargeCardEndpoint, data, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
    });
    // console.log(response.data.status);
    if (response.data.status == "Success") {
      // Query the Transaction Status only if charge was successful
      queryTransactionStatus(
        data.externalReference,
        response.data.data.paybossRef,
        data.data.amount
      );
    } else {
      console.log(
        data.externalReference,
        response.data.data.paybossRef,
        data.data.amount
      );
      // queryTransactionStatus(data.externalReference, response.data.data.paybossRef, data.data.amount);

      // if (attempt <= 3) {
      //   // Limiting retries to 3 attempts
      //   // Reduce amount by half and retry charging
      //   data.data.amount /= 2;
      //   console.log(
      //     `Retrying charge with reduced amount (${data.data.amount})`
      //   );
      //   // Add a delay before retrying
      //   // await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      //   return chargeCardOnFile(authToken, data, attempt + 1);
      // } else {
      //   console.log("Maximum retry attempts reached");
      //   return { error: "Maximum retry attempts reached" };
      // }
      //   console.log(`Retrying charge with reduced amount (${data.data.amount})`);
      //   await chargeCardOnFile(authToken, data, attempt + 1);
      // } else {
      //   throw new Error('Maximum retry attempts reached');
      // }
    }
    return response;
  } catch (error) {
    throw new Error("Error charging card on file: " + error.message);
  }
};

// Function to Check Entries then charge
const checkEntriesAndCharge = async () => {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0]; // Get today's date in YYYY-MM-DD format

    // Query Firestore for entries in the clients collection where today's date is within the date range
    const snapshot = await db
      .collection("clients")
      .where("from", "<=", todayStr)
      .where("to", ">=", todayStr)
      .where("amount", ">", "0")
      .get();

    if (snapshot.empty) {
      console.log("No entries found in the clients collection");
      return;
    }

    // Filter entries based on 'to' date in code
    const matchingEntries = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const id = doc.id;
      const fromDate = new Date(data.from);
      const toDate = new Date(data.to);
      const collectionDate =
        typeof data.collectionDate === "string" ? data.collectionDate : null;

      // Log the entry with the collection date
      // console.log('ID:', id, 'Data:', { ...data, collectionDate });
      console.log("ID:", id, "Data:", { ...data });

      // Check if today's date is within the date range
      if (todayStr >= data.from && todayStr < data.to && data.amount > 0) {
        // if (collectionDate === todayStr) {
        matchingEntries.push({ id, ...data });
        console.log("Just Added today's data:", todayStr);
        // }
      }
    });

    if (matchingEntries.length === 0) {
      console.log("No matching entries found for today's date:", todayStr);
      return;
    }

    // Get authentication token
    const {
      data: { authToken },
    } = await getToken();

    const promises = [];

    for (const entry of matchingEntries) {
      promises.push(
        (async () => {
          // Query Firestore for the most recent document in the repayments subcollection
          const repaymentSnapshot = await db
            .collection("clients")
            .doc(entry.id)
            .collection("repaymentSummary")
            .orderBy("timeStamp", "desc")
            .limit(1)
            .get();

          let amount = 0;
          repaymentSnapshot.forEach((repaymentDoc) => {
            const repaymentData = repaymentDoc.data();
            if (repaymentData.expectedAmount > 0) {
              amount = repaymentData.expectedAmount;
              // } else {
              //   amount = repaymentData.expectedAmount;
            }
          });

          // Construct data object to pass to charge-card-on-file endpoint
          const requestData = {
            authToken,
            externalReference: entry.externalReference,
            data: {
              authScheme: "CardOnFile",
              cofTokenRerenceID: entry.tokenId,
              firstName: entry.firstName,
              lastName: entry.surName,
              email: entry.email,
              phone: entry.phone,
              narration: "Loan Installment",
              currency: "ZMW",
              amount: amount,
            },
          };

          // Charge card on file for the current entry
          const response = await chargeCardOnFile(authToken, requestData);
          console.log("Charge card on file response:", response.data);
        })()
      );
    }

    await Promise.all(promises);

    // Iterate over matching entries and charge card on file for each entry
    // for (const entry of matchingEntries) {
    //   // Query Firestore for the most recent document in the repayments subcollection
    //   const repaymentSnapshot = await db.collection('clients').doc(entry.id)
    //     .collection('repaymentSummary').orderBy('timeStamp', 'desc').limit(1).get();

    //   let amount = 0;
    //   repaymentSnapshot.forEach((repaymentDoc) => {
    //     const repaymentData = repaymentDoc.data();
    //     if (repaymentData.expectedAmount > 0) {
    //       amount = repaymentData.expectedAmount;
    //     // } else {
    //     //   amount = repaymentData.expectedAmount;
    //     }
    //   });

    //   // Construct data object to pass to charge-card-on-file endpoint
    //   const requestData = {
    //     authToken,
    //     externalReference: entry.externalReference,
    //     data: {
    //       authScheme: "CardOnFile",
    //       cofTokenRerenceID: entry.tokenId,
    //       firstName: entry.firstName,
    //       lastName: entry.surName,
    //       email: entry.email,
    //       phone: entry.phone,
    //       narration: "Loan Installment",
    //       currency: "ZMW",
    //       amount: amount
    //     }
    //   };

    //   // Charge card on file for the current entry
    //   const response = await chargeCardOnFile(authToken, requestData);
    //   console.log('Charge card on file response:', response.data);
    // }

    console.log(
      "Charging completed for today's entries within the date range:",
      todayStr
    );
  } catch (error) {
    console.error("Error:", error);
  }
};

// Function to Check Transaction Status
const queryTransactionStatus = async (
  externalReference,
  paybossRef,
  amountToCollect
) => {
  try {
    // Get authentication token
    const {
      data: { authToken },
    } = await getToken();

    // Make the request to query transaction status
    const response = await axios.post(QueryTransactionStatusEndpoint, {
      authToken,
      externalReference,
      data: {
        paybossRef,
      },
    });
    console.log(response.data.data.status);
    // Check if the response is successful
    if (response.data.data && response.data.data.status === "Complete") {
      // Extract necessary data
      const { totalAmount, paybossRef, customerName, correlationReference } =
        response.data.data;

      // Print extracted data in the console
      console.log("Amount:", totalAmount);
      console.log("Payboss Ref:", paybossRef);
      console.log("Customer Name:", customerName);
      console.log("Processor correlationReference:", correlationReference);

      if (correlationReference && paybossRef && totalAmount) {
        try {
          // Update Firestore document in the repaymentSummary subcollection
          const clientsRef = admin.firestore().collection("clients");
          const querySnapshot = await clientsRef
            .where("externalReference", "==", correlationReference)
            .get();

          // const UdatingEntries = [];
          const promises = [];

          querySnapshot.forEach((doc) => {
            promises.push(
              (async () => {
                try {
                  const querySnapshotData = doc.data();
                  const repaymentSummaryRef =
                    doc.ref.collection("repaymentSummary");
                  const latestRepaymentQuery = await repaymentSummaryRef
                    .orderBy("timeStamp", "desc")
                    .limit(1)
                    .get();

                  const innerPromises = [];

                  latestRepaymentQuery.forEach((latestRepaymentDoc) => {
                    innerPromises.push(
                      (async () => {
                        try {
                          const latestRepaymentData = latestRepaymentDoc.data();
                          // Now you can access the data of the document
                          const expectedAmount =
                            latestRepaymentData.expectedAmount;
                          // if (!latestRepaymentQuery.empty) {
                          //     // Update latest repayment document
                          //     const latestRepaymentDoc = latestRepaymentQuery.doc.data();
                          //     // const latestCollectionDate = latestRepaymentDoc.data().collectionDate;
                          //     const expectedAmount = latestRepaymentDoc.data().expectedAmount;

                          // let daysToAdd = 1; // Number of days to add initially
                          // let maxIterations = 5; // Maximum number of times to add days
                          // let iterations = 0;

                          // Calculate new collection date based on conditions
                          let newCollectionDate = new Date();
                          if (amountToCollect == expectedAmount) {
                            let firstDate = new Date();
                            firstDate.setDate(newCollectionDate.getDate() + 20);
                            let newFirstDate = firstDate
                              .toISOString()
                              .split("T")[0];

                            let lastDate = new Date();
                            lastDate.setDate(newCollectionDate.getDate() + 25);
                            let newLastDate = lastDate
                              .toISOString()
                              .split("T")[0];

                            // update collection
                            await doc.ref.update({
                              from: newFirstDate,
                              to: newLastDate,
                            });
                            const formattedNewCollectionDate = newCollectionDate
                              .toISOString()
                              .split("T")[0];
                            const pendingAmount = Math.max(
                              expectedAmount - amountToCollect,
                              0
                            );
                            // update the current sub collection
                            await latestRepaymentDoc.ref.update({
                              // collectedAmount: admin.firestore.FieldValue.increment(totalAmount),
                              collectionDate: formattedNewCollectionDate,
                              collectedAmount: amountToCollect,
                              status: totalAmount > 0 ? "Success" : "Failed",
                              pendingAmount: pendingAmount,
                              expectedAmount: pendingAmount,
                              // pendingAmount: Math.max(amountToCollect - (latestRepaymentDoc.data().collectedAmount + totalAmount), 0),
                            });
                            // add new sub-collection
                            await repaymentSummaryRef.add({
                              expectedAmount: querySnapshotData.amount,
                              collectionDate: "",
                              collectedAmount: "",
                              status: "",
                              pendingAmount: "",
                              timeStamp:
                                admin.firestore.FieldValue.serverTimestamp(),
                              // Add other necessary fields
                            });
                            // newCollectionDate.setDate(newCollectionDate.getDate() + 30); // 30 days ahead
                          } else if (
                            amountToCollect !== expectedAmount &&
                            expectedAmount > 0
                          ) {
                            // while (iterations < maxIterations) {
                            const checkToDay = newCollectionDate
                              .toISOString()
                              .split("T")[0];
                            if (querySnapshotData.to == checkToDay) {
                              let firstDate = new Date();
                              firstDate.setDate(
                                newCollectionDate.getDate() - 4
                              );
                              let newFirstDate = firstDate
                                .toISOString()
                                .split("T")[0];

                              let lastDate = new Date();
                              lastDate.setDate(newCollectionDate.getDate() + 1);
                              let newLastDate = lastDate
                                .toISOString()
                                .split("T")[0];

                              // Update collectionDate of the parent document
                              await doc.ref.update({
                                to: newLastDate,
                                from: newFirstDate, // Update collectionDate of the parent document
                              });
                            }
                            // newCollectionDate.setDate(newCollectionDate.getDate() + daysToAdd); // Add days
                            let collectedDate = newCollectionDate
                              .toISOString()
                              .split("T")[0];
                            // iterations++;
                            // if (iterations === maxIterations) {
                            // // Extract expected amount from the latest doc
                            // const expectedAmount = latestRepaymentDoc.data().expectedAmount;
                            // // Add amountToCollect to the extracted expected amount
                            // const newExpectedAmount = expectedAmount + amountToCollect;
                            const pendingAmount = Math.max(
                              expectedAmount - amountToCollect,
                              0
                            );
                            // update the sub collection
                            await latestRepaymentDoc.ref.update({
                              // collectedAmount: admin.firestore.FieldValue.increment(totalAmount),
                              collectionDate: collectedDate,
                              collectedAmount: amountToCollect,
                              status: totalAmount > 0 ? "Success" : "Failed",
                              pendingAmount: pendingAmount,
                              expectedAmount: pendingAmount,
                              // pendingAmount: Math.max(amountToCollect - (latestRepaymentDoc.data().collectedAmount + totalAmount), 0),
                            });
                            // Create a new document with the new expected amount
                            await repaymentSummaryRef.add({
                              expectedAmount: pendingAmount,
                              collectionDate: "",
                              collectedAmount: "",
                              status: "",
                              pendingAmount: pendingAmount,
                              // timeStamp: firebase.firestore.FieldValue.serverTimestamp(),
                              timeStamp:
                                admin.firestore.FieldValue.serverTimestamp(),
                              // Add other necessary fields
                            });
                            // break;
                            // }
                            // }
                          }

                          const formattedNewCollectionDate = newCollectionDate
                            .toISOString()
                            .split("T")[0];
                          // Update collectionDate of the parent document
                          await doc.ref.update({
                            // amount: pendingAmount,
                            collectionDate: formattedNewCollectionDate, // Update collectionDate of the parent document
                          });
                          // } else {
                          //     console.error('No repayment documents found for the client:', doc.id);
                          // }
                        } catch (error) {
                          console.error("Error updating document: ", error);
                        }
                      })()
                    );
                  });

                  await Promise.all(innerPromises);
                } catch (error) {
                  console.error("Error updating document: ", error);
                }
              })()
            );
          });

          await Promise.all(promises);
        } catch (error) {
          console.error("Error updating document: ", error);
        }
      } else {
        console.error("Missing query parameters.");
      }

      // Return the response data
      return response.data;
    } else {
      // Handle unsuccessful response
      console.error(
        "Error querying transaction status: " + response.data.message
      );
    }
  } catch (error) {
    // Handle any errors that occur during processing
    console.error("Error querying transaction status: " + error.message);
  }
};

// // Schedule the cron job
// cron.schedule(cronSchedule,  checkEntriesAndCharge);

// console.log('Cron job scheduled:', cronSchedule);

// cron.schedule(cronSchedule, () => {
//   console.log('Running cron job...');
//   checkEntriesAndCharge(); // Invoke checkEntriesAndCharge function immediately
// });
// checkEntriesAndCharge();
module.exports = { checkEntriesAndCharge };
