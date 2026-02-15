import fs from "node:fs";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendFile(filePath, content) {
  return new Promise((resolve, reject) => {
    fs.appendFile(filePath, content, "utf-8", (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function createLogWriter(options = {}) {
  const dir = options.dir;
  const maxQueueSize =
    typeof options.maxQueueSize === "number" && options.maxQueueSize > 0 ? options.maxQueueSize : 5000;

  ensureDir(dir);

  const queue = [];
  let closing = false;
  let dropped = 0;
  let flushPromise = null;

  const drainQueue = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        continue;
      }
      await appendFile(item.filePath, item.line);
    }
  };

  const ensureFlushRunning = () => {
    if (flushPromise || queue.length === 0) {
      return flushPromise;
    }

    flushPromise = (async () => {
      try {
        await drainQueue();
      } finally {
        flushPromise = null;
        if (queue.length > 0) {
          ensureFlushRunning();
        }
      }
    })();

    return flushPromise;
  };

  const enqueue = (filePath, line) => {
    if (closing) {
      return false;
    }
    if (queue.length >= maxQueueSize) {
      dropped += 1;
      return false;
    }
    queue.push({ filePath, line });
    void ensureFlushRunning();
    return true;
  };

  const flush = async () => {
    while (true) {
      const running = ensureFlushRunning();
      if (!running) {
        return;
      }
      await running;
    }
  };

  const close = async () => {
    closing = true;
    await flush();
  };

  return {
    enqueue,
    flush,
    close,
    getDroppedCount: () => dropped,
    getQueueSize: () => queue.length
  };
}
