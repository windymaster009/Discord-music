const net = require("node:net");

const host = process.env.LAVALINK_HOST || "localhost";
const port = Number(process.env.LAVALINK_PORT || 2333);
const retryMs = 1000;

function waitForLavalink() {
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port });
      let settled = false;

      const retry = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        process.stdout.write(`Waiting for Lavalink at ${host}:${port}...\n`);
        setTimeout(attempt, retryMs);
      };

      socket.setTimeout(1500);
      socket.once("connect", () => {
        if (settled) return;
        settled = true;
        socket.end();
        console.log(`Lavalink TCP port is ready at ${host}:${port}`);
        resolve();
      });
      socket.once("error", retry);
      socket.once("timeout", retry);
    };

    attempt();
  });
}

waitForLavalink().catch((error) => {
  console.error("Failed while waiting for Lavalink:", error);
  process.exit(1);
});
