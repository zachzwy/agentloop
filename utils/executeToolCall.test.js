import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "./executeToolCall.js";

// Uses the real tools (no mocks): the firewall must hold for actual tool code.
describe("executeToolCall — exception firewall", () => {
  it("returns an error string (never throws) when a tool throws on a malformed arg", async () => {
    // Wrong key ('path' vs 'filePath') -> filePath undefined -> read_file's
    // outsideCwd()/path.resolve() throws BEFORE its own try. Must not crash.
    const call = {
      id: "c1",
      function: {
        name: "read_file",
        arguments: JSON.stringify({ path: "README.md" }),
      },
    };
    const result = await executeToolCall(call);
    assert.equal(typeof result, "string");
    assert.match(result, /read_file/);
    assert.match(result, /failed/i);
  });

  it("firewalls a missing path arg for every path tool", async () => {
    for (const name of ["read_file", "list_files", "write_file"]) {
      const result = await executeToolCall({
        id: "x",
        function: { name, arguments: JSON.stringify({}) },
      });
      assert.equal(typeof result, "string", `${name} must return a string`);
      assert.match(result, /Error/i, `${name} must return an error, not throw`);
    }
  });

  it("reports unparseable arguments", async () => {
    const result = await executeToolCall({
      id: "c2",
      function: { name: "read_file", arguments: "{not json" },
    });
    assert.match(result, /could not parse/);
  });

  it("reports unknown tools", async () => {
    const result = await executeToolCall({
      id: "c3",
      function: { name: "no_such_tool", arguments: "{}" },
    });
    assert.match(result, /unknown tool/);
  });

  it("still returns normal output on a valid call", async () => {
    const result = await executeToolCall({
      id: "c4",
      function: { name: "list_files", arguments: JSON.stringify({ dirPath: "." }) },
    });
    assert.equal(typeof result, "string");
    assert.doesNotMatch(result, /failed:/);
  });
});
