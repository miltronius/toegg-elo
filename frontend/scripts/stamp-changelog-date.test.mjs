import { describe, it, expect } from "vitest";
import { stampChangelogDate } from "./stamp-changelog-date.mjs";

const DATE = "2026-09-26";

describe("stampChangelogDate", () => {
  it("dates the newest release heading", () => {
    const md = "# toegg-elo-frontend\n\n## 1.1.0\n\n### Minor Changes\n\n- x\n\n## 1.0.1 (2026-09-01)\n";
    expect(stampChangelogDate(md, DATE)).toBe(
      "# toegg-elo-frontend\n\n## 1.1.0 (2026-09-26)\n\n### Minor Changes\n\n- x\n\n## 1.0.1 (2026-09-01)\n",
    );
  });

  it("leaves an already dated heading alone, so re-running is harmless", () => {
    const md = "# t\n\n## 1.1.0 (2026-09-20)\n\n- x\n";
    expect(stampChangelogDate(md, DATE)).toBe(md);
  });

  it("never touches an older undated heading", () => {
    const md = "# t\n\n## 1.1.0 (2026-09-20)\n\n## 1.0.0\n";
    expect(stampChangelogDate(md, DATE)).toBe(md);
  });

  it("does nothing when there is no release yet", () => {
    expect(stampChangelogDate("# t\n", DATE)).toBe("# t\n");
  });

  it("keeps Windows line endings intact", () => {
    const md = "# t\r\n\r\n## 1.1.0\r\n\r\n- x\r\n";
    expect(stampChangelogDate(md, DATE)).toBe("# t\r\n\r\n## 1.1.0 (2026-09-26)\r\n\r\n- x\r\n");
  });
});
