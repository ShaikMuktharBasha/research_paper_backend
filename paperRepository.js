const fs = require("fs");

const { DOCUMENT_STORE_DIR, documentPath } = require("./storage");

function firstSentences(text, count = 2) {
  return (text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

function buildFallbackInsights(record) {
  const summary =
    firstSentences(record.full_text, 3) ||
    (record.full_text || "").replace(/\s+/g, " ").trim().slice(0, 240) ||
    "No summary available yet.";

  return {
    summary,
    explanation: `This document covers the main topic described in the uploaded PDF. ${summary}`,
    key_points: summary ? `1. ${summary}` : "No key points available yet.",
  };
}

function normalizePaperRecord(record) {
  const insights = record.insights || buildFallbackInsights(record);

  return {
    doc_id: record.doc_id,
    filename: record.filename,
    uploaded_at: record.uploaded_at || new Date(0).toISOString(),
    stats: {
      total_pages: record.stats?.total_pages || 0,
      word_count: record.stats?.word_count || 0,
      reading_time_minutes: record.stats?.reading_time_minutes || 0,
    },
    insights,
  };
}

function loadRawPaperRecord(docId) {
  const filePath = documentPath(docId);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function listStoredPapers() {
  if (!fs.existsSync(DOCUMENT_STORE_DIR)) {
    return [];
  }

  return fs
    .readdirSync(DOCUMENT_STORE_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      try {
        const payload = JSON.parse(fs.readFileSync(`${DOCUMENT_STORE_DIR}/${fileName}`, "utf8"));
        if (!payload.doc_id || !payload.filename) {
          return null;
        }
        return normalizePaperRecord(payload);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
}

function getPaperRecord(docId) {
  const rawRecord = loadRawPaperRecord(docId);
  if (!rawRecord) {
    return null;
  }
  return normalizePaperRecord(rawRecord);
}

function buildDashboardData(limit = 6) {
  const papers = listStoredPapers();

  const totals = papers.reduce(
    (accumulator, paper) => {
      accumulator.totalWords += paper.stats.word_count;
      accumulator.totalPages += paper.stats.total_pages;
      accumulator.totalReadingMinutes += paper.stats.reading_time_minutes;
      return accumulator;
    },
    { totalWords: 0, totalPages: 0, totalReadingMinutes: 0 },
  );

  return {
    stats: {
      papers_decoded: papers.length,
      words_processed: totals.totalWords,
      pages_indexed: totals.totalPages,
      reading_time_minutes: totals.totalReadingMinutes,
      estimated_time_saved_minutes: Math.round(totals.totalReadingMinutes * 0.72),
    },
    recent_uploads: papers.slice(0, limit).map((paper) => ({
      ...paper,
      summary_preview: paper.insights.summary,
    })),
  };
}

module.exports = {
  buildDashboardData,
  getPaperRecord,
  listStoredPapers,
};
