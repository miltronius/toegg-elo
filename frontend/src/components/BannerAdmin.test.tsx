import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Banner } from "../lib/banners";

const announceRelease = vi.fn();
vi.mock("../lib/supabase", () => ({
  announceRelease: (...args: unknown[]) => announceRelease(...args),
  createBanner: vi.fn(),
  updateBanner: vi.fn(),
  deleteBanner: vi.fn(),
  reorderBanners: vi.fn(),
}));

const { BannerAdmin } = await import("./BannerAdmin");

const releaseRow: Banner = {
  id: "rel",
  message: "🎉 TöggElo v1.4.0 is out - see what's new",
  season_id: null,
  release_version: "1.4.0",
  starts_at: null,
  ends_at: null,
  is_active: true,
  audience: "everyone",
  sort_order: 0,
  created_by: null,
  created_at: "2026-09-26T00:00:00Z",
  updated_at: "2026-09-26T00:00:00Z",
};

function setup(banners: Banner[] = []) {
  const onChanged = vi.fn();
  const view = render(
    <BannerAdmin
      banners={banners}
      seasons={[]}
      onChanged={onChanged}
      appVersion="1.4.0"
    />,
  );
  return { onChanged, ...view };
}

describe("BannerAdmin release announcements", () => {
  // Braces matter: a function returned from beforeEach runs as teardown, and
  // mockReset returns the mock itself.
  beforeEach(() => {
    announceRelease.mockReset();
  });

  it("announces the running version", async () => {
    announceRelease.mockResolvedValue(undefined);
    const { onChanged } = setup();
    expect(screen.getByText("Current version: v1.4.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Announce" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(announceRelease).toHaveBeenCalledWith("1.4.0");
  });

  it("won't announce the same version twice", () => {
    setup([releaseRow]);
    expect(
      screen.getByRole("button", { name: "Already announced" }),
    ).toBeDisabled();
  });

  it("offers it again once that banner is deleted", () => {
    const { rerender } = setup([releaseRow]);
    rerender(
      <BannerAdmin
        banners={[]}
        seasons={[]}
        onChanged={vi.fn()}
        appVersion="1.4.0"
      />,
    );
    expect(screen.getByRole("button", { name: "Announce" })).toBeEnabled();
  });

  it("shows why an announcement failed", async () => {
    announceRelease.mockRejectedValue(new Error("duplicate key value"));
    const { onChanged } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Announce" }));
    expect(await screen.findByText("duplicate key value")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("marks release banners in the list", () => {
    setup([releaseRow]);
    expect(screen.getByText("Release")).toHaveAttribute(
      "title",
      "Announces v1.4.0 - clicking it opens the changelog",
    );
  });
});
