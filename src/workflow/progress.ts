export function reportProgress(message: string): void {
  console.error(message);
}

export function startProgress(label: string) {
  const started = Date.now();
  let lastOutput = started;
  const timer = setInterval(() => {
    if (Date.now() - lastOutput >= 20_000) {
      reportProgress(
        `[${label}] Still waiting — elapsed ${Math.floor((Date.now() - started) / 1000)}s`,
      );
      lastOutput = Date.now();
    }
  }, 1000);
  timer.unref();
  return {
    report(message: string) {
      lastOutput = Date.now();
      reportProgress(`[${label}] ${message}`);
    },
    stop() {
      clearInterval(timer);
    },
  };
}
