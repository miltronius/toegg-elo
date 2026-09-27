import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClaimPlayerDialog } from "./ClaimPlayerDialog";

describe("ClaimPlayerDialog", () => {
  it("names the player and warns that only an admin can undo it", () => {
    render(
      <ClaimPlayerDialog playerName="Anna" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Anna").tagName).toBe("B");
    expect(screen.getByText(/Only an admin can undo this/)).toBeInTheDocument();
  });

  it("claims on confirm", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ClaimPlayerDialog playerName="Anna" onConfirm={onConfirm} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("stays open and explains a refusal from the server", async () => {
    const onConfirm = vi.fn().mockRejectedValue({ message: "player_already_linked" });
    const onClose = vi.fn();
    render(<ClaimPlayerDialog playerName="Anna" onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Someone has already claimed this player.",
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for an unexpected error", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    render(<ClaimPlayerDialog playerName="Anna" onConfirm={onConfirm} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong"),
    );
  });

  it("cancels without claiming", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ClaimPlayerDialog playerName="Anna" onConfirm={onConfirm} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders at the document root, not inside the panel that opened it", () => {
    // PlayerDetail's .modal-panel styles its children (Win95 gives them side
    // margins), which would shrink the overlay and leave undimmed strips.
    const host = document.createElement("div");
    host.className = "modal-panel";
    document.body.appendChild(host);
    render(
      <ClaimPlayerDialog playerName="Anna" onConfirm={vi.fn()} onClose={vi.fn()} />,
      { container: host },
    );
    const overlay = screen.getByRole("dialog").parentElement!;
    expect(overlay.parentElement).toBe(document.body);
    host.remove();
  });
});
