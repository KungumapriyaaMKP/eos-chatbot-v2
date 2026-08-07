import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  databaseUrl: required('DATABASE_URL'),

  jwt: {
    // Deliberately its own secret, independent of the EOS-backend's
    // JWT_SECRET — see src/auth/README.md for why.
    secret: process.env.CHATBOT_JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION',
    expiresIn: process.env.CHATBOT_JWT_EXPIRES_IN || '8h',
  },

  intent: {
    confidenceThreshold: parseFloat(
      process.env.INTENT_CONFIDENCE_THRESHOLD || '0.55',
    ),
  },

  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || '*',
};
