import crypto from "crypto";
import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";

/**
 * Encrypts small secrets at rest (TOTP seeds now, SSO client secrets
 * later).
 *
 * Production uses AWS KMS (`APP_KMS_KEY_ID`, a customer-managed key) with
 * an encryption context such as `{ userId, purpose: "totp" }`. KMS refuses
 * to decrypt with a different context, so a value copied onto another
 * user's item or field is useless. Elsewhere, a local AES-256-GCM key
 * (`LOCAL_SECRET_KEY`, base64, or a fixed dev key) is used with the context
 * as associated data, giving the same binding.
 *
 * Output: "kms:<base64 ciphertext>" or "local:<iv>.<tag>.<ciphertext>".
 */

const DEV_KEY = crypto.createHash("sha256").update("wheel-app local development key").digest();

let kms;
const kmsClient = () => (kms ||= new KMSClient({ region: process.env.AWS_REGION || "us-east-1" }));

function contextFor(context) {
  if (!context || typeof context !== "object" || !Object.keys(context).length) {
    throw new Error("secretBox needs an encryption context");
  }
  return Object.fromEntries(Object.entries(context).map(([k, v]) => [k, String(v)]).sort(([a], [b]) => a.localeCompare(b)));
}

function localKey() {
  if (process.env.LOCAL_SECRET_KEY) {
    const key = Buffer.from(process.env.LOCAL_SECRET_KEY, "base64");
    if (key.length !== 32) throw new Error("LOCAL_SECRET_KEY must be 32 bytes, base64-encoded");
    return key;
  }
  return DEV_KEY;
}

function kmsEnabled() {
  if (process.env.APP_KMS_KEY_ID) return true;
  if (process.env.NODE_ENV === "production") throw new Error("APP_KMS_KEY_ID must be set in production");
  return false;
}

export async function encryptSecret(plaintext, context) {
  const ctx = contextFor(context);
  if (kmsEnabled()) {
    const { CiphertextBlob } = await kmsClient().send(new EncryptCommand({
      KeyId: process.env.APP_KMS_KEY_ID,
      Plaintext: Buffer.from(plaintext, "utf8"),
      EncryptionContext: ctx,
    }));
    return `kms:${Buffer.from(CiphertextBlob).toString("base64")}`;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", localKey(), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(JSON.stringify(ctx)));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `local:${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${ct.toString("base64")}`;
}

export async function decryptSecret(blob, context) {
  const ctx = contextFor(context);
  if (typeof blob !== "string") throw new Error("secretBox: nothing to decrypt");
  if (blob.startsWith("kms:")) {
    const { Plaintext } = await kmsClient().send(new DecryptCommand({
      CiphertextBlob: Buffer.from(blob.slice(4), "base64"),
      EncryptionContext: ctx,
      ...(process.env.APP_KMS_KEY_ID ? { KeyId: process.env.APP_KMS_KEY_ID } : {}),
    }));
    return Buffer.from(Plaintext).toString("utf8");
  }
  if (blob.startsWith("local:")) {
    // Locally encrypted values must never be trusted in production.
    if (process.env.NODE_ENV === "production") throw new Error("secretBox: refusing a non-KMS value in production");
    const [iv, tag, ct] = blob.slice(6).split(".").map((p) => Buffer.from(p, "base64"));
    // Pin the full 16-byte tag: without authTagLength, GCM accepts a
    // truncated tag, which makes forging a ciphertext far easier.
    if (iv?.length !== 12 || tag?.length !== 16 || !ct) throw new Error("secretBox: malformed value");
    const decipher = crypto.createDecipheriv("aes-256-gcm", localKey(), iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(JSON.stringify(ctx)));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  }
  throw new Error("secretBox: unknown format");
}
