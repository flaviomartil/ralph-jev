import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runVerify, verifyFailure } from "../lib/jev.mjs";
import { gatherEvidence, preVerdict } from "../lib/judge.mjs";
import { scratchDir } from "./helpers.mjs";

test("runVerify is null without a command", async () => {
  assert.equal(await runVerify(scratchDir("v"), {}), null);
  assert.equal(await runVerify(scratchDir("v"), { RALPH_JEV_VERIFY_CMD: "   " }), null);
});

test("runVerify reports a passing command", async () => {
  const run = await runVerify(scratchDir("v"), { RALPH_JEV_VERIFY_CMD: "echo all good" });
  assert.equal(run.passed, true);
  assert.equal(run.exit_code, 0);
  assert.match(run.output_tail, /all good/);
  assert.equal(verifyFailure(run), null);
});

test("runVerify reports a failing command with its output", async () => {
  const run = await runVerify(scratchDir("v"), { RALPH_JEV_VERIFY_CMD: "echo boom >&2; exit 3" });
  assert.equal(run.passed, false);
  assert.equal(run.exit_code, 3);
  assert.match(verifyFailure(run), /exited with 3: boom/);
});

test("runVerify runs in the workspace", async () => {
  const ws = scratchDir("v");
  writeFileSync(join(ws, "marker"), "m");
  assert.equal((await runVerify(ws, { RALPH_JEV_VERIFY_CMD: "test -f marker" })).passed, true);
});

test("runVerify times out", async () => {
  const run = await runVerify(scratchDir("v"), { RALPH_JEV_VERIFY_CMD: "sleep 5", RALPH_JEV_VERIFY_TIMEOUT_MS: "200" });
  assert.equal(run.passed, false);
  assert.equal(run.timed_out, true);
  assert.match(verifyFailure(run), /timed out/);
});

test("runVerify keeps only the tail of long output", async () => {
  const run = await runVerify(scratchDir("v"), { RALPH_JEV_VERIFY_CMD: "yes line | head -n 5000; exit 1" });
  assert.ok(run.output_tail.length <= 1500);
});

test("judge preVerdict fails fast on a failing verification and is silent otherwise", async () => {
  const ws = scratchDir("pv");
  const saved = { ...process.env };
  try {
    process.env.RALPH_JEV_VERIFY_CMD = "exit 1";
    const failing = await gatherEvidence({ objective: "x", workspace: ws });
    assert.equal(failing.verification_run.passed, false);
    assert.equal(preVerdict(failing).verdict, "fail");
    process.env.RALPH_JEV_VERIFY_CMD = "true";
    assert.equal(preVerdict(await gatherEvidence({ objective: "x", workspace: ws })), null);
    delete process.env.RALPH_JEV_VERIFY_CMD;
    const none = await gatherEvidence({ objective: "x", workspace: ws });
    assert.equal(none.verification_run, null);
    assert.equal(preVerdict(none), null);
  } finally {
    process.env = saved;
  }
});

test("runVerify kills background children when it times out", async () => {
  const ws = scratchDir("vk");
  const marker = join(ws, "late-write");
  const run = await runVerify(ws, { RALPH_JEV_VERIFY_CMD: `(sleep 1; touch ${marker}) & sleep 5`, RALPH_JEV_VERIFY_TIMEOUT_MS: "200" });
  assert.equal(run.timed_out, true);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(existsSync(marker), false);
});

test("runVerify kills background children left behind by a finished command", async () => {
  const ws = scratchDir("vk");
  const marker = join(ws, "late-write");
  const run = await runVerify(ws, { RALPH_JEV_VERIFY_CMD: `(sleep 1; touch ${marker}) & echo done` });
  assert.equal(run.passed, true);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(existsSync(marker), false);
});
