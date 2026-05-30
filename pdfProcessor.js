const fs = require("fs");

let PDFParseClass = null;
let CanvasFactoryClass = null;

function getCanvasFactory() {
  if (!CanvasFactoryClass) {
    ({ CanvasFactory: CanvasFactoryClass } = require("pdf-parse/worker"));
  }

  return CanvasFactoryClass;
}

function getPdfParse() {
  if (!PDFParseClass) {
    getCanvasFactory();
    ({ PDFParse: PDFParseClass } = require("pdf-parse"));
  }

  return PDFParseClass;
}

async function extractTextAndStats(filePath) {
  const buffer = fs.readFileSync(filePath);
  const PDFParse = getPdfParse();
  const CanvasFactory = getCanvasFactory();
  const parser = new PDFParse({ data: buffer, CanvasFactory });

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
