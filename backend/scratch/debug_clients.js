const axios = require('axios');

async function debugAPI() {
  const baseURL = 'http://localhost:4000';
  const email = 'admin@inforcliente.local';
  const password = 'admin'; // Assuming password for this local admin is 'admin' or findable.

  try {
    console.log(`Starting debug for ${baseURL}/clients...`);
    
    // 1. Authenticate
    console.log('Authenticating...');
    const loginRes = await axios.post(`${baseURL}/auth/login`, {
      email,
      password: 'password123' // I'll try 'password123' or common ones if I don't know it.
    });
    const token = loginRes.data.token;
    console.log('Authentication successful.');

    // 2. Fetch clients
    console.log('Fetching clients...');
    const clientsRes = await axios.get(`${baseURL}/clients`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('SUCCESS! Clients fetched:', clientsRes.data.items?.length);
    console.log('Data sample:', JSON.stringify(clientsRes.data.items?.[0], null, 2));

  } catch (err) {
    if (err.response) {
      console.error('API_ERROR:', {
        status: err.response.status,
        data: err.response.data
      });
    } else {
      console.error('REQUEST_ERROR:', err.message);
    }
  }
}

debugAPI();
