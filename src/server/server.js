import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/env.js";
import {
  checkGeminiModelStatus,
  importHandFromScreenshot,
  runHarringtonAnalysis,
  runLLMAnalysis,
  runLLMRangeInterpreter,
  runPokerSkillAnalysis,
} from "../analysis/pipeline.js";
import { runTexasSolver } from "../solver/texasSolverAdapter.js";
import { attachVisionImportToAnalysis, buildVisionImportRecord } from "../analysis/visionDebug.js";
import { resolveImportField } from "../import-engine/targetedFallback.js";
import { buildImportV2DebugRecord } from "../import-engine/debugRecord.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const ANALYSIS_LOG_DIR = path.join(ROOT_DIR, "logs", "analysis");
const VISION_IMPORT_LOG_DIR = path.join(ROOT_DIR, "logs", "vision-imports");
const IMPORT_V2_LOG_DIR = path.join(ROOT_DIR, "logs", "import-v2");
const SERVER_BUILD_ID = "solver-allin-legal-actions-20260805";
const config = loadConfig(ROOT_DIR);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendNoContent(res, headers = {}) {
  res.writeHead(204, { ...CORS_HEADERS, ...headers });
  res.end();
}

function readRequestJson(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function analysisLogPath(analysisId) {
  const safeId = String(analysisId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) throw new Error("Missing analysisId.");
  return path.join(ANALYSIS_LOG_DIR, `${safeId}.json`);
}

function readAnalysisLog(analysisId) {
  const filePath = analysisLogPath(analysisId);
  if (!fs.existsSync(filePath)) {
    return {
      analysisId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      local: null,
      endpoints: {},
    };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeAnalysisLog(analysisId, updater) {
  fs.mkdirSync(ANALYSIS_LOG_DIR, { recursive: true });
  const log = readAnalysisLog(analysisId);
  const updated = updater(log) || log;
  updated.updatedAt = new Date().toISOString();
  fs.writeFileSync(analysisLogPath(analysisId), `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

function logAnalysisEndpoint({ analysisId, endpoint, payload, result, error }) {
  if (!analysisId) return;
  try {
    writeAnalysisLog(analysisId, (log) => {
      log.endpoints[endpoint] = {
        endpoint,
        recordedAt: new Date().toISOString(),
        request: {
          spot: payload.spot || {},
          math: payload.math || {},
        },
        debug: result?.debug || null,
        response: result
          ? {
              provider: result.provider,
              model: result.model,
              attemptedModels: result.attemptedModels,
              modelFailures: result.modelFailures,
              completion: result.completion || result.debug?.completion || null,
              analysis: result.analysis,
              rangeInterpretation: result.rangeInterpretation || null,
              rangeWidth: result.rangeWidth || null,
              retrievedContext: result.retrievedContext || null,
              selectedSkills: result.selectedSkills || null,
            }
          : null,
        error: error ? error.message : null,
      };
      return log;
    });
  } catch (logError) {
    console.error(`Failed to write analysis log ${analysisId}: ${logError.message}`);
  }
}

function clientAbortSignal(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded && !controller.signal.aborted) {
      controller.abort(new Error("Client disconnected before analysis completed."));
    }
  };
  req.once("aborted", abort);
  res.once("close", abort);
  return controller.signal;
}

async function handleAnalysisLogStart(req, res) {
  try {
    const payload = await readRequestJson(req, 6_000_000);
    const log = writeAnalysisLog(payload.analysisId, (entry) => {
      entry.local = {
        recordedAt: new Date().toISOString(),
        ...(payload.local || {}),
      };
      if (!payload.importId) return entry;
      const importPath = path.join(VISION_IMPORT_LOG_DIR, `${String(payload.importId).replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
      if (!fs.existsSync(importPath)) return entry;
      return attachVisionImportToAnalysis(entry, JSON.parse(fs.readFileSync(importPath, "utf8")));
    });
    sendJson(res, 200, {
      ok: true,
      analysisId: log.analysisId,
      path: path.relative(ROOT_DIR, analysisLogPath(log.analysisId)),
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function latestAnalysisLogId() {
  if (!fs.existsSync(ANALYSIS_LOG_DIR)) return null;
  const files = fs
    .readdirSync(ANALYSIS_LOG_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const filePath = path.join(ANALYSIS_LOG_DIR, file);
      return { file, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.file.replace(/\.json$/, "") || null;
}

function handleAnalysisLogGet(url, res) {
  try {
    const idFromPath = decodeURIComponent(url.pathname.replace(/^\/api\/analysis-log\/?/, ""));
    const analysisId = idFromPath || (url.searchParams.get("latest") === "1" ? latestAnalysisLogId() : null);
    if (!analysisId) {
      sendJson(res, 404, { error: "No analysis log found." });
      return;
    }
    const filePath = analysisLogPath(analysisId);
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { error: `Analysis log ${analysisId} not found.` });
      return;
    }
    sendJson(res, 200, JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function importEngineV2Disabled(res) {
  sendJson(res, 404, { error: "Import Engine V2 is disabled." });
}

function cleanImportId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || null;
}

// Targeted recovery for one unresolved crop. The server owns the prompt; the browser only names a fixed purpose.
async function handleImportV2Resolve(req, res) {
  if (!config.importEngineV2Enabled) return importEngineV2Disabled(res);
  const signal = clientAbortSignal(req, res);
  try {
    const payload = await readRequestJson(req, 2_000_000);
    const result = await resolveImportField({
      purpose: payload.purpose,
      cropBase64: payload.cropBase64,
      mimeType: payload.mimeType,
      context: payload.context,
      importId: cleanImportId(payload.importId),
      config,
      signal,
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
  }
}

// Optional pixel-free record of a finished V2 import, only written when IMPORT_ENGINE_V2_DEBUG is on.
async function handleImportV2Debug(req, res) {
  if (!config.importEngineV2Enabled || !config.importEngineV2Debug) return importEngineV2Disabled(res);
  try {
    const payload = await readRequestJson(req, 2_000_000);
    const importId = cleanImportId(payload.importId) || `v2_${crypto.randomUUID()}`;
    const record = buildImportV2DebugRecord({ ...payload, importId });
    fs.mkdirSync(IMPORT_V2_LOG_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMPORT_V2_LOG_DIR, `${importId}.json`), `${JSON.stringify(record, null, 2)}\n`);
    sendJson(res, 200, { ok: true, importId });
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
  }
}

async function handleScreenshotImport(req, res) {
  let payload = {};
  let importId = null;
  try {
    payload = await readRequestJson(req, 12_000_000);
    importId = String(payload.importId || `imp_${crypto.randomUUID()}`).replace(/[^a-zA-Z0-9_-]/g, "");
    const result = await importHandFromScreenshot({
      imageBase64: payload.imageBase64,
      mimeType: payload.mimeType,
      config,
    });
    const record = buildVisionImportRecord({ importId, request: payload, result });
    fs.mkdirSync(VISION_IMPORT_LOG_DIR, { recursive: true });
    fs.writeFileSync(path.join(VISION_IMPORT_LOG_DIR, `${importId}.json`), `${JSON.stringify(record, null, 2)}\n`);
    const { debug, ...publicResult } = result;
    sendJson(res, 200, { ...publicResult, importId });
  } catch (error) {
    if (importId) {
      const record = buildVisionImportRecord({ importId, request: payload, error });
      fs.mkdirSync(VISION_IMPORT_LOG_DIR, { recursive: true });
      fs.writeFileSync(path.join(VISION_IMPORT_LOG_DIR, `${importId}.json`), `${JSON.stringify(record, null, 2)}\n`);
    }
    const missingKey = /GEMINI_API_KEY/.test(error.message);
    const inputIssue = /screenshot of Poker Coach's import error page/.test(error.message);
    sendJson(res, missingKey || inputIssue ? 400 : 500, {
      error: error.message,
      hint: missingKey ? "Create .env at the project root and set GEMINI_API_KEY." : undefined,
    });
  }
}

function safeStaticPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const normalizedPath =
    decodedPath === "/" ? "/index.html" : decodedPath.replace(/^\/public\//, "/");
  const filePath = path.normalize(path.join(PUBLIC_DIR, normalizedPath));
  return filePath.startsWith(PUBLIC_DIR) ? filePath : null;
}

async function handleAnalyze(req, res) {
  let payload = {};
  try {
    payload = await readRequestJson(req);
    const result = await runLLMAnalysis({
      spot: payload.spot || {},
      math: payload.math || {},
      rootDir: ROOT_DIR,
      config,
    });
    logAnalysisEndpoint({ analysisId: payload.analysisId, endpoint: "/api/analyze", payload, result });
    sendJson(res, 200, result);
  } catch (error) {
    logAnalysisEndpoint({ analysisId: payload.analysisId, endpoint: "/api/analyze", payload, error });
    const missingKey = /GEMINI_API_KEY/.test(error.message);
    sendJson(res, missingKey ? 400 : 500, {
      error: error.message,
      hint: missingKey ? "Create .env at the project root and set GEMINI_API_KEY." : undefined,
    });
  }
}

async function handleHarringtonAnalyze(req, res) {
  let payload = {};
  const signal = clientAbortSignal(req, res);
  try {
    payload = await readRequestJson(req);
    const result = await runHarringtonAnalysis({
      spot: payload.spot || {},
      math: payload.math || {},
      rootDir: ROOT_DIR,
      config,
      signal,
    });
    logAnalysisEndpoint({ analysisId: payload.analysisId, endpoint: "/api/analyze/harrington", payload, result });
    sendJson(res, 200, result);
  } catch (error) {
    logAnalysisEndpoint({ analysisId: payload.analysisId, endpoint: "/api/analyze/harrington", payload, error });
    const missingKey = /GEMINI_API_KEY/.test(error.message);
    sendJson(res, missingKey ? 400 : 500, {
      error: error.message,
      hint: missingKey ? "Create .env at the project root and set GEMINI_API_KEY." : undefined,
    });
  }
}

async function handlePokerSkillAnalyze(req, res) {
  let payload = {};
  try {
    payload = await readRequestJson(req);
    const result = await runPokerSkillAnalysis({
      spot: payload.spot || {},
      math: payload.math || {},
      config,
    });
    logAnalysisEndpoint({ analysisId: payload.analysisId, endpoint: "/api/analyze/pokerskill", payload, result });
    sendJson(res, 200, result);
  } catch (error) {
    logAnalysisEndpoint({ analysisId: payload.analysisId, endpoint: "/api/analyze/pokerskill", payload, error });
    const missingKey = /GEMINI_API_KEY/.test(error.message);
    sendJson(res, missingKey ? 400 : 500, {
      error: error.message,
      hint: missingKey ? "Create .env at the project root and set GEMINI_API_KEY." : undefined,
    });
  }
}

async function handleRangeInterpret(req, res) {
  let payload = {};
  const signal = clientAbortSignal(req, res);
  try {
    payload = await readRequestJson(req);
    const result = await runLLMRangeInterpreter({
      spot: payload.spot || {},
      math: payload.math || {},
      rootDir: ROOT_DIR,
      config,
      signal,
    });
    logAnalysisEndpoint({ analysisId: payload.analysisId, endpoint: "/api/range/interpret", payload, result });
    sendJson(res, 200, result);
  } catch (error) {
    logAnalysisEndpoint({ analysisId: payload.analysisId, endpoint: "/api/range/interpret", payload, error });
    const missingKey = /GEMINI_API_KEY/.test(error.message);
    sendJson(res, missingKey ? 400 : 500, {
      error: error.message,
      hint: missingKey ? "Create .env at the project root and set GEMINI_API_KEY." : undefined,
    });
  }
}

async function handleSolverRecommend(req, res) {
  let payload = {};
  try {
    payload = await readRequestJson(req);
    const result = await runTexasSolver({
      spot: payload.spot || {},
      math: payload.math || {},
      config,
    });
    logAnalysisEndpoint({ analysisId: payload.analysisId, endpoint: "/api/solver/recommend", payload, result });
    sendJson(res, 200, result);
  } catch (error) {
    logAnalysisEndpoint({ analysisId: payload.analysisId, endpoint: "/api/solver/recommend", payload, error });
    sendJson(res, 400, {
      ok: false,
      error: error.message,
      hint: "Check TEXAS_SOLVER_BINARY, TEXAS_SOLVER_RESOURCES, and use a postflop board.",
    });
  }
}

async function handleModelCheck(req, res) {
  try {
    const payload = await readRequestJson(req);
    const result = await checkGeminiModelStatus({
      config,
      mode: payload.mode === "import" ? "import" : "analysis",
    });
    sendJson(res, 200, result);
  } catch (error) {
    const missingKey = /GEMINI_API_KEY/.test(error.message);
    sendJson(res, missingKey ? 400 : 500, {
      error: error.message,
      hint: missingKey ? "Create .env at the project root and set GEMINI_API_KEY." : undefined,
    });
  }
}

function serveStatic(req, res) {
  const filePath = safeStaticPath(req.url || "/");
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      buildId: SERVER_BUILD_ID,
      model: config.nebiusApiKey ? config.nebiusModel : config.geminiModel,
      fallbackModels: config.nebiusApiKey
        ? config.nebiusFallbackModels
        : config.geminiFallbackModels,
      hasNebiusKey: Boolean(config.nebiusApiKey),
      nebiusBaseUrl: config.nebiusBaseUrl,
      nebiusModel: config.nebiusModel,
      nebiusFallbackModels: config.nebiusFallbackModels,
      importModel: config.geminiImportModel,
      importFallbackModels: config.geminiImportFallbackModels,
      hasGeminiKey: Boolean(config.geminiApiKey),
      hasOpenRouterKey: Boolean(config.openRouterApiKey),
      openRouterModel: config.openRouterModel,
      openRouterFallbackModels: config.openRouterFallbackModels,
      openRouterImportModel: config.openRouterImportModel,
      openRouterImportFallbackModels: config.openRouterImportFallbackModels,
      hasRangeInterpreter: true,
      importEngineV2Enabled: config.importEngineV2Enabled,
      importEngineV2Sites: config.importEngineV2Sites,
      importEngineV2Debug: config.importEngineV2Debug,
    });
    return;
  }

  if (url.pathname === "/api/range/interpret" && req.method === "OPTIONS") {
    sendNoContent(res, {
      Allow: "POST, OPTIONS, GET",
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return;
  }

  if (url.pathname === "/api/range/interpret" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      endpoint: "/api/range/interpret",
      method: "POST",
      buildId: SERVER_BUILD_ID,
      hasRangeInterpreter: true,
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/analysis-log")) {
    handleAnalysisLogGet(url, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analysis-log/start") {
    await handleAnalysisLogStart(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze") {
    await handleAnalyze(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/screenshot") {
    await handleScreenshotImport(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/v2/resolve") {
    await handleImportV2Resolve(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/v2/debug") {
    await handleImportV2Debug(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze/harrington") {
    await handleHarringtonAnalyze(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze/pokerskill") {
    await handlePokerSkillAnalyze(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/range/interpret") {
    await handleRangeInterpret(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/solver/recommend") {
    await handleSolverRecommend(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/models/check") {
    await handleModelCheck(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  serveStatic(req, res);
});

server.on("error", (error) => {
  console.error(`Failed to start Poker Coach server: ${error.message}`);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`Poker Coach server running at http://localhost:${config.port}`);
  console.log(`Gemini key loaded: ${config.geminiApiKey ? "yes" : "no"}`);
});
