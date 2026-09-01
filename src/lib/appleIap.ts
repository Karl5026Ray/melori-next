// src/lib/appleIap.ts
//
// Thin wrapper around Apple's official server library for verifying
// StoreKit 2 signed transactions from the native iOS app. Verification
// checks the JWS signature chain against Apple's own root CA certificates
// -- it does NOT require the App Store Server API private key (that key
// is only needed if Melori later calls Apple's server APIs directly,
// e.g. transaction history backfill or refund lookups, which this file
// does not do).
//
// MANUAL SETUP STEP -- NOT DONE YET:
// Apple's SignedDataVerifier must be given Apple's actual Root CA
// certificates; the library does not bundle them. Download the current
// root certificates from Apple's PKI page
// (https://www.apple.com/certificateauthority/) and commit them (public,
// non-secret data) under src/lib/apple-root-certs/, then point
// ROOT_CERT_PATHS below at those files. Verification will throw until
// this is done -- that is intentional; it must not silently pass.
//
// REQUIRED ENV VARS (set in Vercel, never committed):
// APPLE_IAP_BUNDLE_ID -- e.g. "org.melorimusic.app" (matches capacitor.config.json appId)
// APPLE_IAP_APP_APPLE_ID -- numeric App Store id, once the app has one (Production only)
// APPLE_IAP_ENVIRONMENT -- "Sandbox" while testing, "Production" once live

import { readFileSync } from "fs";
import path from "path";
import { SignedDataVerifier, Environment } from "@apple/app-store-server-library";

export interface VerifiedTransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  purchaseDate: number | null;
  environment: "Sandbox" | "Production";
}

// Fill in once the .cer files from Apple's PKI page are added to the repo.
const ROOT_CERT_PATHS: string[] = [
  // "apple-root-certs/AppleRootCA-G3.cer",
  ];

let cachedVerifier: SignedDataVerifier | null = null;

function getEnvironment(): Environment {
  return process.env.APPLE_IAP_ENVIRONMENT === "Production"
  ? Environment.PRODUCTION
    : Environment.SANDBOX;
}

function loadRootCAs(): Buffer[] {
  if (ROOT_CERT_PATHS.length === 0) {
    throw new Error(
      "Apple root CA certificates are not configured yet -- see the setup " +
      "note at the top of src/lib/appleIap.ts before enabling IAP verification.",
      );
  }
  return ROOT_CERT_PATHS.map((p) => readFileSync(path.join(__dirname, p)));
}

async function getVerifier(): Promise<SignedDataVerifier> {
  if (cachedVerifier) return cachedVerifier;
  const bundleId = process.env.APPLE_IAP_BUNDLE_ID;
  if (!bundleId) {
    throw new Error("APPLE_IAP_BUNDLE_ID is not configured.");
  }
  const environment = getEnvironment();
  const appAppleId =
    environment === Environment.PRODUCTION
  ? Number(process.env.APPLE_IAP_APP_APPLE_ID || 0) || undefined
    : undefined; // only required for Production verification

cachedVerifier = new SignedDataVerifier(
  loadRootCAs(),
  true, // enableOnlineChecks: also checks Apple's certificate revocation status
  environment,
  bundleId,
  appAppleId,
  );
  return cachedVerifier;
}

/**
* Verifies a StoreKit 2 signedTransactionInfo JWS string (the value the
* native app receives from Transaction.currentEntitlements / .updates) and
* returns its decoded, trustworthy payload. Throws if the signature,
* certificate chain, or environment does not check out -- callers must
* not fulfil a purchase on a thrown/rejected verification.
*/
export async function verifySignedTransaction(
  signedTransactionInfo: string,
  ): Promise<VerifiedTransaction> {
  const verifier = await getVerifier();
  const payload = await verifier.verifyAndDecodeTransaction(signedTransactionInfo);

if (!payload.transactionId || !payload.productId) {
  throw new Error("Signed transaction payload missing required fields.");
}

return {
  transactionId: payload.transactionId,
  originalTransactionId: payload.originalTransactionId ?? payload.transactionId,
  productId: payload.productId,
  purchaseDate: payload.purchaseDate ?? null,
  environment: payload.environment === "Production" ? "Production" : "Sandbox",
};
}
