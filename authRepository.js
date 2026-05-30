const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { getUsersCollection } = require("./database");
const { ROOT_DIR } = require("./storage");

const AUTH_DIR = path.join(ROOT_DIR, "auth_store");
const USERS_FILE = path.join(AUTH_DIR, "users.json");

function ensureAuthStore() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, "[]", "utf8");
  }
}

function readUsers() {
  ensureAuthStore();

  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch (_error) {
    return [];
  }
}

function writeUsers(users) {
  ensureAuthStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash || "").split(":");

  if (!salt || !originalHash) {
    return false;
  }

  const candidateHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(originalHash, "hex"), Buffer.from(candidateHash, "hex"));
}

function sanitizeUser(user) {
  return {
    id: String(user.id || user._id),
    name: user.name,
    email: user.email,
    created_at: user.created_at,
  };
}

async function createUser({ name, email, password }) {
  const trimmedName = String(name || "").trim();
  const normalizedEmail = normalizeEmail(email);
  const trimmedPassword = String(password || "");
  const usersCollection = getUsersCollection();

  if (usersCollection) {
    const user = {
      id: crypto.randomUUID(),
      name: trimmedName,
      email: normalizedEmail,
      password_hash: hashPassword(trimmedPassword),
      created_at: new Date().toISOString(),
    };

    try {
      await usersCollection.insertOne(user);
      return sanitizeUser(user);
    } catch (error) {
      if (error && error.code === 11000) {
        const duplicateError = new Error("An account with that email already exists.");
        duplicateError.code = "EMAIL_EXISTS";
        throw duplicateError;
      }

      throw error;
    }
  }

  const users = readUsers();

  if (users.some((user) => user.email === normalizedEmail)) {
    const error = new Error("An account with that email already exists.");
    error.code = "EMAIL_EXISTS";
    throw error;
  }

  const user = {
    id: crypto.randomUUID(),
    name: trimmedName,
    email: normalizedEmail,
    password_hash: hashPassword(trimmedPassword),
    created_at: new Date().toISOString(),
  };

  users.push(user);
  writeUsers(users);
  return sanitizeUser(user);
}

async function authenticateUser(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const usersCollection = getUsersCollection();
  let user = null;

  if (usersCollection) {
    user = await usersCollection.findOne({ email: normalizedEmail });
  } else {
    const users = readUsers();
    user = users.find((entry) => entry.email === normalizedEmail);
  }

  if (!user || !verifyPassword(String(password || ""), user.password_hash)) {
    const error = new Error("Incorrect email or password.");
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }

  return sanitizeUser(user);
}

module.exports = {
  authenticateUser,
  createUser,
};
