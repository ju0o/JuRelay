const keepAlive = setInterval(() => {}, 60000);

try {
  await import("./agent-relay.mjs");
} finally {
  clearInterval(keepAlive);
}