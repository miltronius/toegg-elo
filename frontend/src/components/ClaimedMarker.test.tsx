import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClaimedMarker } from "./ClaimedMarker";

describe("ClaimedMarker", () => {
  it("renders nothing for an unclaimed player", () => {
    const { container } = render(<ClaimedMarker isLinked={false} isMe={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks someone else's claimed player with the icon and a help cursor", () => {
    render(<ClaimedMarker isLinked isMe={false} />);
    const marker = screen.getByTitle("Claimed by an account");
    expect(marker).toHaveTextContent("🪪");
    expect(marker).not.toHaveTextContent("This is you");
    // Not clickable, but it has a tooltip - so the help cursor, not text.
    expect(marker).toHaveClass("claimed-marker");
  });

  it("badges your own player as you", () => {
    render(<ClaimedMarker isLinked isMe />);
    const badge = screen.getByText(/This is you/);
    expect(badge).toHaveTextContent("🪪");
    expect(badge).toHaveClass("streak-badge", "you", "claimed-marker");
    expect(badge).toHaveAttribute("title", "Your account is linked to this player");
  });
});
