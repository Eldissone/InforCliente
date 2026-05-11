module.exports = {
  apps: [
    {
      name: 'infocliente-api',
      cwd: './backend',
      script: 'src/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        FRONTEND_ORIGIN: 'https://infocliente.tech'
      }
    },
    {
      name: 'infocliente-front',
      cwd: './frontend',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 5173,
        API_BASE_URL: 'https://api.infocliente.tech' // Substitua pelo seu domínio de API real
      }
    }
  ]
};
