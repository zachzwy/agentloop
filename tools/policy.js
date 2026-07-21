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

  if (keys.length === 0) {
    throw new Error(
      `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}] is an empty object; expected one of "includes", "startsWith", or "includesAll"`,
    );
  }

  // Check for unknown keys
  const knownKeys = new Set(["includes", "startsWith", "includesAll"]);
  for (const key of keys) {
    if (!knownKeys.has(key)) {
      throw new Error(
        `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}] has unknown key "${key}"; expected one of "includes", "startsWith", or "includesAll"`,
      );
    }
  }

  // Validate each known key
  if ("includes" in c) {
    if (typeof c.includes !== "string") {
      throw new Error(
        `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}].includes must be a string, got ${typeof c.includes}`,
      );
    }
  }

  if ("startsWith" in c) {
    if (typeof c.startsWith !== "string") {
      throw new Error(
        `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}].startsWith must be a string, got ${typeof c.startsWith}`,
      );
    }
  }

  if ("includesAll" in c) {
    if (!Array.isArray(c.includesAll)) {
      throw new Error(
        `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}].includesAll must be an array, got ${typeof c.includesAll}`,
      );
    }
    for (let k = 0; k < c.includesAll.length; k++) {
      if (typeof c.includesAll[k] !== "string") {
        throw new Error(
          `Policy validation failed: rules[${ruleIndex}].args.${category}[${condIndex}].includesAll[${k}] must be a string, got ${typeof c.includesAll[k]}`,
        );
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
 * Check whether a single arg condition is satisfied.
 *
 * Supported condition shapes:
 *   { includes: "str" }       — any arg equals "str" exactly
 *   { startsWith: "str" }     — any arg starts with "str"
 *   { includesAll: ["a","b"] } — every string in the array appears as an arg
 *
 * @param {Record<string, unknown>} condition
 * @param {string[]} args
 * @returns {boolean}
 */
function matchCondition(condition, args) {
  if ("includes" in condition) {
    const val = /** @type {string} */ (condition.includes);
    return args.includes(val);
  }
  if ("startsWith" in condition) {
    const prefix = /** @type {string} */ (condition.startsWith);
    return args.some((a) => a.startsWith(prefix));
  }
  if ("includesAll" in condition) {
    const vals = /** @type {string[]} */ (condition.includesAll);
    return vals.every((v) => args.includes(v));
  }
  return false;
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
  const policy = await loadPolicy();
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
