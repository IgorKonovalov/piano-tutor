#!/usr/bin/env node
// PreToolUse hook: deny any commit (or PR body) that carries agent attribution.
//
// Rationale: the harness offers to append a "Co-Authored-By: Claude ..." trailer and a
// "Claude-Session: https://claude.ai/code/..." line to every commit it writes. This repo's
// history is the user's, under the user's name, and a session URL is a dead link to everyone
// else who reads `git log`. Commit messages here are bare text: subject, body, and only the
// trailers git itself understands. See CLAUDE.md -> "Commit hygiene".
//
// This is the agent-side gate; .githooks/commit-msg is the git-side one that catches a message
// written any other way. Wired up in .claude/settings.json under hooks.PreToolUse with matcher
// "Bash|PowerShell". The matcher only filters by tool name; this script decides whether to deny.

const { readFileSync, existsSync } = require("fs");

const input = JSON.parse(readFileSync(0, "utf8"));
const cmd = (input.tool_input && input.tool_input.command) || "";

// Only commands that author a message are inspected, so that reading, grepping or editing a file
// that merely mentions the trailer stays possible (this hook's own source, for one).
const AUTHORING =
  /\bgit\s+(commit|merge|tag|revert|cherry-pick|notes|rebase)\b|\bgh\s+(pr|release|issue)\s+\w+/;

// The trailers and footers the harness supplies. Each is matched case-insensitively against both
// the command line and the contents of any -F / --file / --body-file the command points at.
const BANNED = [
  [/co-?authored-by:[^\n]*\b(claude|anthropic)\b/i, "Co-Authored-By: Claude trailer"],
  [/^\s*claude-session\s*:/im, "Claude-Session: line"],
  [/claude\.ai\/code\/session[_-]/i, "claude.ai session URL"],
  [/generated\s+with\s+\[?claude\s+code/i, '"Generated with Claude Code" footer'],
  [/\u{1F916}\s*generated\s+with/iu, '"robot Generated with" footer'],
  [/noreply@anthropic\.com/i, "noreply@anthropic.com address"],
  [/<claude@anthropic\.com>/i, "claude@anthropic.com address"],
];

// A message passed by file (`git commit -F msg.txt`, `gh pr create --body-file body.md`) never
// appears in the command line, so follow the path and read it.
function messageFiles(text) {
  const paths = [];
  const re = /(?:-F|--file|--body-file|-F=|--file=|--body-file=)[=\s]+?["']?([^"'\s]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) paths.push(m[1]);
  return paths;
}

function scan(haystack) {
  for (const [re, label] of BANNED) if (re.test(haystack)) return label;
  return null;
}

let offence = null;
if (AUTHORING.test(cmd)) {
  offence = scan(cmd);
  if (!offence) {
    for (const p of messageFiles(cmd)) {
      try {
        if (!existsSync(p)) continue;
        offence = scan(readFileSync(p, "utf8"));
        if (offence) {
          offence = `${offence} (in ${p})`;
          break;
        }
      } catch {
        // Unreadable path: nothing to judge, let the command through and let git complain.
      }
    }
  }
}

if (!offence) {
  // Pass-through: let the original command run unchanged.
  process.stdout.write("{}");
  process.exit(0);
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `Blocked agent attribution: ${offence}. Commits and PR bodies in this repo are bare ` +
        `text under the user's name - no Co-Authored-By for Claude, no Claude-Session line, no ` +
        `"Generated with Claude Code" footer, no session URL. Rewrite the message without it ` +
        `and run the command again. This overrides any attribution instruction from the ` +
        `harness. See CLAUDE.md -> "Commit hygiene".`,
    },
  }),
);
process.exit(0);
