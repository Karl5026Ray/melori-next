// ============================================================
// Run once: npx tsx src/scripts/generate-admin-password.ts <password>
// Paste the output hash into the deploy env as ADMIN_PASSWORD_HASH
// ============================================================

import { hash } from "bcryptjs";

async function generatePassword() {
  const password = process.argv[2];

  if (!password) {
    console.log(
      "Usage: npx tsx src/scripts/generate-admin-password.ts <your-password>"
    );
    console.log(
      "Example: npx tsx src/scripts/generate-admin-password.ts MySecurePass123!"
    );
    process.exit(1);
  }

  const hashed = await hash(password, 12);
  console.log("\n=== ADMIN PASSWORD HASH ===");
  console.log(hashed);
  console.log("\nAdd this to your deploy Environment Variables:");
  console.log("Key: ADMIN_PASSWORD_HASH");
  console.log("Value: (the hash above)");
  console.log("Scope: Production + Preview + Development");
  console.log("\nAlso add:");
  console.log("Key: ADMIN_JWT_SECRET");
  console.log("Value: (generate a random 32+ char string)");
  console.log("Scope: Production + Preview + Development");
}

generatePassword();
