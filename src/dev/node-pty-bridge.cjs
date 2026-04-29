const readline = require("node:readline");

let ptyProcess;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(error) {
  send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}

function fail(error) {
  sendError(error);
  process.exit(1);
}

function spawnPty(message) {
  try {
    const pty = require("node-pty");
    ptyProcess = pty.spawn(message.command, message.args, {
      cwd: message.cwd,
      env: message.env,
    });
    ptyProcess.onData((data) => send({ type: "data", data }));
    ptyProcess.onExit((event) => {
      send({ type: "exit", exitCode: event.exitCode });
      process.exit(0);
    });
  } catch (error) {
    fail(error);
  }
}

function handleMessage(message) {
  if (message.type === "spawn") {
    spawnPty(message);
    return;
  }

  if (message.type === "write") {
    if (ptyProcess === undefined) throw new Error("node-pty bridge received write before spawn");
    ptyProcess.write(message.data);
    return;
  }

  if (message.type === "kill") {
    if (ptyProcess === undefined) {
      process.exit(0);
    }

    ptyProcess.kill(message.signal);
    return;
  }

  throw new Error(`node-pty bridge received unknown message type: ${message.type}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  try {
    handleMessage(JSON.parse(line));
  } catch (error) {
    fail(error);
  }
});

process.on("uncaughtException", (error) => {
  fail(error);
});
