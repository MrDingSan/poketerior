import fs from "node:fs";
import path from "node:path";

function parseEnvFile(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((acc, line) => {
      const equalsIndex = line.indexOf("=");
      if (equalsIndex === -1) return acc;

      const key = line.slice(0, equalsIndex).trim();
      let value = line.slice(equalsIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      acc[key] = value;
      return acc;
    }, {});
}

export function loadConfig(rootDir = process.cwd()) {
  const envPath = path.join(rootDir, ".env");
  const fileEnv = fs.existsSync(envPath)
    ? parseEnvFile(fs.readFileSync(envPath, "utf8"))
    : {};

  const get = (key, fallback = "") => process.env[key] || fileEnv[key] || fallback;
  const getList = (key, fallback = "") =>
    get(key, fallback)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const getBool = (key, fallback = "false") => /^(true|1|yes|on)$/i.test(get(key, fallback).trim());

  return {
    nebiusApiKey: get("NEBIUS_API_KEY"),
    nebiusBaseUrl: get("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1"),
    nebiusModel: get("NEBIUS_MODEL", "nvidia/nemotron-3-super-120b-a12b"),
    // No Nebius fallback by default: Nemotron-3-Nano spends its whole token budget reasoning on the range
    // prompt and returns no content, so a Super failure goes straight to Gemini instead.
    nebiusFallbackModels: getList("NEBIUS_FALLBACK_MODELS", ""),
    // Postflop range group decisions only. On the group prompt GLM-5.3 returned valid JSON 12/12 at ~5s
    // with near-identical answers run to run; nemotron-3-super returned broken JSON on half of them.
    nebiusRangeModel: get("NEBIUS_RANGE_MODEL", "zai-org/GLM-5.3"),
    nebiusRangeFallbackModels: getList("NEBIUS_RANGE_FALLBACK_MODELS", "zai-org/GLM-5.3-Flash"),
    geminiApiKey: get("GEMINI_API_KEY"),
    geminiModel: get("GEMINI_MODEL", "gemini-2.5-flash"),
    geminiFallbackModels: getList(
      "GEMINI_FALLBACK_MODELS",
      "gemini-3.5-flash,gemini-3.1-flash-lite",
    ),
    geminiImportModel: get("GEMINI_IMPORT_MODEL", "gemini-3.1-flash-lite"),
    geminiImportFallbackModels: getList(
      "GEMINI_IMPORT_FALLBACK_MODELS",
      "gemini-2.5-flash,gemini-3.5-flash",
    ),
    openRouterApiKey: get("OPENROUTER_API_KEY"),
    openRouterModel: get("OPENROUTER_MODEL", "openrouter/free"),
    openRouterFallbackModels: getList("OPENROUTER_FALLBACK_MODELS", ""),
    openRouterImportModel: get("OPENROUTER_IMPORT_MODEL", "openrouter/free"),
    openRouterImportFallbackModels: getList("OPENROUTER_IMPORT_FALLBACK_MODELS", ""),
    importProviderOrder: getList("IMPORT_PROVIDER_ORDER", "gemini,openrouter"),
    screenshotImportTimeoutMs: Number.parseInt(get("SCREENSHOT_IMPORT_TIMEOUT_MS", "30000"), 10),
    importEngineV2Enabled: getBool("IMPORT_ENGINE_V2_ENABLED"),
    importEngineV2Sites: getList("IMPORT_ENGINE_V2_SITES", "Natural8"),
    importEngineV2Debug: getBool("IMPORT_ENGINE_V2_DEBUG"),
    // Postflop ranges come from per-group keep/drop decisions on code-computed hand groups instead of
    // model-written rangeText (see src/analysis/rangeGroups.js). Set to false to go back to one big call.
    rangeGroupDecisions: getBool("RANGE_GROUP_DECISIONS", "true"),
    port: Number.parseInt(get("PORT", "4175"), 10),
    // Render/other hosts need 0.0.0.0; local dev stays loopback-only.
    host: get("HOST", process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
    texasSolverBinary: get("TEXAS_SOLVER_BINARY"),
    texasSolverResources: get("TEXAS_SOLVER_RESOURCES"),
    texasSolverTimeoutMs: Number.parseInt(get("TEXAS_SOLVER_TIMEOUT_MS", "90000"), 10),
  };
}
