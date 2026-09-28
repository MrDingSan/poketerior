(function attachHandSessionModel(root) {
  let nextRequestId = 1;

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function createSession(source) {
    if (!new Set(["manual", "screenshot"]).has(source)) throw new Error("Session source must be manual or screenshot.");
    return {
      source,
      revision: 0,
      handState: null,
      metadata: {},
      selectedDecision: null,
      analysisState: { byDecision: {}, pending: {} },
    };
  }

  function replaceHand(session, handState, metadata = {}) {
    return {
      ...session,
      revision: session.revision + 1,
      handState: clone(handState),
      metadata: clone(metadata) || {},
      selectedDecision: null,
      analysisState: { byDecision: {}, pending: {} },
    };
  }

  function decisionKey(session) {
    return session.selectedDecision?.key || "none";
  }

  function selectDecision(session, decision) {
    return { ...session, selectedDecision: decision ? clone(decision) : null };
  }

  function analysisCacheKey(session) {
    return `${session.source}:${session.revision}:${decisionKey(session)}`;
  }

  function beginRequest(session, kind) {
    const token = {
      source: session.source,
      revision: session.revision,
      decisionKey: decisionKey(session),
      kind,
      requestId: nextRequestId++,
    };
    return {
      token,
      session: {
        ...session,
        analysisState: {
          ...session.analysisState,
          pending: { ...session.analysisState.pending, [kind]: token },
        },
      },
    };
  }

  function tokenIsCurrent(session, token) {
    const pending = session.analysisState.pending[token.kind];
    return Boolean(
      pending &&
      session.source === token.source &&
      session.revision === token.revision &&
      decisionKey(session) === token.decisionKey &&
      pending.requestId === token.requestId
    );
  }

  function acceptResult(session, token, result) {
    if (!tokenIsCurrent(session, token)) return { accepted: false, session };
    const pending = { ...session.analysisState.pending };
    delete pending[token.kind];
    return {
      accepted: true,
      session: {
        ...session,
        analysisState: {
          pending,
          byDecision: {
            ...session.analysisState.byDecision,
            [token.decisionKey]: clone(result),
          },
        },
      },
    };
  }

  root.PokerCoachHandSessionModel = {
    createSession,
    replaceHand,
    selectDecision,
    beginRequest,
    acceptResult,
    analysisCacheKey,
  };
})(typeof window !== "undefined" ? window : globalThis);
