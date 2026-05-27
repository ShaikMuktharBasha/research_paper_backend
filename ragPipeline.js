const fs = require("fs");
const { documentPath } = require("./storage");
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 6000);

let ChatGroqClass = null;

function getChatGroq() {
  if (!ChatGroqClass) {
    ({ ChatGroq: ChatGroqClass } = require("@langchain/groq"));
  }

  return ChatGroqClass;
}

function splitIntoChunks(text, chunkSize = 1000, overlap = 200) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function tokenize(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

function scoreChunk(queryTokens, chunk) {
  const chunkTokens = tokenize(chunk);
  let score = 0;

  for (const token of queryTokens) {
    if (chunkTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

function getBestChunks(chunks, query, limit = 3) {
  const queryTokens = tokenize(query);

  return [...chunks]
    .map((chunk) => ({ chunk, score: scoreChunk(queryTokens, chunk) }))
    .sort((a, b) => b.score - a.score || b.chunk.length - a.chunk.length)
    .slice(0, limit)
    .map((item) => item.chunk);
}

function firstSentences(text, count = 3) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  return sentences.slice(0, count).join(" ");
}

function titleCase(value) {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractKeywords(...values) {
  const stopWords = new Set([
    "about",
    "after",
    "against",
    "among",
    "and",
    "are",
    "because",
    "before",
    "being",
    "between",
    "could",
    "from",
    "have",
    "into",
    "might",
    "should",
    "that",
    "their",
    "there",
    "these",
    "this",
    "those",
    "through",
    "under",
    "using",
    "with",
  ]);

  const seen = new Set();
  const keywords = [];

  for (const value of values) {
    const tokens = (value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3 && !stopWords.has(token));

    for (const token of tokens) {
      if (!seen.has(token)) {
        seen.add(token);
        keywords.push(token);
      }

      if (keywords.length >= 6) {
        return keywords;
      }
    }
  }

  return keywords.length ? keywords : ["research", "analysis", "methodology"];
}

function normalizeJsonCandidate(value) {
  return (value || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function safeParseJson(value) {
  try {
    return JSON.parse(normalizeJsonCandidate(value));
  } catch (_error) {
    return null;
  }
}

function cleanText(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function cleanDelimitedList(value, separatorPattern) {
  return String(value || "")
    .split(separatorPattern)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanCommaList(value) {
  return cleanDelimitedList(value, /\r?\n|,/);
}

function cleanLineList(value) {
  return cleanDelimitedList(value, /\r?\n|;/);
}

function slugifyFileName(value) {
  const normalized = String(value || "research-paper")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "research-paper";
}

function buildSection(title, body) {
  const cleanedBody = cleanText(body);
  if (!cleanedBody) {
    return null;
  }

  return [`## ${title}`, cleanedBody].join("\n\n");
}

function buildReferencesSection(references) {
  const items = cleanLineList(references);
  if (!items.length) {
    return null;
  }

  return [
    "## References",
    items.map((reference, index) => `${index + 1}. ${reference}`).join("\n"),
  ].join("\n\n");
}

function assembleResearchPaper(input) {
  const title = cleanText(input?.title || "Untitled Research Paper");
  const authors = cleanCommaList(input?.authors);
  const affiliations = cleanLineList(input?.affiliations);
  const keywords = cleanCommaList(input?.keywords);

  const sections = [
    buildSection("Abstract", input?.abstract),
    buildSection("Introduction", input?.intro || input?.introduction),
    buildSection("Literature Review", input?.literature_review || input?.literatureReview),
    buildSection("Methodology", input?.methodology),
    buildSection("Results", input?.results),
    buildSection("Discussion", input?.discussion),
    buildSection("Conclusion", input?.conclusion),
    buildSection("Future Work", input?.future_work || input?.futureWork),
    buildSection("Acknowledgements", input?.acknowledgements),
    buildReferencesSection(input?.references),
  ].filter(Boolean);

  const headerLines = [`# ${title}`];

  if (authors.length) {
    headerLines.push(`**Authors:** ${authors.join(", ")}`);
  }

  if (affiliations.length) {
    headerLines.push(`**Affiliations:** ${affiliations.join("; ")}`);
  }

  if (keywords.length) {
    headerLines.push(`**Keywords:** ${keywords.join(", ")}`);
  }

  const markdown = [headerLines.join("\n"), ...sections].join("\n\n");

  return {
    title,
    file_name: `${slugifyFileName(title)}.md`,
    markdown,
    sections: {
      abstract: cleanText(input?.abstract),
      introduction: cleanText(input?.intro || input?.introduction),
      literature_review: cleanText(input?.literature_review || input?.literatureReview),
      methodology: cleanText(input?.methodology),
      results: cleanText(input?.results),
      discussion: cleanText(input?.discussion),
      conclusion: cleanText(input?.conclusion),
      future_work: cleanText(input?.future_work || input?.futureWork),
      acknowledgements: cleanText(input?.acknowledgements),
      references: cleanLineList(input?.references),
    },
    metadata: {
      authors,
      affiliations,
      keywords,
    },
  };
}

function buildPaperMarkdown(draft) {
  return [
    `# ${draft.title}`,
    "",
    "## Abstract",
    draft.abstract,
    "",
    "## Introduction",
    draft.introduction,
    "",
    "## Methodology",
    draft.methodology,
    "",
    "## Expected Results",
    draft.expected_results,
    "",
    "## Conclusion",
    draft.conclusion,
    "",
    "## Keywords",
    draft.keywords.join(", "),
  ].join("\n");
}

function buildFallbackInsights(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const summary = firstSentences(cleaned, 4) || cleaned.slice(0, 600) || "No summary available.";
  const chunks = splitIntoChunks(cleaned, 350, 50).slice(0, 5);
  const keyPoints = chunks.length
    ? chunks
        .map((chunk, index) => `${index + 1}. ${firstSentences(chunk, 1) || chunk.slice(0, 180)}`)
        .join("\n")
    : "No key points available.";

  return {
    summary,
    explanation:
      "This paper discusses a research problem, the approach used by the authors, and the main findings. " +
      summary,
    key_points: keyPoints,
  };
}

function buildFallbackResearchDraft({
  topic,
  problemStatement,
  methodology,
  targetAudience,
  constraints,
}) {
  const cleanedTopic = titleCase(topic || problemStatement || "Adaptive Research Systems");
  const cleanedProblem =
    (problemStatement || `the need for stronger understanding and execution around ${cleanedTopic}`).trim();
  const cleanedMethodology =
    (methodology || `a structured review, comparative analysis, and iterative evaluation plan for ${cleanedTopic}`).trim();
  const cleanedAudience = (targetAudience || "researchers and technical decision-makers").trim();
  const cleanedConstraints =
    (constraints || "limited time, data availability, and the need for reproducible evaluation").trim();
  const keywords = extractKeywords(cleanedTopic, cleanedProblem, cleanedMethodology);

  const draft = {
    title: `A Research Framework for ${cleanedTopic}`,
    abstract:
      `This paper presents a draft research direction focused on ${cleanedTopic}. It addresses ${cleanedProblem} and outlines an approach suitable for ${cleanedAudience}. The proposed study uses ${cleanedMethodology} while accounting for ${cleanedConstraints}. Expected outcomes include a clearer problem definition, measurable evaluation criteria, and a reproducible basis for future investigation.`,
    introduction:
      `${cleanedTopic} has become an important area of study because it influences both practical outcomes and future research priorities. However, teams often struggle with ${cleanedProblem}. This paper frames the research context, identifies the central gap, and motivates a study designed for ${cleanedAudience}. The goal is to turn an open-ended idea into a research path with concrete questions, evidence expectations, and useful success metrics.`,
    methodology:
      `The proposed methodology combines ${cleanedMethodology}. The study should begin with a focused literature review to define prior work, then move into structured experimentation or comparative analysis. Data collection, baselines, and evaluation criteria should be documented in a repeatable way. Special attention should be given to ${cleanedConstraints} so that the paper remains realistic and transparent about tradeoffs.`,
    expected_results:
      `The expected result is a well-scoped contribution that clarifies how ${cleanedTopic} can be studied more effectively. The research should produce a defensible argument, a clear evaluation setup, and findings that explain strengths, weaknesses, and practical implications. Even if the final effect size is modest, the work should still contribute value by reducing ambiguity around ${cleanedProblem}.`,
    conclusion:
      `In conclusion, this draft paper positions ${cleanedTopic} as a research opportunity with meaningful technical and practical relevance. By centering the study on ${cleanedProblem} and following ${cleanedMethodology}, the resulting paper can offer a structured contribution for ${cleanedAudience}. Future iterations can deepen the experiments, broaden the dataset, and refine the claims as stronger evidence becomes available.`,
    keywords,
  };

  return {
    draft,
    markdown: buildPaperMarkdown(draft),
  };
}

function getLlm() {
  if (!process.env.GROQ_API_KEY) {
    return null;
  }

  const ChatGroq = getChatGroq();

  return new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
    temperature: 0,
    maxRetries: 0,
  });
}

function withTimeout(promise, label, timeoutMs = LLM_TIMEOUT_MS) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function askLlm(prompt, temperature = 0) {
  const llm = getLlm();

  if (!llm) {
    return null;
  }

  const response = await withTimeout(
    llm.invoke(prompt, { temperature }),
    "Groq request",
  );
  return response.content;
}

async function processAndStoreDocument(docId, filename, text, stats, insights = null) {
  const chunks = splitIntoChunks(text);
  const payload = {
    doc_id: docId,
    filename,
    stats,
    insights,
    full_text: text,
    chunks,
    uploaded_at: new Date().toISOString(),
  };

  fs.writeFileSync(documentPath(docId), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

async function generatePaperInsights(text) {
  const truncatedText = text.slice(0, 10000);
  const fallback = buildFallbackInsights(truncatedText);

  const summaryPrompt =
    "Provide a concise summary of the following research paper text:\n\n" + truncatedText;
  const explanationPrompt =
    "Provide a beginner-friendly explanation of this research paper:\n\n" + truncatedText;
  const keyPointsPrompt =
    "Extract 5-10 key points and 5 important keywords from this text:\n\n" + truncatedText;

  try {
    const [summary, explanation, keyPoints] = await Promise.all([
      askLlm(summaryPrompt, 0),
      askLlm(explanationPrompt, 0),
      askLlm(keyPointsPrompt, 0),
    ]);

    if (summary && explanation && keyPoints) {
      return {
        summary,
        explanation,
        key_points: keyPoints,
      };
    }
  } catch (error) {
    console.warn("LLM insight generation failed, using fallback insights.", error.message);
  }

  return fallback;
}

async function createResearchPaperDraft(input) {
  const topic = (input?.topic || "").trim();
  const problemStatement = (input?.problem_statement || input?.problemStatement || "").trim();
  const methodology = (input?.methodology || "").trim();
  const targetAudience = (input?.target_audience || input?.targetAudience || "").trim();
  const constraints = (input?.constraints || "").trim();

  const fallback = buildFallbackResearchDraft({
    topic,
    problemStatement,
    methodology,
    targetAudience,
    constraints,
  });

  const prompt = [
    "You are drafting a concise, professional research paper outline.",
    "Return valid JSON only with these keys:",
    'title, abstract, introduction, methodology, expected_results, conclusion, keywords',
    "keywords must be an array of 4 to 6 short strings.",
    "Keep each section readable, specific, and academically toned without fake citations.",
    "",
    `Topic: ${topic || "Not provided"}`,
    `Problem statement: ${problemStatement || "Not provided"}`,
    `Methodology preference: ${methodology || "Not provided"}`,
    `Target audience: ${targetAudience || "Not provided"}`,
    `Constraints: ${constraints || "Not provided"}`,
  ].join("\n");

  try {
    const response = await askLlm(prompt, 0.2);
    const parsed = safeParseJson(response);

    if (
      parsed &&
      parsed.title &&
      parsed.abstract &&
      parsed.introduction &&
      parsed.methodology &&
      parsed.expected_results &&
      parsed.conclusion &&
      Array.isArray(parsed.keywords)
    ) {
      const draft = {
        title: String(parsed.title).trim(),
        abstract: String(parsed.abstract).trim(),
        introduction: String(parsed.introduction).trim(),
        methodology: String(parsed.methodology).trim(),
        expected_results: String(parsed.expected_results).trim(),
        conclusion: String(parsed.conclusion).trim(),
        keywords: parsed.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 6),
      };

      if (draft.keywords.length >= 3) {
        return {
          draft,
          markdown: buildPaperMarkdown(draft),
        };
      }
    }
  } catch (error) {
    console.warn("Research draft generation failed, using fallback draft.", error.message);
  }

  return fallback;
}

function loadDocument(docId) {
  const filePath = documentPath(docId);

  if (!fs.existsSync(filePath)) {
    throw new Error("Document not found");
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function chatWithPaper(docId, query) {
  const document = loadDocument(docId);
  const contextChunks = getBestChunks(document.chunks || [], query, 3);
  const context = contextChunks.join("\n\n");

  const prompt = [
    "You are helping explain a research paper to a user.",
    "Answer the question using only the context below. If the context is weak, say that clearly.",
    "",
    "Context:",
    context || document.full_text.slice(0, 2500),
    "",
    `Question: ${query}`,
  ].join("\n");

  try {
    const answer = await askLlm(prompt, 0);
    if (answer) {
      return answer;
    }
  } catch (error) {
    console.warn("LLM chat failed, using retrieval fallback.", error.message);
  }

  if (!contextChunks.length) {
    return "I could not find enough matching content in the uploaded paper to answer that question confidently.";
  }

  return `Here is the most relevant part of the paper for your question:\n\n${context}`;
}

async function generateQuiz(docId) {
  const document = loadDocument(docId);
  const context = (document.chunks || []).slice(0, 3).join("\n\n").slice(0, 4000);

  const prompt = [
    "Based on the following excerpts from a research paper, generate 3 multiple-choice quiz questions.",
    "Include four options for each question and clearly mark the correct answer.",
    "",
    context,
  ].join("\n");

  try {
    const quiz = await askLlm(prompt, 0.3);
    if (quiz) {
      return quiz;
    }
  } catch (error) {
    console.warn("LLM quiz generation failed, using fallback quiz.", error.message);
  }

  const snippets = (document.chunks || []).slice(0, 3).map((chunk) => firstSentences(chunk, 1));

  return snippets
    .map(
      (snippet, index) =>
        `Q${index + 1}. Which idea best matches this excerpt?\nA. ${snippet}\nB. An unrelated experimental result\nC. A historical anecdote\nD. A funding statement\nCorrect Answer: A`,
    )
    .join("\n\n");
}

module.exports = {
  assembleResearchPaper,
  chatWithPaper,
  createResearchPaperDraft,
  generatePaperInsights,
  generateQuiz,
  processAndStoreDocument,
};
