(function attachAnalysisRequestModel(global) {
  function createAnalysisRequestCoordinator() {
    let active = null;

    function cancel() {
      if (active && !active.controller.signal.aborted) {
        active.controller.abort(new Error("Analysis superseded."));
      }
      active = null;
    }

    function begin(id) {
      cancel();
      const controller = new AbortController();
      active = { id, controller };
      return controller.signal;
    }

    function finish(id) {
      if (active?.id === id) active = null;
    }

    return { begin, finish, cancel };
  }

  global.PokerCoachAnalysisRequestModel = { createAnalysisRequestCoordinator };
})(typeof globalThis !== "undefined" ? globalThis : window);
