import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET || "development-session-secret-change-me",
);

export async function signOAuthState(payload: Record<string, string>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

export async function verifyOAuthState<T extends Record<string, unknown>>(token: string) {
  const verified = await jwtVerify(token, secret);
  return verified.payload as T;
}
