// @ts-check
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * @typedef {{
 *   command: string;
 *   decision: "allow" | "deny";
 *   reason: string;
 *   args?: {
 *     allowWhen?: Record<string, unknown>[];
 *     denyWhen?: Record<string, unknown>[];
 *   };
 * }} Rule
 *
 * @typedef {{
 *   version: number;
 *   description: string;
 *   defaultDecision: "allow" | "deny";
 *   rules: Rule[];
 * }} Policy
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {Policy | null} */
let cachedPolicy = null;

// ---------------------------------------------------------------------------
// Runtime validation — ensures policy.json matches the Policy type shape.
// Throws a descriptive error on first structural violation.
// ---------------------------------------------------------------------------

/**
 * Validate that a parsed policy object conforms to the Policy type.
 *
 * @param {unknown} value - The parsed JSON value.
 * @returns {asserts value is Policy}
 */
export function validatePolicy(value) {
  // Arrays are typeof "object" in JS, so check explicitly first.
  if (Array.isArray(value)) {
    throw new Error(
      "Policy validation failed: expected a top-level object, got array",
    );
  }

  if (typeof value !== "object" || value === null) {
    throw new Error(
      "Policy validation failed: expected a top-level object, got " +
        (value === null ? "null" : typeof value),
    );
  }

  const obj = /** @type {Record<string, unknown>} */ (value);

  // ---- version -----------------------------------------------------------
  if (
    typeof obj.version !== "number" ||
    !Number.isInteger(obj.version) ||
    obj.version < 1
  ) {
    throw new Error(
      `Policy validation failed: 'version' must be a positive integer, got ${JSON.stringify(obj.version)}`,
    );
  }

  // ---- description -------------------------------------------------------
  if (typeof obj.description !== "string" || obj.description.length === 0) {
    throw new Error(
      `Policy validation failed: 'description' must be a non-empty string, got ${JSON.stringify(obj.description)}`,
    );
  }

  // ---- defaultDecision ---------------------------------------------------
  if (obj.defaultDecision !== "allow" && obj.defaultDecision !== "deny") {
    throw new Error(
      `Policy validation failed: 'defaultDecision' must be "allow" or "deny", got ${JSON.stringify(obj.defaultDecision)}`,
    );
  }

  // ---- rules -------------------------------------------------------------
  if (!Array.isArray(obj.rules)) {
    throw new Error(
      `Policy validation failed: 'rules' must be an array, got ${typeof obj.rules}`,
    );
  }

  for (let i = 0; i < obj.rules.length; i++) {
    validateRule(obj.rules[i], i);
  }
}

/**
 * Validate a single rule entry.
 *
 * @param {unknown} rule
 * @param {number} index
 * @returns {asserts rule is Rule}
 */
function validateRule(rule, index) {
  if (typeof rule !== "object" || rule === null) {
    throw new Error(
      `Policy validation failed: rules[${index}] must be an object, got ${rule === null ? "null" : typeof rule}`,
    );
  }

  const r = /** @type {Record<string, unknown>} */ (rule);

  // ---- command -----------------------------------------------------------
  if (typeof r.command !== "string" || r.command.length === 0) {
    throw new Error(
      `Policy validation failed: rules[${index}].command must be a non-empty string, got ${JSON.stringify(r.command)}`,
    );
  }

  // ---- decision ----------------------------------------------------------
  if (r.decision !== "allow" && r.decision !== "deny") {
    throw new Error(
      `Policy validation failed: rules[${index}].decision must be "allow" or "deny", got ${JSON.stringify(r.decision)}`,
    );
  }

  // ---- reason ------------------------------------------------------------
  if (typeof r.reason !== "string" || r.reason.length === 0) {
    throw new Error(
      `Policy validation failed: rules[${index}].reason must be a non-empty string, got ${JSON.stringify(r.reason)}`,
    );
  }

  // ---- args (optional) ---------------------------------------------------
  if (r.args !== undefined) {
    if (
      typeof r.args !== "object" ||
      r.args === null ||
      Array.isArray(r.args)
    ) {
      throw new Error(
        `Policy validation failed: rules[${index}].args must be an object, got ${r.args === null ? "null" : Array.isArray(r.args) ? "array" : typeof r.args}`,
      );
    }

    const argsObj = /** @type {Record<string, unknown>} */ (r.args);

    // allowWhen
    if (argsObj.allowWhen !== undefined) {
      if (!Array.isArray(argsObj.allowWhen)) {
        throw new Error(
          `Policy validation failed: rules[${index}].args.allowWhen must be an array, got ${typeof argsObj.allowWhen}`,
        );
      }
      for (let j = 0; j < argsObj.allowWhen.length; j++) {
        validateCondition(argsObj.allowWhen[j], index, "allowWhen", j);
      }
    }

    // denyWhen
    if (argsObj.denyWhen !== undefined) {
      if (!Array.isArray(argsObj.denyWhen)) {
        throw new Error(
          `Policy validation failed: rules[${index}].args.denyWhen must be an array, got ${typeof argsObj.denyWhen}`,
        );
      }
      for (let j = 0; j < argsObj.denyWhen.length; j++) {
        validateCondition(argsObj.denyWhen[j], index, "denyWhen", j);
      }
    }
  }
}

/**
 * Validate a single condition object (allowWhen/denyWhen entry).
 *
 * @param {unknown} condition
 * @param {number} ruleIndex
 * @param {"allowWhen" | "denyWhen"} category
 * @param {number} condIndex
 */
function validateCondition(condition, ruleIndex, category, condIndex) {
  if (typeof condition !== "object" || condition === null) {
    throw new Error(
      `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}] must be an object, got ${condition === null ? "null" : typeof condition}`,
    );
  }

  const c = /** @type {Record<string, unknown>} */ (condition);
  const keys = Object.keys(c);

  // Position-aware keys (firstArg/firstArgIn) are what make the policy safe for
  // interpreters and subcommand tools — see matchCondition.
  const KNOWN = [
    "includes",
    "startsWith",
    "includesAll",
    "firstArg",
    "firstArgIn",
  ];

  if (keys.length === 0) {
    throw new Error(
      `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}] is an empty object; expected one of ${KNOWN.join(", ")}`,
    );
  }

  for (const key of keys) {
    if (!KNOWN.includes(key)) {
      throw new Error(
        `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}] has unknown key "${key}"; expected one of ${KNOWN.join(", ")}`,
      );
    }
  }

  // String-valued keys.
  for (const key of ["includes", "startsWith", "firstArg"]) {
    if (key in c && typeof c[key] !== "string") {
      throw new Error(
        `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}].${key} must be a string, got ${typeof c[key]}`,
      );
    }
  }

  // String-array-valued keys.
  for (const key of ["includesAll", "firstArgIn"]) {
    if (key in c) {
      const arr = c[key];
      if (!Array.isArray(arr)) {
        throw new Error(
          `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}].${key} must be an array, got ${typeof arr}`,
        );
      }
      for (let k = 0; k < arr.length; k++) {
        if (typeof arr[k] !== "string") {
          throw new Error(
            `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}].${key}[${k}] must be a string, got ${typeof arr[k]}`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Policy loading
// ---------------------------------------------------------------------------

/**
 * Load policy.json from disk (cached after first read).
 * @returns {Promise<Policy>}
 */
async function loadPolicy() {
  if (cachedPolicy) return cachedPolicy;
  const raw = await readFile(path.join(__dirname, "policy.json"), "utf8");
  const parsed = JSON.parse(raw);
  validatePolicy(parsed);
  cachedPolicy = parsed;
  return cachedPolicy;
}

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

/**
 * Check whether a single arg condition is satisfied. ALL keys present in the
 * condition must match (logical AND) — so `{ firstArg: "run", includes: "format" }`
 * means argv[0] === "run" AND "format" appears in argv.
 *
 * Supported keys:
 *   { includes: "str" }        — "str" appears anywhere in argv
 *   { startsWith: "str" }      — some arg starts with "str"
 *   { includesAll: ["a","b"] } — every listed string appears in argv
 *   { firstArg: "str" }        — argv[0] === "str"  (POSITIONAL)
 *   { firstArgIn: [...] }      — argv[0] is one of the list (POSITIONAL)
 *
 * The positional keys are the security-relevant ones: interpreter flags
 * (node --test) and subcommands (git status) only mean what the policy assumes
 * when they are in the FIRST position. Checking "appears anywhere" let
 * `node evil.js --test` and `git -c pager=cmd log` slip through.
 *
 * @param {Record<string, unknown>} condition
 * @param {string[]} argv
 * @returns {boolean}
 */
function matchCondition(condition, argv) {
  const entries = Object.entries(condition);
  if (entries.length === 0) return false;

  for (const [key, val] of entries) {
    switch (key) {
      case "includes":
        if (!argv.includes(/** @type {string} */ (val))) return false;
        break;
      case "startsWith": {
        const prefix = /** @type {string} */ (val);
        if (!argv.some((a) => a.startsWith(prefix))) return false;
        break;
      }
      case "includesAll":
        if (!(/** @type {string[]} */ (val).every((v) => argv.includes(v))))
          return false;
        break;
      case "firstArg":
        if (argv[0] !== val) return false;
        break;
      case "firstArgIn":
        if (!(/** @type {string[]} */ (val).includes(argv[0]))) return false;
        break;
      default:
        return false; // unknown key (validator should have caught it)
    }
  }
  return true;
}

/**
 * Check whether any condition in a list matches.
 * @param {Record<string, unknown>[] | undefined} conditions
 * @param {string[]} args
 * @returns {boolean}
 */
function anyConditionMatches(conditions, args) {
  if (!conditions || conditions.length === 0) return false;
  return conditions.some((c) => matchCondition(c, args));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate the policy for a given command and args.
 *
 * @param {string} command — the program name (argv[0])
 * @param {string[]} args — the argument array
 * @returns {Promise<{ allowed: boolean; reason: string }>}
 */
export async function checkPolicy(command, args) {
  // Fail CLOSED: a missing or malformed policy.json must deny every command,
  // never crash the run. A security gate that throws is a gate that's off.
  let policy;
  try {
    policy = await loadPolicy();
  } catch (err) {
    return {
      allowed: false,
      reason: `Policy unavailable — failing closed (denying all): ${err.message}`,
    };
  }

  const argv = Array.isArray(args) ? args : [];

  // Find the first rule matching this command name.
  const rule = policy.rules.find((r) => r.command === command);

  if (!rule) {
    return {
      allowed: policy.defaultDecision === "allow",
      reason: `Command '${command}' is not in the policy allowlist. Denied by default.`,
    };
  }

  // If the rule has arg-dependent conditions, evaluate them.
  if (rule.args) {
    // denyWhen conditions take priority: if any match, deny regardless.
    if (anyConditionMatches(rule.args.denyWhen, argv)) {
      return {
        allowed: false,
        reason: `Command '${command}' denied by argument policy: ${rule.reason}`,
      };
    }
    // allowWhen conditions: if any match, allow.
    if (anyConditionMatches(rule.args.allowWhen, argv)) {
      return {
        allowed: true,
        reason: rule.reason,
      };
    }
    // No arg condition matched — fall through to the rule's top-level decision.
  }

  // Use the rule's top-level decision.
  const allowed = rule.decision === "allow";
  return {
    allowed,
    reason: allowed
      ? rule.reason
      : `Command '${command}' denied: ${rule.reason}`,
  };
}

/**
 * Reset the cached policy (useful in tests).
 */
export function resetPolicyCache() {
  cachedPolicy = null;
}
