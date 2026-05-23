module.exports = {
  apps: [
    {
      name: 'bokito-runtime',
      cwd: __dirname,
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env_file: '../../.env',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
