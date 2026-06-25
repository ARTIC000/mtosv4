import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function getKey() {
  const source = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || "development-only-secret";
  return createHash("sha256").update(source).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string | null | undefined) {
  if (!payload) return "";
  const [ivPart, tagPart, valuePart] = payload.split(".");
  if (!ivPart || !tagPart || !valuePart) return "";

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(valuePart, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
