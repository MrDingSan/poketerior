import fs from "node:fs";
import path from "node:path";

const DEFAULT_SEARCH_DIRS = ["knowledge-base/notes", "knowledge-base/examples"];
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "have",
  "has",
  "are",
  "was",
  "were",
  "you",
  "your",
  "hero",
  "villain",
]);

function walkMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkMarkdownFiles(fullPath);
      return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
    });
  } catch (error) {
    if (error.code === "EACCES" || error.code === "EPERM") return [];
    throw error;
  }
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9+.-]{2,}/g)
    ?.filter((term) => !STOP_WORDS.has(term)) || [];
}

function titleFor(text, fallback) {
  const heading = text.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || fallback;
}

function chunkDocument(text) {
  const headingChunks = text
    .split(/\n(?=##?\s+)/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (headingChunks.length > 1) return headingChunks;

  const maxLength = 1400;
  const chunks = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength).trim());
  }
  return chunks.filter(Boolean);
}

function scoreChunk(queryTerms, chunk) {
  const chunkTerms = tokenize(chunk);
  if (!queryTerms.length || !chunkTerms.length) return 0;

  const counts = new Map();
  chunkTerms.forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));

  return queryTerms.reduce((score, term) => {
    const exact = counts.get(term) || 0;
    const partial = [...counts.keys()].some((candidate) => candidate.includes(term)) ? 0.35 : 0;
    return score + exact + partial;
  }, 0);
}

export function retrieveKnowledge(query, { rootDir = process.cwd(), limit = 6, searchDirs = DEFAULT_SEARCH_DIRS, searchFiles = null } = {}) {
  const queryTerms = [...new Set(tokenize(query))];
  const files = searchFiles
    ? searchFiles.map((filePath) => path.join(rootDir, filePath)).filter((filePath) => fs.existsSync(filePath))
    : searchDirs.flatMap((dir) => walkMarkdownFiles(path.join(rootDir, dir)));

  return files
    .flatMap((filePath) => {
      let text = "";
      try {
        text = fs.readFileSync(filePath, "utf8");
      } catch (error) {
        if (error.code === "EACCES" || error.code === "EPERM") return [];
        throw error;
      }
      const relativePath = path.relative(rootDir, filePath);
      return chunkDocument(text).map((chunk) => ({
        sourcePath: relativePath,
        title: titleFor(chunk, path.basename(filePath)),
        score: scoreChunk(queryTerms, chunk),
        text: chunk.slice(0, 1800),
      }));
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
