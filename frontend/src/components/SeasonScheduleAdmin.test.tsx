import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SeasonScheduleAdmin } from "./SeasonScheduleAdmin";
import type { Season } from "../lib/supabase";

// Local time throughout, like the field.
const T0 = new Date(2026, 9, 1, 12, 0).getTime();
const season = (over: Partial<Season> = {}): Season => ({
  id: "s5",
  number: 5,
  name: "Autumn",
  k_factor: 48,
  partner_weight: 0.25,
  inactivity_penalty_percent: 0,
  started_at: new Date(2026, 7, 1).toISOString(),
  ended_at: null,
  is_active: true,
  created_at: new Date(2026, 7, 1).toISOString(),
  planned_end_at: null,
  voting_opened_at: null,
  ...over,
});

function setup(over: Partial<React.ComponentProps<typeof SeasonScheduleAdmin>> = {}) {
  const onSavePlannedEnd = vi.fn().mockResolvedValue(undefined);
  const onOpenVoting = vi.fn().mockResolvedValue(undefined);
  render(
    <SeasonScheduleAdmin
      season={season()}
      onSavePlannedEnd={onSavePlannedEnd}
      onOpenVoting={onOpenVoting}
      now={T0}
      {...over}
    />,
  );
  return {
    onSavePlannedEnd,
    onOpenVoting,
    user: userEvent.setup(),
    field: screen.getByLabelText("Planned end"),
    save: () => screen.getByRole("button", { name: "Save" }),
  };
}
afterEach(() => vi.restoreAllMocks());

describe("SeasonScheduleAdmin", () => {
  it("shows the planned end in Swiss format", () => {
    const { field } = setup({
      season: season({ planned_end_at: new Date(2026, 10, 30, 18, 0).toISOString() }),
    });
    expect(field).toHaveValue("30.11.2026 18:00");
  });

  it("saves a typed planned end", async () => {
    const { user, field, save, onSavePlannedEnd } = setup();
    await user.type(field, "301120261800");
    await user.click(save());
    expect(onSavePlannedEnd).toHaveBeenCalledWith(new Date(2026, 10, 30, 18, 0).toISOString());
  });

  it("saves an emptied field as no planned end", async () => {
    const { user, field, save, onSavePlannedEnd } = setup({
      season: season({ planned_end_at: new Date(2026, 10, 30).toISOString() }),
    });
    await user.clear(field);
    await user.click(save());
    expect(onSavePlannedEnd).toHaveBeenCalledWith(null);
  });

  it("refuses a date that doesn't exist or comes before the start", async () => {
    const { user, field, save, onSavePlannedEnd } = setup();
    await user.type(field, "31022027");
    await user.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("dd.mm.yyyy hh:mm");
    await user.clear(field);
    await user.type(field, "01072026");
    await user.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("after the season starts");
    expect(onSavePlannedEnd).not.toHaveBeenCalled();
  });

  it("opens voting after a confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user, onOpenVoting } = setup();
    await user.click(screen.getByRole("button", { name: "Open voting now" }));
    expect(onOpenVoting).toHaveBeenCalledOnce();
  });

  it("does nothing when the confirm is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user, onOpenVoting } = setup();
    await user.click(screen.getByRole("button", { name: "Open voting now" }));
    expect(onOpenVoting).not.toHaveBeenCalled();
  });

  it("says so once voting is open", () => {
    setup({ season: season({ voting_opened_at: new Date(T0 - 1000).toISOString() }) });
    expect(screen.getByRole("button", { name: "Voting is open" })).toBeDisabled();
  });

  it("explains a refusal", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = setup({
      onOpenVoting: vi.fn().mockRejectedValue({ message: "season_not_active" }),
    });
    await user.click(screen.getByRole("button", { name: "Open voting now" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("running season"),
    );
  });
});
