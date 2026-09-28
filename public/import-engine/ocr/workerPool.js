(function attachImportOcrPool(root) {
  const DEFAULT_POOL_SIZE = 2;
  const LOCAL_WORKER_OPTIONS = Object.freeze({
    workerPath: "./vendor/tesseract/worker.min.js",
    corePath: "./vendor/tesseract/",
    langPath: "./vendor/tesseract/",
    gzip: true,
    workerBlobURL: false,
  });
  const BASE_PARAMETERS = Object.freeze({ preserve_interword_spaces: "1" });

  function createPool({
    createWorker = root.Tesseract?.createWorker,
    size = DEFAULT_POOL_SIZE,
    workerOptions = LOCAL_WORKER_OPTIONS,
    language = "eng",
    oem = 1,
  } = {}) {
    let initialization = null;
    let workers = [];
    let terminated = false;
    let terminating = null;
    const available = [];
    const queue = [];

    async function initialize() {
      if (typeof createWorker !== "function") throw new Error("Tesseract createWorker is unavailable; load the local Tesseract runtime first.");
      const settled = await Promise.allSettled(Array.from({ length: size }, async () => {
        const worker = await createWorker(language, oem, workerOptions);
        await worker.setParameters?.({ ...BASE_PARAMETERS });
        return worker;
      }));
      const created = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
      const failure = settled.find((entry) => entry.status === "rejected");
      if (failure) {
        await Promise.allSettled(created.map((worker) => worker.terminate?.()));
        throw failure.reason;
      }
      return created;
    }

    function ensureWorkers() {
      if (!initialization) {
        initialization = initialize().then(
          (created) => {
            workers = created;
            available.push(...created);
            return created;
          },
          (error) => {
            initialization = null;
            throw error;
          },
        );
      }
      return initialization;
    }

    async function run(worker, job) {
      try {
        await worker.setParameters?.({ ...BASE_PARAMETERS, ...(job.options.parameters || {}) });
        job.resolve(await worker.recognize(job.image, job.options.recognize || {}));
      } catch (error) {
        job.reject(error);
      } finally {
        if (!terminated) available.push(worker);
        pump();
      }
    }

    function pump() {
      while (!terminated && available.length && queue.length) run(available.shift(), queue.shift());
    }

    function recognize(image, options = {}) {
      if (terminated) return Promise.reject(new Error("The OCR pool has been terminated."));
      return new Promise((resolve, reject) => {
        queue.push({ image, options, resolve, reject });
        ensureWorkers().then(pump, (error) => {
          for (const job of queue.splice(0)) job.reject(error);
        });
      });
    }

    function terminate() {
      if (terminating) return terminating;
      terminated = true;
      for (const job of queue.splice(0)) job.reject(new Error("The OCR pool has been terminated."));
      terminating = (async () => {
        if (initialization) await initialization.catch(() => {});
        await Promise.allSettled(workers.map((worker) => worker.terminate?.()));
        workers = [];
        available.length = 0;
      })();
      return terminating;
    }

    return { recognize, terminate };
  }

  const api = Object.freeze({ DEFAULT_POOL_SIZE, LOCAL_WORKER_OPTIONS, createPool });
  root.PokerCoachImportOcr = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
