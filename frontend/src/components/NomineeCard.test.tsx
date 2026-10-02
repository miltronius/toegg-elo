import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NomineeCard } from "./NomineeCard";

function renderCard(over: Partial<React.ComponentProps<typeof NomineeCard>> = {}) {
  const onClick = vi.fn();
  render(<NomineeCard name="Anna Muster" meta="1500 Elo" picked={false} onClick={onClick} {...over} />);
  const button = screen.getByRole("button", { name: /^Anna Muster/ });
  // jsdom lays nothing out; give the card a 100×80 box at (10, 20).
  button.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 100, height: 80, right: 110, bottom: 100 }) as DOMRect;
  return { button, onClick };
}

describe("NomineeCard", () => {
  it("is a toggle button named after the player, with initials as decoration", () => {
    const { button } = renderCard({ picked: true });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.querySelector(".nominee-avatar")).toHaveTextContent("AM");
    expect(button.querySelector(".nominee-avatar")).toHaveAttribute("aria-hidden", "true");
  });

  it("tilts towards a mouse and settles when it leaves", () => {
    const { button } = renderCard();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    fireEvent.pointerMove(button, { pointerType: "mouse", clientX: 110, clientY: 20 });
    expect(button.style.getPropertyValue("--ry")).toBe("-12deg");
    expect(button.style.getPropertyValue("--rx")).toBe("-12deg");
    expect(button.style.getPropertyValue("--mx")).toBe("100%");
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    expect(button.style.getPropertyValue("--ry")).toBe("");
  });

  it("stays flat under a finger", () => {
    const { button } = renderCard();
    fireEvent.pointerEnter(button, { pointerType: "touch" });
    fireEvent.pointerMove(button, { pointerType: "touch", clientX: 110, clientY: 20 });
    expect(button.style.getPropertyValue("--ry")).toBe("");
  });

  it("marks a stale pick", () => {
    const { button } = renderCard({ picked: true, stale: true });
    expect(button).toHaveClass("is-stale");
    expect(button.querySelector(".shiny-check")).toHaveTextContent("!");
  });
});
