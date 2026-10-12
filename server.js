
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
    mkdtemp, mkdir, writeFile, rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.AGENT_API_TOKEN || "";
const REPO_URL = process.env.REPO_URL || "";
const BRANCH = process.env.REPO_BRANCH || "main";
const MODEL = process.env.OPENCODE_MODEL || "opencode/big-pickle";
const ZEN_KEY = process.env.OPENCODE_ZEN_API_KEY || "";

const MAX_BODY = 12_000;
const MAX_OUTPUT = 32_000;
const TASK_TIMEOUT = 120_000;
const MAX_JOBS = 3;
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

function authorized(req) {
    const h = req.headers.authorization || "";
    const provided = Buffer.from(
        h.startsWith("Bearer ") ? h.slice(7) : ""
    );
    const expected = Buffer.from(TOKEN);

    return expected.length >= 32 &&
        provided.length === expected.length &&
        crypto.timingSafeEqual(provided, expected);
}

async function bodyJSON(req) {
    let body = "";
    for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > MAX_BODY) {
            throw Object.assign(new Error("Request too large"), {
                statusCode: 413
            });
        }
    }
    try {
        return JSON.parse(body);
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
        let closed = false;
        let timeoutHit = false;

        const timer = setTimeout(() => {
            timeoutHit = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 2000).unref();
        }, options.timeout || TASK_TIMEOUT);

        function capture(label, stream) {
            stream.on("data", chunk => {
                if (output.length < MAX_OUTPUT) {
                    output += (`\n[${label}] ` + chunk.toString())
                        .slice(0, MAX_OUTPUT - output.length);
                }
            });
        }

        capture("stdout", child.stdout);
        capture("stderr", child.stderr);

        child.on("error", error => {
            if (closed) return;
            closed = true;
            clearTimeout(timer);
            reject(error);
        });

        child.on("close", code => {
            if (closed) return;
            closed = true;
            clearTimeout(timer);

            if (timeoutHit) {
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
        root = await mkdtemp(path.join(tmpdir(), "opencode-"));
        const repo = path.join(root, "repo");
        const config = path.join(root, "opencode.json");

        await run("git", [
            "clone", "--depth", "1", "--single-branch",
            "--branch", BRANCH, REPO_URL, repo
        ], { timeout: 30_000 });

        // OpenCode Zen provider credentials are injected through
        // the environment, never written into the repository.
        const configJSON = {
            "$schema": "https://opencode.ai/config.json",
            model: MODEL,
            provider: {
                opencode: {
                    options: {
                        apiKey: "{env:OPENCODE_ZEN_API_KEY}"
                    }
                }
            },
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

        await writeFile(config, JSON.stringify(configJSON), {
            mode: 0o600
        });

        job.result = await run("opencode", [
            "run", "--format", "default",
            "--model", MODEL, job.prompt
        ], {
            cwd: repo,
            timeout: TASK_TIMEOUT,
            env: {
                ...process.env,
                OPENCODE_CONFIG: config,
                OPENCODE_DISABLE_AUTOUPDATE: "true",
                OPENCODE_ZEN_API_KEY: ZEN_KEY
            }
        });

        job.status = "completed";
    } catch (error) {
        job.status = "failed";
        job.error = String(error.message).slice(0, MAX_OUTPUT);
    } finally {
        if (root) {
            await rm(root, { recursive: true, force: true })
                .catch(() => { });
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
        return reply(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/run") {
        if (!TOKEN || !REPO_URL || !ZEN_KEY) {
            return reply(res, 503, {
                error: "Missing service configuration"
            });
        }

        if (!validBranch(BRANCH)) {
            return reply(res, 500, {
                error: "Invalid configured branch"
            });
        }

        try {
            const data = await bodyJSON(req);
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
    console.log(`OpenCode agent listening on port ${PORT}`);
});
