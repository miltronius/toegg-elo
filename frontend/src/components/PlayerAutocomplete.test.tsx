import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerAutocomplete } from "./PlayerAutocomplete";
import type { Player } from "../lib/supabase";

const player = (id: string, name: string, elo = 1500): Player => ({
  id,
  name,
  current_elo: elo,
  matches_played: 0,
  wins: 0,
  losses: 0,
  created_at: "2026-01-01T00:00:00Z",
  anonymous_name: null,
});

const PLAYERS = [
  player("p1", "Susanne", 1400),
  player("p2", "Anna", 1600),
  player("p3", "Müller", 1500),
  player("p4", "Andreas", 1700),
];

function setup(props: Partial<React.ComponentProps<typeof PlayerAutocomplete>> = {}) {
  const onChange = vi.fn();
  const view = render(
    <PlayerAutocomplete players={PLAYERS} value="" onChange={onChange} {...props} />,
  );
  return { onChange, view, input: screen.getByRole("combobox") };
}

/** Option labels: the name span, or the whole option for the "empty" choice. */
const optionNames = () =>
  screen
    .getAllByRole("option")
    .map((o) => o.querySelector(".player-ac-name")?.textContent ?? o.textContent);

describe("PlayerAutocomplete", () => {
  it("lists the whole roster alphabetically on focus", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.click(input);

    expect(optionNames()).toEqual(["Andreas", "Anna", "Müller", "Susanne"]);
  });

  it("narrows the list as you type, prefix matches first", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.click(input);
    await user.type(input, "an");

    expect(optionNames()).toEqual(["Andreas", "Anna", "Susanne"]);
  });

  it("finds an umlaut name typed without the umlaut", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "muller");

    expect(optionNames()).toEqual(["Müller"]);
  });

  it("selects by id when an option is clicked", async () => {
    const user = userEvent.setup();
    const { input, onChange } = setup();
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /Anna/ }));

    expect(onChange).toHaveBeenCalledWith("p2");
  });

  it("selects with the arrow keys and Enter", async () => {
    const user = userEvent.setup();
    const { input, onChange } = setup();
    await user.click(input);
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}"); // Andreas, then Anna

    expect(onChange).toHaveBeenCalledWith("p2");
  });

  it("takes the only remaining match on Enter without arrowing", async () => {
    const user = userEvent.setup();
    const { input, onChange } = setup();
    await user.type(input, "susa{Enter}");

    expect(onChange).toHaveBeenCalledWith("p1");
  });

  it("shows the selected player's name when closed", () => {
    setup({ value: "p3" });
    expect(screen.getByRole("combobox")).toHaveValue("Müller");
  });

  it("hides players already picked elsewhere", async () => {
    const user = userEvent.setup();
    const { input } = setup({ excludeIds: ["p2", "p4"] });
    await user.click(input);

    expect(optionNames()).toEqual(["Müller", "Susanne"]);
  });

  it("prefers season Elo over all-time when given", async () => {
    const user = userEvent.setup();
    const { input } = setup({ seasonEloMap: new Map([["p2", 1234]]) });
    await user.click(input);

    expect(screen.getByRole("option", { name: /Anna/ })).toHaveTextContent("1234");
    // Anyone missing from the season map falls back to their all-time rating.
    expect(screen.getByRole("option", { name: /Susanne/ })).toHaveTextContent("1400");
  });

  it("clears the selection with the clear button", async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ value: "p2" });
    await user.click(screen.getByRole("button", { name: /clear/i }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("offers an explicit empty choice when one is labelled", async () => {
    const user = userEvent.setup();
    const { input, onChange } = setup({ value: "p2", emptyLabel: "All players" });
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "All players" }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  describe("hover highlight", () => {
    it("moves the highlight onto a hovered option", async () => {
      const user = userEvent.setup();
      const { input } = setup();
      await user.click(input);

      const [first, second] = screen.getAllByRole("option");
      await user.hover(second);
      expect(second).toHaveClass("active");
      expect(first).not.toHaveClass("active");

      await user.hover(first);
      expect(first).toHaveClass("active");
      expect(second).not.toHaveClass("active");
    });

    it("highlights the empty choice on hover too", async () => {
      const user = userEvent.setup();
      const { input } = setup({ value: "p2", emptyLabel: "All players" });
      await user.click(input);

      const empty = screen.getByRole("option", { name: "All players" });
      expect(empty).not.toHaveClass("active");

      await user.hover(empty);
      expect(empty).toHaveClass("active");
    });

    it("never lights a hovered row and an arrowed-to row at once", async () => {
      const user = userEvent.setup();
      const { input } = setup({ emptyLabel: "All players" });
      await user.click(input);

      await user.hover(screen.getByRole("option", { name: "All players" }));
      // Arrow keys skip the empty entry, so the highlight has to leave it.
      await user.keyboard("{ArrowDown}");

      const active = screen
        .getAllByRole("option")
        .filter((o) => o.classList.contains("active"));
      expect(active).toHaveLength(1);
      expect(active[0]).not.toHaveTextContent("All players");
    });
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "zzz");

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/no player matches/i)).toBeInTheDocument();
  });

  it("reverts to the selection on Escape rather than keeping stray text", async () => {
    const user = userEvent.setup();
    const { input } = setup({ value: "p2" });
    await user.type(input, "zzz");
    await user.keyboard("{Escape}");

    expect(input).toHaveValue("Anna");
  });
});
