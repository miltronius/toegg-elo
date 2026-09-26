import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChangelogDialog } from "./ChangelogDialog";
import type { Release } from "../lib/changelog";

const RELEASES: Release[] = [
  {
    version: "1.2.0",
    date: "2026-10-02",
    sections: [
      {
        kind: "minor",
        title: "Minor Changes",
        entries: [
          {
            summary: "Goal achievements with `teamGoals`",
            details: "Pair tiers carry meta.partnerId.",
            prNumber: 125,
            prUrl: "https://github.com/miltronius/toegg-elo/pull/125",
            author: "miltronius",
          },
        ],
      },
    ],
  },
  {
    version: "1.1.0",
    date: null,
    sections: [
      {
        kind: "other",
        title: "",
        entries: [
          {
            summary: "Relationship graph",
            details: null,
            prNumber: null,
            prUrl: null,
            author: null,
          },
        ],
      },
    ],
  },
];

function setup(
  props: Partial<React.ComponentProps<typeof ChangelogDialog>> = {},
) {
  const onClose = vi.fn();
  render(
    <ChangelogDialog
      releases={RELEASES}
      focusVersion={null}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose };
}

describe("ChangelogDialog", () => {
  it("lists releases newest first with a Swiss date", () => {
    setup();
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "v1.2.002.10.2026",
      "v1.1.0",
    ]);
  });

  it("names sections by kind and renders inline code", () => {
    setup();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("teamGoals").tagName).toBe("CODE");
  });

  it("links the PR and keeps developer detail behind Details", () => {
    setup();
    expect(screen.getByRole("link", { name: "#125" })).toHaveAttribute(
      "href",
      "https://github.com/miltronius/toegg-elo/pull/125",
    );
    expect(screen.getByText("Details").closest("details")).not.toHaveAttribute(
      "open",
    );
  });

  it("says so when there are no releases yet", () => {
    setup({ releases: [] });
    expect(screen.getByText("No releases yet.")).toBeInTheDocument();
  });

  it("highlights the release it was opened for", () => {
    setup({ focusVersion: "1.1.0" });
    const focused = document.querySelector(".changelog-release--focus");
    expect(focused?.querySelector("h3")?.textContent).toBe("v1.1.0");
  });

  it("opens without a highlight for a version it doesn't know", () => {
    setup({ focusVersion: "9.9.9" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.querySelector(".changelog-release--focus")).toBeNull();
  });

  it("closes on Escape and on the backdrop, not on the panel", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    const backdrop = screen.getByTestId("changelog-backdrop");
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores a click on the backdrop whose press started elsewhere", () => {
    // On touch, the click of the tap that opened the dialog can land on the
    // freshly rendered backdrop - that must not close it again.
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId("changelog-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
