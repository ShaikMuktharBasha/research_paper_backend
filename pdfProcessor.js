const fs = require("fs");
const { PDFParse } = require("pdf-parse");

async function extractTextAndStats(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const pdfText = await parser.getText();
    const text = (pdfText.text || "").replace(/\r/g, "").trim();
    const wordCount = text ? text.split(/\s+/).length : 0;

    return {
      text,
      stats: {
        total_pages: pdfText.total || 0,
        word_count: wordCount,
        reading_time_minutes: Math.max(1, Math.round(wordCount / 200)),
      },
    };
  } finally {
    await parser.destroy();
  }
}

module.exports = {
  extractTextAndStats,
};
