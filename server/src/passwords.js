import crypto from "crypto";

const SALT_BYTES = 16;
const KEY_LEN = 64;

/**
 * Hash a password using scrypt with a random salt.
 * Stored format: "scrypt$<saltBase64>$<hashBase64>"
 */
export function hashPassword(password) {
    const pw = String(password || "");
    if (!pw) throw new Error("Password is required.");

    const salt = crypto.randomBytes(SALT_BYTES);
    const derivedKey = crypto.scryptSync(pw, salt, KEY_LEN);

    return `scrypt$${salt.toString("base64")}$${derivedKey.toString("base64")}`;
}

/**
 * Verify password against stored hash.
 */
export function verifyPassword(password, stored) {
    const pw = String(password || "");
    const s = String(stored || "");

    if (!pw || !s) return false;

    const parts = s.split("$");
    if (parts.length !== 3) return false;
    const [algo, saltB64, hashB64] = parts;
    if (algo !== "scrypt") return false;

    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(pw, salt, expected.length);

    // timing-safe compare
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
}
