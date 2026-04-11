const axios = require('axios');

async function debug() {
  const baseURL = 'http://localhost:4000';
  try {
    console.log('Authenticating...');
    const loginRes = await axios.post(`${baseURL}/auth/login`, {
      email: 'admin@admin.com', // typical default, let's check
      password: 'password'
    });
    const token = loginRes.data.token;
    console.log('Login successful, token obtained.');

    console.log('Fetching clients...');
    const clientsRes = await axios.get(`${baseURL}/clients`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Clients received:', JSON.stringify(clientsRes.data, null, 2));
  } catch (err) {
    console.error('API Error:', err.response ? {
      status: err.response.status,
      data: err.response.data
    } : err.message);
  }
}

debug();
