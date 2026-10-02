import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SeasonScheduleAdmin } from "./SeasonScheduleAdmin";
import type { Season } from "../lib/supabase";

// Local time throughout, like the fields.
const T0 = new Date(2026, 9, 1, 12, 0).getTime();
const DAY = 86_400_000;
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
  voting_closes_at: null,
  ...over,
});
// S4 ended when S5 started, a day before T0: its ballot is open.
const S4 = season({
  id: "s4",
  number: 4,
  name: "Summer",
  is_active: false,
  started_at: new Date(2026, 5, 1).toISOString(),
  ended_at: new Date(T0 - DAY).toISOString(),
});
const S5_STARTED = season({ started_at: new Date(T0 - DAY).toISOString() });

function setup(over: Partial<React.ComponentProps<typeof SeasonScheduleAdmin>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onOpenVoting = vi.fn().mockResolvedValue(undefined);
  const onCloseVoting = vi.fn().mockResolvedValue(undefined);
  render(
    <SeasonScheduleAdmin
      season={season()}
      nextSeason={null}
      onSave={onSave}
      onOpenVoting={onOpenVoting}
      onCloseVoting={onCloseVoting}
      now={T0}
      {...over}
    />,
  );
  return {
    onSave,
    onOpenVoting,
    onCloseVoting,
    user: userEvent.setup(),
    save: () => screen.getByRole("button", { name: "Save" }),
  };
}
const plannedEnd = () => screen.getByLabelText("Planned end");
const votingCloses = () => screen.getByLabelText("Voting closes (optional)");
afterEach(() => vi.restoreAllMocks());

describe("SeasonScheduleAdmin", () => {
  it("shows the stored dates in Swiss format", () => {
    setup({
      season: season({
        planned_end_at: new Date(2026, 10, 30, 18, 0).toISOString(),
        voting_closes_at: new Date(2026, 11, 14, 12, 0).toISOString(),
      }),
    });
    expect(plannedEnd()).toHaveValue("30.11.2026 18:00");
    expect(votingCloses()).toHaveValue("14.12.2026 12:00");
  });

  it("saves only what changed", async () => {
    const { user, save, onSave } = setup();
    expect(save()).toBeDisabled();
    await user.type(plannedEnd(), "301120261800");
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith({
      planned_end_at: new Date(2026, 10, 30, 18, 0).toISOString(),
    });
  });

  it("saves a closing date, and an emptied one as the default", async () => {
    const { user, save, onSave } = setup({
      season: season({ voting_closes_at: new Date(2026, 11, 14).toISOString() }),
    });
    await user.clear(votingCloses());
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith({ voting_closes_at: null });
  });

  it("refuses a date that doesn't exist or comes before the start", async () => {
    const { user, save, onSave } = setup();
    await user.type(votingCloses(), "31022027");
    await user.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("dd.mm.yyyy hh:mm");
    await user.clear(votingCloses());
    await user.type(votingCloses(), "01072026");
    await user.click(save());
    expect(screen.getByRole("alert")).toHaveTextContent("after the season starts");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("opens voting after a confirm, and only before it is open", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    const { user, onOpenVoting } = setup();
    expect(screen.queryByRole("button", { name: "Close voting now" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open voting now" }));
    expect(onOpenVoting).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Open voting now" }));
    expect(onOpenVoting).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("offers Close voting now while the vote is open", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user, onCloseVoting } = setup({
      season: season({ voting_opened_at: new Date(T0 - 1000).toISOString() }),
    });
    expect(screen.getByText("Open until 14 days into the next season")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open voting now" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close voting now" }));
    expect(onCloseVoting).toHaveBeenCalledOnce();
  });

  it("manages an ended season's open ballot without planned end or opening", () => {
    setup({ season: S4, nextSeason: S5_STARTED });
    expect(screen.getByRole("heading")).toHaveTextContent("S4 · Summer");
    expect(screen.queryByLabelText("Planned end")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open voting now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close voting now" })).toBeInTheDocument();
    expect(screen.getByText(/^Open until \d{2}\.\d{2}\.2026/)).toBeInTheDocument();
  });

  it("says when a closed vote closed, and offers neither button", () => {
    setup({
      season: season({
        voting_opened_at: new Date(T0 - 2 * DAY).toISOString(),
        voting_closes_at: new Date(T0 - DAY).toISOString(),
      }),
    });
    expect(screen.getByText(/^Closed 30\.09\.2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /voting now/ })).toBeNull();
  });

  it("explains a refusal", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    setup({ onOpenVoting: vi.fn().mockRejectedValue({ message: "season_not_active" }) });
    await userEvent.click(screen.getByRole("button", { name: "Open voting now" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("running season"));
  });
});
