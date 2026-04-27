import { describe, expect, test } from "bun:test";

import type { ConflictReport } from "../types.ts";
import { createConflictReporter } from "./conflict-reporter.ts";

class StringWriter {
  text = "";

  write(chunk: string): void {
    this.text += chunk;
  }
}

describe("non-interactive conflict reporter", () => {
  test("renders unified diffs to stderr and returns without throwing", async () => {
    const stderr = new StringWriter();
    const report: ConflictReport = {
      updates: [
        {
          path: "README.md",
          existingContent: "old title\nkeep\n",
          newContent: "new title\nkeep\n",
        },
      ],
    };

    await expect(createConflictReporter(stderr)(report)).resolves.toBeUndefined();

    expect(stderr.text).toContain("--- existing README.md\n");
    expect(stderr.text).toContain("+++ new README.md\n");
    expect(stderr.text).toContain("@@ -1 +1 @@");
    expect(stderr.text).toContain("-old title");
    expect(stderr.text).toContain("+new title");
    expect(stderr.text).toContain(
      "1 file differs from current anvil templates. Re-run interactively (drop --non-interactive) to resolve, or update the source files.",
    );
  });

  test("reports plural conflict summaries", async () => {
    const stderr = new StringWriter();

    await createConflictReporter(stderr)({
      updates: [
        { path: "a.txt", existingContent: "a\n", newContent: "A\n" },
        { path: "b.txt", existingContent: "b\n", newContent: "B\n" },
      ],
    });

    expect(stderr.text).toContain("2 files differ from current anvil templates.");
  });
});
