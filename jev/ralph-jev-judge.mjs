#!/usr/bin/env node
import { askJev, envNumber, fail, noul, readStdinJson, recentEvents, sh, tail } from "./lib/jev.mjs";

const DONE_THRESHOLD = envNumber("RALPH_JEV_DONE_THRESHOLD", 0.6);
const VERIFIED_THRESHOLD = envNumber("RALPH_JEV_VERIFIED_THRESHOLD", 0.5);

const GAPS = {
  implementation_missing: "Part of the requested behavior has not been implemented yet or exists only as a plan or description.",
  tests_missing: "The behavior exists but no test, build or other check was run to show it works.",
  checks_failing: "A test, build, lint or typecheck was run and reported failures that are still unresolved.",
  off_objective: "The changes address something different from what `objective` asks for.",
  none: "Nothing is missing: the objective is implemented and verified.",
};

const GAP_ADVICE = {
  implementation_missing: "finish the missing parts of the objective",
  tests_missing: "run the tests or build and record the passing result",
  checks_failing: "fix the failing checks and rerun them",
  off_objective: "re-read the objective and align the changes with it",
};

const QUESTIONS = {
  objective_met: {
    type: "noul",
    instructions:
      "Does the evidence in the state (commits, changed files, closed tasks and recent events) show that every part of `objective` has been accomplished in the workspace? Answer false when any requested part is missing, only planned, or only described.",
  },
  verified: {
    type: "noul",
    instructions:
      "Do `recent_events`, `closed_tasks` or `recent_commits` show that the work was checked by running tests, a build, a typecheck or another concrete verification that passed, rather than only being claimed as done?",
  },
  gap: {
    type: "choice",
    instructions: "What is the main thing still missing before `objective` can be considered done, judging only from the evidence in the state?",
    criteria: GAPS,
  },
};

function gatherEvidence(req) {
  const ws = req.workspace || process.cwd();
  return {
    objective: String(req.objective || "").slice(0, 4000),
    iteration: req.iteration,
    previous_rejections: req.rejections,
    closed_tasks: (req.closed_tasks || []).slice(-30),
    recent_commits: sh(ws, "git", ["log", "--oneline", "-15"]),
    uncommitted_changes: sh(ws, "git", ["status", "--short"]).slice(0, 2000),
    diff_stat: tail(sh(ws, "git", ["diff", "--stat", "HEAD~5"]), 2000),
    recent_events: recentEvents(ws),
  };
}

function verdictFrom(answers) {
  const done = noul(answers, "objective_met");
  const verified = noul(answers, "verified");
  const gap = answers?.gap?.choice;
  const scores = `objective_met=${done.toFixed(2)} verified=${verified.toFixed(2)}${gap ? ` gap=${gap}` : ""}`;
  const advice = GAP_ADVICE[gap] ? `; next: ${GAP_ADVICE[gap]}` : "";
  if (done < DONE_THRESHOLD) {
    return { verdict: "fail", reason: `Jev does not see the objective fully accomplished (${scores})${advice}` };
  }
  if (verified < VERIFIED_THRESHOLD) {
    return { verdict: "fail", reason: `Jev sees no passing verification evidence such as tests or build (${scores})${advice}` };
  }
  return { verdict: "pass", reason: scores };
}

const req = readStdinJson();
askJev(gatherEvidence(req), QUESTIONS)
  .then((answers) => process.stdout.write(`${JSON.stringify(verdictFrom(answers))}\n`))
  .catch((e) => fail("ralph-jev-judge", e));
