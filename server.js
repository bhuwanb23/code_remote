
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtemp, mkdir, writeFile, rm
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT || 10000);
const REPO_URL = process.env.REPO_URL || "";
const BRANCH = process.env.REPO_BRANCH || "main";
const MODEL = process.env.OPENCODE_MODEL || "";
const AUTH_B64 = process.env.OPENCODE_AUTH_JSON_BASE64 || "";

const MAX_BODY = 12000;
const MAX_OUTPUT = 16000;
const TIMEOUT = 120000;
const MAX_JOBS = 2;

const jobs = new Map();
const queue = [];
let running = false;

function reply(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw) > MAX_BODY) {
      throw Object.assign(new Error("Request too large"), {
        statusCode: 413
      });
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON"), {
      statusCode: 400
    });
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    let finished = false;
    let timedOut = false;

    function collect(label, stream) {
      stream.on("data", chunk => {
        if (output.length < MAX_OUTPUT) {
          output += ("\n[" + label + "] " + chunk.toString())
            .slice(0, MAX_OUTPUT - output.length);
        }
      });
    }

    collect("stdout", child.stdout);
    collect("stderr", child.stderr);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, options.timeout || TIMEOUT);

    child.on("error", error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error("Process timed out. " + output));
      } else if (code !== 0) {
        reject(new Error(`Process exited ${code}. ${output}`));
      } else {
        resolve(output);
      }
    });
  });
}

function validBranch(value) {
  return typeof value === "string" &&
    value.length <= 200 &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.startsWith("-") &&
    !value.includes("..") &&
    !value.endsWith("/");
}

async function execute(job) {
  job.status = "running";
  let root;

  try {
    root = await mkdtemp(path.join(tmpdir(), "oc-agent-"));
    const repo = path.join(root, "repo");

    await run("git", [
      "clone", "--depth", "1",
      "--single-branch", "--branch", BRANCH,
      REPO_URL, repo
    ], { timeout: 30000 });

    const authDir = path.join(
      homedir(), ".local", "share", "opencode"
    );

    await mkdir(authDir, {
      recursive: true,
      mode: 0o700
    });

    // Validate and install the supplied provider credentials.
    let auth;
    try {
      auth = JSON.parse(
        Buffer.from(AUTH_B64, "base64").toString("utf8")
      );
    } catch {
      throw new Error(
        "OPENCODE_AUTH_JSON_BASE64 is missing or invalid"
      );
    }

    if (!auth || typeof auth !== "object" ||
        Array.isArray(auth)) {
      throw new Error("Invalid OpenCode credentials format");
    }

    const authPath = path.join(authDir, "auth.json");
    await writeFile(authPath, JSON.stringify(auth), {
      mode: 0o600
    });

    const config = {
      "$schema": "https://opencode.ai/config.json",
      permission: {
        bash: "deny",
        edit: "allow",
        read: "allow",
        glob: "allow",
        grep: "allow",
        webfetch: "deny",
        websearch: "deny",
        task: "deny"
      }
    };

    if (MODEL) config.model = MODEL;

    const output = await run("opencode", [
      "run", "--format", "default", job.prompt
    ], {
      cwd: repo,
      timeout: TIMEOUT,
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
        OPENCODE_DISABLE_AUTOUPDATE: "true"
      }
    });

    job.status = "completed";
    job.result = output;
  } catch (error) {
    job.status = "failed";
    job.error = String(error.message).slice(0, MAX_OUTPUT);
  } finally {
    if (root) {
      await rm(root, { recursive: true, force: true })
        .catch(() => {});
    }
    job.finishedAt = new Date().toISOString();
  }
}

async function worker() {
  if (running) return;
  running = true;

  try {
    while (queue.length) {
      await execute(queue.shift());
    }
  } finally {
    running = false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    return reply(res, 200, {
      ok: true,
      configured: Boolean(REPO_URL && AUTH_B64)
    });
  }

  if (req.method === "POST" && url.pathname === "/run") {
    if (!REPO_URL || !AUTH_B64) {
      return reply(res, 503, {
        error: "Missing REPO_URL or OPENCODE_AUTH_JSON_BASE64"
      });
    }

    if (!validBranch(BRANCH)) {
      return reply(res, 500, {
        error: "Invalid configured branch"
      });
    }

    try {
      const data = await readBody(req);

      if (typeof data.prompt !== "string" ||
          !data.prompt.trim() ||
          data.prompt.length > 4000) {
        return reply(res, 400, {
          error: "prompt must be 1-4000 characters"
        });
      }

      if (queue.length + (running ? 1 : 0) >= MAX_JOBS) {
        return reply(res, 429, {
          error: "Task queue is full"
        });
      }

      const job = {
        id: crypto.randomUUID(),
        status: "queued",
        prompt: data.prompt,
        createdAt: new Date().toISOString()
      };

      jobs.set(job.id, job);
      queue.push(job);
      void worker();

      return reply(res, 202, {
        id: job.id,
        status: job.status,
        poll: `/jobs/${job.id}`
      });
    } catch (error) {
      return reply(res, error.statusCode || 400, {
        error: error.message
      });
    }
  }

  const match = url.pathname.match(
    /^\/jobs\/([0-9a-f-]{36})$/i
  );

  if (req.method === "GET" && match) {
    const job = jobs.get(match[1]);

    if (!job) {
      return reply(res, 404, { error: "Job not found" });
    }

    return reply(res, 200, {
      id: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt
    });
  }

  return reply(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenCode agent listening on ${PORT}`);
});
