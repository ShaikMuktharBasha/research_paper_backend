require("dotenv").config();

const cors = require("cors");
const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const { authenticateUser, createUser } = require("./authRepository");
const { getPapersCollection, initDatabase } = require("./database");
const { extractTextAndStats } = require("./pdfProcessor");
const {
  assembleResearchPaper,
  chatWithPaper,
  generatePaperInsights,
  generateQuiz,
  processAndStoreDocument,
} = require("./ragPipeline");
const { buildDashboardData, getPaperRecord, listStoredPapers } = require("./paperRepository");
const { UPLOAD_DIR, ensureStorage } = require("./storage");

const app = express();
const PORT = Number(process.env.PORT || 8000);

let databaseInitPromise = null;

function initializeApp() {
  ensureStorage();

  if (!databaseInitPromise) {
    databaseInitPromise = initDatabase().catch((error) => {
      console.warn("Database initialization failed, continuing without MongoDB.", error.message);
      return null;
    });
  }

  return databaseInitPromise;
}

initializeApp();

app.use(
  cors({
    origin: "*",
    credentials: true,
  }),
);
app.use(express.json());

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const docId = uuidv4();
    cb(null, `${docId}${path.extname(file.originalname || ".pdf")}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === "application/pdf" ||
      path.extname(file.originalname || "").toLowerCase() === ".pdf";

    if (!isPdf) {
      cb(new Error("Only PDF files are allowed"));
      return;
    }

    cb(null, true);
  },
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "research-paper-backend",
    routes: ["/api/health"],
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/signup", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");

  if (name.length < 2) {
    res.status(400).json({ detail: "Please enter your full name." });
    return;
  }

  if (!email.includes("@")) {
    res.status(400).json({ detail: "Please enter a valid email address." });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ detail: "Password must be at least 6 characters long." });
    return;
  }

  try {
    const user = createUser({ name, email, password });
    res.status(201).json({ user });
  } catch (error) {
    if (error.code === "EMAIL_EXISTS") {
      res.status(409).json({ detail: error.message });
      return;
    }

    console.error("Signup failed:", error);
    res.status(500).json({ detail: "Could not create that account right now." });
  }
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");

  if (!email || !password) {
    res.status(400).json({ detail: "Please provide both email and password." });
    return;
  }

  try {
    const user = authenticateUser(email, password);
    res.json({ user });
  } catch (error) {
    if (error.code === "INVALID_CREDENTIALS") {
      res.status(401).json({ detail: error.message });
      return;
    }

    console.error("Login failed:", error);
    res.status(500).json({ detail: "Could not log in right now." });
  }
});

app.get("/api/dashboard", (_req, res) => {
  res.json(buildDashboardData());
});

app.get("/api/papers", (req, res) => {
  const limit = Math.max(1, Number(req.query.limit || 20));
  res.json({ papers: listStoredPapers().slice(0, limit) });
});

app.get("/api/papers/:doc_id", (req, res) => {
  const paper = getPaperRecord(req.params.doc_id);

  if (!paper) {
    res.status(404).json({ detail: "Paper not found" });
    return;
  }

  res.json(paper);
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ detail: "No file uploaded" });
    return;
  }

  const filePath = req.file.path;
  const docId = path.basename(filePath, path.extname(filePath));

  try {
    const { text, stats } = await extractTextAndStats(filePath);

    if (!text.trim()) {
      throw new Error("Could not extract readable text from the PDF.");
    }

    const insights = await generatePaperInsights(text);
    await processAndStoreDocument(docId, req.file.originalname, text, stats, insights);

    const responseBody = {
      doc_id: docId,
      filename: req.file.originalname,
      stats,
      insights,
      uploaded_at: new Date().toISOString(),
    };

    const papersCollection = getPapersCollection();
    if (papersCollection) {
      await papersCollection.insertOne(responseBody);
    }

    delete responseBody._id;

    res.json(responseBody);
  } catch (error) {
    console.error("Upload failed:", error);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.status(500).json({ detail: error.message });
  }
});

app.post("/api/chat", async (req, res) => {
  const docId = req.body.doc_id || req.body.document_id;
  const message = req.body.message || req.body.query;

  if (!docId || !message) {
    res.status(400).json({ detail: "Missing doc_id and message" });
    return;
  }

  try {
    const answer = await chatWithPaper(docId, message);
    res.json({ answer });
  } catch (error) {
    console.error("Chat failed:", error);
    res.status(500).json({ detail: error.message });
  }
});

app.get("/api/quiz/:doc_id", async (req, res) => {
  try {
    const quiz = await generateQuiz(req.params.doc_id);
    res.json({ quiz });
  } catch (error) {
    console.error("Quiz failed:", error);
    res.status(500).json({ detail: error.message });
  }
});

app.post("/api/create-paper", async (req, res) => {
  const title = req.body.title || "";
  const abstract = req.body.abstract || "";
  const introduction = req.body.intro || req.body.introduction || "";

  if (!title.trim()) {
    res.status(400).json({ detail: "Please provide a paper title." });
    return;
  }

  if (!abstract.trim() && !introduction.trim()) {
    res.status(400).json({ detail: "Please provide at least an abstract or introduction." });
    return;
  }

  try {
    const paper = assembleResearchPaper(req.body);
    res.json(paper);
  } catch (error) {
    console.error("Research paper assembly failed:", error);
    res.status(500).json({ detail: error.message });
  }
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled request error:", error);
  res.status(500).json({ detail: error.message || "Internal server error" });
});

async function startServer() {
  initializeApp();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Node backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Server failed to start:", error);
    process.exit(1);
  });
}
