const fs = require('fs');
const path = require('path');

const requiredVars = [
  "GROQ_API_KEY",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_DATABASE_URL",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID"
];

const missing = [];

// Try to read .env.local
const envLocalPath = path.join(__dirname, '.env.local');
let envLocalContent = '';
if (fs.existsSync(envLocalPath)) {
  envLocalContent = fs.readFileSync(envLocalPath, 'utf8');
}

const envVars = {};
// Parse .env.local simple lines
envLocalContent.split(/\r?\n/).forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const match = trimmed.match(/^([^=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    let val = match[2].trim();
    // remove quotes if any
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    envVars[key] = val;
  }
});

requiredVars.forEach(v => {
  const value = process.env[v] || envVars[v];
  if (!value) {
    missing.push(v);
  }
});

if (missing.length > 0) {
  console.warn("\x1b[33m%s\x1b[0m", "⚠️ WARNING: The following required environment variables are missing:");
  missing.forEach(v => {
    console.warn("\x1b[33m%s\x1b[0m", `  - ${v}`);
  });
  console.warn("\x1b[33m%s\x1b[0m", "Please ensure these are set in your environment or in a .env.local file.\n");
} else {
  console.log("\x1b[32m%s\x1b[0m", "✅ All required environment variables are configured.");
}
