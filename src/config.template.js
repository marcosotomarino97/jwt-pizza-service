module.exports = {
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',

  db: {
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'pizza',
      connectTimeout: 60000,
    },
    listPerPage: 10,
  },

  factory: {
    url: process.env.FACTORY_URL || 'https://factory.example.com',
    apiKey: process.env.FACTORY_API_KEY || '',
  },
};
