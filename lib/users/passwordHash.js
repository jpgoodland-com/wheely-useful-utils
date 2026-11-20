import bcrypt from "bcrypt";

// Cost 12 is about 250 ms per hash on the Fargate tasks: slow enough to
// hurt offline cracking, fast enough for login. Raised from 10.
export const BCRYPT_COST = 12;

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}
