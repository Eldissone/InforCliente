const { apiRequest } = require("./services/api.js");

async function testFetch() {
  try {
    const data = await apiRequest("/clients");
    console.log("Clients fetched successfully:", data);
  } catch (err) {
    console.error("Failed to fetch clients:", err);
  }
}

// simulate what's in clienteLista.js
// but since I don't have a browser context or easy fetch here, 
// I'll just hit the server with node-fetch or similar if available, 
// or simpler, just hitting it with curl after getting a token.
