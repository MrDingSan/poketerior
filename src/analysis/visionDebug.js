export function buildVisionImportRecord({ importId, request = {}, result = null, error = null }) {
  const debug = result?.debug || error?.visionDebug || {};
  return {
    importId,
    recordedAt: new Date().toISOString(),
    request: {
      mimeType: request.mimeType || null,
    },
    provider: result?.provider || debug.provider || null,
    model: result?.model || debug.model || null,
    attemptedModels: result?.attemptedModels || debug.attemptedModels || [],
    modelFailures: result?.modelFailures || debug.modelFailures || [],
    visionAttempts: debug.visionAttempts || [],
    rawVisionOutput: debug.rawVisionOutput || null,
    parsedVisionHand: debug.parsedVisionHand || null,
    focusedHeroRawVisionOutput: debug.focusedHeroRawVisionOutput || null,
    focusedHeroParsedOutput: debug.focusedHeroParsedOutput || null,
    focusedHeroCropRegion: debug.focusedHeroCropRegion || null,
    focusedHeroCropFailure: debug.focusedHeroCropFailure || null,
    focusedHeroDecision: debug.focusedHeroDecision || null,
    focusedBoardRawVisionOutput: debug.focusedBoardRawVisionOutput || null,
    focusedBoardDecision: debug.focusedBoardDecision || null,
    focusedActionRepairRawVisionOutput: debug.focusedActionRepairRawVisionOutput || null,
    focusedActionRepairParsedOutput: debug.focusedActionRepairParsedOutput || null,
    focusedActionRepairProvider: debug.focusedActionRepairProvider || null,
    focusedActionRepairModel: debug.focusedActionRepairModel || null,
    actionConsistencyIssues: debug.actionConsistencyIssues || result?.actionAttribution?.issues || [],
    focusedActionRepairDecision: debug.focusedActionRepairDecision || null,
    actionAttributionSafe: debug.actionAttributionSafe ?? result?.actionAttribution?.safe ?? null,
    normalizationNotes: result?.normalizationNotes || debug.normalizationNotes || [],
    validationWarnings: result?.validationWarnings || debug.validationWarnings || [],
    finalHand: result?.hand || debug.finalHand || null,
    error: error?.message || null,
  };
}

export function attachVisionImportToAnalysis(analysisLog, visionImport) {
  return {
    ...analysisLog,
    visionImport: visionImport || null,
  };
}
