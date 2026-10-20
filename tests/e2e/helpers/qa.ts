import crypto from "crypto";

// Credentials for the persistent QA fixture accounts come from the environment
// (tests/.env.test, which is gitignored) -- never from source. This repo is public
// and those accounts are real accounts in the production database.
export const QA_PASSWORD = process.env.TEST_QA_PASSWORD || "";
export const QA_PIN = process.env.TEST_QA_PIN || "";

// For tests that SET a password as part of what they exercise (accepting an
// invite, completing a reset): a fresh random value per run, so no password ever
// needs to be written down anywhere.
export function randomTestPassword(): string {
  return "Qa!" + crypto.randomBytes(9).toString("hex");
}
