// Seeds users into a fakeDynamo the way the app stores them: a primary
// USER#<id> item plus a USER#USERNAME#<username> pointer that is a full copy.
export const USERS_TABLE = "WheelApp_Users";

export function seedUser(db, fields) {
  const user = {
    userId: fields.userId || `u-${fields.username}`,
    email: `${fields.username}@example.com`,
    isVerified: true,
    firstName: null,
    lastName: null,
    ...fields,
  };
  const primary = { ...user, PK: `USER#${user.userId}`, EmailOrUsername: user.email };
  db.put(USERS_TABLE, primary);
  db.put(USERS_TABLE, { ...user, PK: `USER#USERNAME#${user.username}`, EmailOrUsername: user.username });
  return primary;
}

export function getUser(db, userId) {
  return db.get(USERS_TABLE, `USER#${userId}`);
}

export function getPointer(db, username) {
  return db.get(USERS_TABLE, `USER#USERNAME#${username}`);
}
