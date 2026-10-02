import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SectionNav } from "./SectionNav";

const ENTRIES = [
  { id: "sec-a", label: "User Management" },
  { id: "sec-b", label: "Message Banner", detail: "and more" },
];

function renderPage() {
  render(
    <>
      <SectionNav entries={ENTRIES} label="On this page" />
      <section id="sec-a" tabIndex={-1}>
        A
      </section>
      <section id="sec-b" tabIndex={-1}>
        B
      </section>
    </>,
  );
  return screen.getByRole("navigation", { name: "On this page" });
}

afterEach(() => vi.restoreAllMocks());

describe("SectionNav", () => {
  it("lists the sections as anchor links, marking the first as current", () => {
    const nav = renderPage();
    const links = nav.querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual(["#sec-a", "#sec-b"]);
    expect(links[0]).toHaveAttribute("aria-current", "location");
    expect(links[1]).not.toHaveAttribute("aria-current");
  });

  it("scrolls smoothly to a section and focuses it", async () => {
    // jsdom has no layout, so no scrollIntoView either.
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderPage();
    await userEvent.click(screen.getByRole("link", { name: /^Message Banner/ }));
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("sec-b"));
    expect(document.getElementById("sec-b")).toHaveFocus();
    expect(screen.getByRole("link", { name: /^Message Banner/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });
});

describe("SectionNav with lazily rendered sections", () => {
  it("asks the page to render a missing section, then scrolls to it", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    function Page() {
      const [shown, setShown] = useState(false);
      return (
        <>
          <SectionNav
            entries={[{ id: "late", label: "Late" }]}
            label="Seasons"
            onReveal={() => setShown(true)}
          />
          {shown && (
            <section id="late" tabIndex={-1}>
              Late
            </section>
          )}
        </>
      );
    }
    render(<Page />);
    await userEvent.click(screen.getByRole("link", { name: "Late" }));
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("late"));
    expect(document.getElementById("late")).toHaveFocus();
  });
});
