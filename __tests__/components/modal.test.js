/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "@/components/Modal";

function renderModal(props = {}, children = (
  <>
    <input aria-label="First field" />
    <button type="button" disabled>Disabled</button>
    <button type="button">Last button</button>
  </>
)) {
  const onClose = jest.fn();
  const user = userEvent.setup();
  const utils = render(
    <>
      <button type="button">Trigger</button>
      <Modal title="Edit plan" onClose={onClose} {...props}>
        {children}
      </Modal>
    </>
  );
  return { ...utils, user, onClose };
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("Modal", () => {
  it("is a labelled modal dialog with an optional subtitle and footer", () => {
    renderModal({ subtitle: "Sprint settings", footer: <button type="button">Save</button> });
    const dialog = screen.getByRole("dialog", { name: "Edit plan" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Sprint settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("focuses the first control in the body, or a data-autofocus element", () => {
    const { unmount } = renderModal();
    expect(screen.getByLabelText("First field")).toHaveFocus();
    unmount();

    renderModal({}, (
      <>
        <input aria-label="Name" />
        <input aria-label="Search" data-autofocus />
      </>
    ));
    expect(screen.getByLabelText("Search")).toHaveFocus();
  });

  it("focuses the dialog itself when the body has no controls", () => {
    renderModal({}, <p>Nothing to edit</p>);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("keeps Tab and Shift+Tab inside the dialog, skipping disabled controls", async () => {
    const { user } = renderModal({ footer: <button type="button">Save</button> });
    const first = screen.getByLabelText("First field");
    const save = screen.getByRole("button", { name: "Save" });

    const close = screen.getByRole("button", { name: "Close dialog" });
    expect(first).toHaveFocus();

    // Tab order: close (header), first field, last button, save (footer).
    await user.tab();
    expect(screen.getByRole("button", { name: "Last button" })).toHaveFocus();
    await user.tab();
    expect(save).toHaveFocus();
    // Tab from the last control wraps to the first...
    await user.tab();
    expect(close).toHaveFocus();
    // ...and Shift+Tab from the first wraps to the last.
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
    expect(screen.getByRole("button", { name: "Trigger" })).not.toHaveFocus();
  });

  it("ignores Tab when nothing inside can take focus", () => {
    renderModal({}, <p>Nothing to edit</p>);
    // The close button is the only control; disable it so nothing is focusable.
    screen.getByRole("button", { name: "Close dialog" }).disabled = true;
    const event = fireEvent.keyDown(document, { key: "Tab" });
    expect(event).toBe(true); // not prevented
  });

  it("closes on Escape, on the close button and on a backdrop press, but not inside", async () => {
    const { user, onClose, container } = renderModal();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.mouseDown(container.querySelector('[role="dialog"]').parentElement);
    expect(onClose).toHaveBeenCalledTimes(3);

    fireEvent.mouseDown(screen.getByRole("dialog"));
    fireEvent.mouseDown(screen.getByLabelText("First field"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("uses the latest onClose without re-running its focus setup", async () => {
    const user = userEvent.setup();
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<Modal title="T" onClose={first}><input aria-label="Field" /></Modal>);
    screen.getByLabelText("Field").blur();
    rerender(<Modal title="T" onClose={second}><input aria-label="Field" /></Modal>);

    await user.keyboard("{Escape}");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    // Focus wasn't moved back into the body by a second setup run.
    expect(screen.getByLabelText("Field")).not.toHaveFocus();
  });

  it("locks page scroll while open and restores it and the trigger's focus on close", () => {
    document.body.style.overflow = "auto";
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<Modal title="T" onClose={jest.fn()}><input aria-label="Field" /></Modal>);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();

    expect(document.body.style.overflow).toBe("auto");
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
