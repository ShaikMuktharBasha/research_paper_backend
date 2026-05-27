const fs = require("fs");
const os = require("os");
const path = require("path");

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

const ROOT_DIR = isServerlessRuntime() ? os.tmpdir() : __dirname;
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
const DOCUMENT_STORE_DIR = path.join(ROOT_DIR, "chroma_db");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureStorage() {
  ensureDir(UPLOAD_DIR);
  ensureDir(DOCUMENT_STORE_DIR);
}

function documentPath(docId) {
  return path.join(DOCUMENT_STORE_DIR, `${docId}.json`);
}

module.exports = {
  DOCUMENT_STORE_DIR,
  ROOT_DIR,
  UPLOAD_DIR,
  documentPath,
  ensureStorage,
};
