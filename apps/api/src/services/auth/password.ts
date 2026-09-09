export async function hashPassword(password: string): Promise<string> {
  // Argon2id preferred per OWASP; bcrypt fallback when runtime lacks argon2.
  try {
    return await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
  } catch {
    return await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
  }
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}
