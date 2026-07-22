// @project: demo
// Parse a single comma-separated line into an array of trimmed fields.
// Example: parseLine("a, b ,c") -> ["a", "b", "c"]

export function parseLine(line) {
  // BUG: splits on ";" but the documented format is comma-separated.
  return line.split(";").map((s) => s.trim());
}
