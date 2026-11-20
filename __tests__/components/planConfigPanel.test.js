/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanConfigPanel } from "@/components/capacity/PlanConfigPanel";

// Settings, member removal, sharing changes and the owner-only Ownership tab.
// Sharing role changes and guest members are covered in capacity.test.js.

const OWNER = "00000000-0000-4000-8000-000000000001";
const EDITOR = "00000000-0000-4000-8000-000000000002";
const VIEWER = "00000000-0000-4000-8000-000000000003";

const plan = {
  planId: "4f9c2a7e-1b3d-4c5e-8f6a-0b1c2d3e4f5a",
  name: "Team A",
  timeZone: "Australia/Sydney",
  unit: "points",
  hoursPerDay: 8,
  pointsPerDay: 2,
  workingDays: [1, 2, 3, 4, 5],
  cadenceStart: "2026-10-05",
  sprintWeeks: 1,
  sprintNames: {},
  memberIds: [OWNER, EDITOR],
  access: { [EDITOR]: "edit", [VIEWER]: "view" },
  ownerId: OWNER,
  version: 3,
};

const ownerView = {
  plan,
  role: "owner",
  members: [
    { userId: OWNER, fullName: "Olive Owner", username: "olive" },
    { userId: EDITOR, fullName: "Ed Editor", username: "ed" },
  ],
  access: [
    { userId: OWNER, fullName: "Olive Owner", role: "owner", email: "olive@example.com" },
    { userId: EDITOR, fullName: "Ed Editor", role: "edit", email: "ed@example.com" },
    { userId: VIEWER, fullName: "Vic Viewer", role: "view", email: "vic@example.com" },
  ],
  availability: {},
};

function respond(body, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  return global.fetch;
}

function renderPanel(props = {}) {
  const handlers = { onChange: jest.fn(), onClose: jest.fn(), onDeleted: jest.fn(), onLeft: jest.fn() };
  const user = userEvent.setup();
  render(<PlanConfigPanel view={ownerView} {...handlers} {...props} />);
  return { user, ...handlers };
}

const lastRequest = () => {
  const [url, init = {}] = global.fetch.mock.calls.at(-1);
  return { url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined };
};

let confirmSpy;

beforeEach(() => {
  confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  confirmSpy.mockRestore();
  delete global.fetch;
});

describe("PlanConfigPanel settings (owner)", () => {
  it("saves only the changed settings against the plan's version", async () => {
    respond({ ...ownerView, plan: { ...plan, name: "Team B", version: 4 } });
    const { user, onChange } = renderPanel();
    const save = screen.getByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled();

    await user.clear(screen.getByLabelText("Team name"));
    await user.type(screen.getByLabelText("Team name"), "Team B");
    await user.click(save);

    expect(await screen.findByRole("status")).toHaveTextContent("Settings saved.");
    expect(lastRequest()).toEqual({
      url: `/api/capacity-plans/${plan.planId}`,
      method: "PATCH",
      body: { expectedVersion: 3, settings: { name: "Team B" } },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({ version: 4 }) }));
  });

  it("validates before sending", async () => {
    respond({});
    const { user } = renderPanel();
    await user.clear(screen.getByLabelText("Team name"));
    await user.type(screen.getByLabelText("Team name"), " ");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(screen.getByText("Give the plan a name")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("warns about renumbering when the Sprint cadence changes, and about removed working days", async () => {
    const { user } = renderPanel();
    await user.selectOptions(screen.getByLabelText("Weeks per Sprint"), "2");
    expect(screen.getByText(/Changing the Sprint cadence renumbers Sprints/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fri", pressed: true }));
    expect(screen.getByText(/no longer working days are kept but not counted/)).toBeInTheDocument();
  });

  it("explains a version conflict instead of overwriting someone else's change", async () => {
    respond({ error: "Conflict" }, 409);
    const { user, onChange } = renderPanel();
    await user.type(screen.getByLabelText("Team name"), "!");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Someone else changed this plan/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows other server errors as sent", async () => {
    respond({ error: "Plan name is too long" }, 400);
    const { user } = renderPanel();
    await user.type(screen.getByLabelText("Team name"), "!");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Plan name is too long")).toBeInTheDocument();
  });
});

describe("PlanConfigPanel team members", () => {
  it("removes a member after confirming, and says their access is unchanged", async () => {
    respond({ ...ownerView, members: ownerView.members.slice(0, 1) });
    const { user, onChange } = renderPanel({ initialTab: "members" });
    await user.click(screen.getByRole("button", { name: "Remove Ed Editor from the team" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Their access to the plan is not changed."));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastRequest()).toMatchObject({ url: `/api/capacity-plans/${plan.planId}/members/${EDITOR}`, method: "DELETE" });
  });

  it("does nothing when the removal isn't confirmed", async () => {
    respond({});
    confirmSpy.mockReturnValue(false);
    const { user } = renderPanel({ initialTab: "members" });
    await user.click(screen.getByRole("button", { name: "Remove Ed Editor from the team" }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows why a removal failed", async () => {
    respond({ error: "The owner can't be removed" }, 400);
    const { user, onChange } = renderPanel({ initialTab: "members" });
    await user.click(screen.getByRole("button", { name: "Remove Ed Editor from the team" }));
    expect(await screen.findByText("The owner can't be removed")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  describe("people without an account", () => {
    const GUEST = "00000000-0000-4000-8000-0000000000aa";
    const guestView = {
      ...ownerView,
      members: [...ownerView.members, { userId: GUEST, fullName: "Casey", guest: true }],
    };

    it("renames a guest, skipping the request when the name didn't change", async () => {
      respond(guestView);
      const { user, onChange } = renderPanel({ initialTab: "members", view: guestView });
      // Members with an account keep their profile name.
      expect(screen.queryByRole("button", { name: "Rename Ed Editor" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Rename Casey" }));
      await user.click(screen.getByRole("button", { name: "Save name for Casey" }));
      expect(global.fetch).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Rename Casey" }));
      await user.clear(screen.getByLabelText("New name for Casey"));
      await user.type(screen.getByLabelText("New name for Casey"), "Casey Jones{Enter}");
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(lastRequest()).toEqual({
        url: `/api/capacity-plans/${plan.planId}/members/${GUEST}`,
        method: "PATCH",
        body: { name: "Casey Jones" },
      });
    });

    it("cancels a rename with Escape without closing the dialog", async () => {
      respond({});
      const { user, onClose } = renderPanel({ initialTab: "members", view: guestView });
      await user.click(screen.getByRole("button", { name: "Rename Casey" }));
      await user.keyboard("{Escape}");
      expect(screen.queryByLabelText("New name for Casey")).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("removes a guest without mentioning plan access", async () => {
      respond(ownerView);
      const { user } = renderPanel({ initialTab: "members", view: guestView });
      await user.click(screen.getByRole("button", { name: "Remove Casey from the team" }));
      expect(confirmSpy).toHaveBeenCalledWith(expect.not.stringContaining("access"));
    });
  });
});

describe("PlanConfigPanel sharing", () => {
  it("stops sharing after confirming", async () => {
    respond({ ...ownerView, access: ownerView.access.slice(0, 2) });
    const { user, onChange } = renderPanel({ initialTab: "sharing" });
    await user.click(screen.getByRole("button", { name: "Stop sharing with Vic Viewer" }));

    expect(confirmSpy).toHaveBeenCalledWith("Stop sharing this plan with Vic Viewer?");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastRequest()).toMatchObject({ url: `/api/capacity-plans/${plan.planId}/access/${VIEWER}`, method: "DELETE" });
  });

  it("closes the plan when a change removes the user's own access", async () => {
    respond({ removed: true });
    const { user, onLeft, onChange } = renderPanel({ initialTab: "sharing" });
    await user.selectOptions(screen.getByLabelText("Access for Ed Editor"), "view");
    await waitFor(() => expect(onLeft).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a sharing error and re-enables the controls", async () => {
    respond({ error: "No account matches that email" }, 404);
    const { user } = renderPanel({ initialTab: "sharing" });
    await user.click(screen.getByRole("button", { name: "Stop sharing with Vic Viewer" }));
    expect(await screen.findByText("No account matches that email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop sharing with Vic Viewer" })).toBeEnabled();
  });

  it("gives read-only people no controls but lets them leave", async () => {
    respond({});
    const { user, onLeft } = renderPanel({ initialTab: "sharing", view: { ...ownerView, role: "view" } });
    expect(screen.queryByLabelText("Access for Ed Editor")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Access for the new person")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Leave plan" }));
    await waitFor(() => expect(onLeft).toHaveBeenCalled());
    expect(lastRequest()).toMatchObject({ url: `/api/capacity-plans/${plan.planId}/leave`, method: "POST" });
  });

  it("keeps the plan open when leaving fails or isn't confirmed", async () => {
    respond({ error: "Owners can't leave" }, 400);
    const { user, onLeft } = renderPanel({ initialTab: "sharing", view: { ...ownerView, role: "edit" } });

    confirmSpy.mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "Leave plan" }));
    expect(global.fetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Leave plan" }));
    expect(await screen.findByText("Owners can't leave")).toBeInTheDocument();
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("never shows owners a Leave button", () => {
    renderPanel({ initialTab: "sharing" });
    expect(screen.queryByRole("button", { name: "Leave plan" })).not.toBeInTheDocument();
  });
});

describe("PlanConfigPanel ownership (owner only)", () => {
  it("transfers ownership to an editor after confirming", async () => {
    respond({ ...ownerView, role: "edit" });
    const { user, onChange } = renderPanel({ initialTab: "ownership" });
    const transfer = screen.getByRole("button", { name: "Transfer" });
    expect(transfer).toBeDisabled();
    // Only people with edit access can become the owner.
    expect(screen.queryByRole("option", { name: "Vic Viewer" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("New owner"), EDITOR);
    await user.click(transfer);

    expect(confirmSpy).toHaveBeenCalledWith('Make Ed Editor the owner of "Team A"? You\'ll keep edit access.');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastRequest()).toEqual({
      url: `/api/capacity-plans/${plan.planId}/transfer`,
      method: "POST",
      body: { newOwnerId: EDITOR },
    });
  });

  it("explains how to enable a transfer when nobody can edit", () => {
    renderPanel({ initialTab: "ownership", view: { ...ownerView, access: ownerView.access.filter((p) => p.role !== "edit") } });
    expect(screen.getByText(/to be able to transfer it to them/)).toBeInTheDocument();
    expect(screen.queryByLabelText("New owner")).not.toBeInTheDocument();
  });

  it("shows a transfer error, e.g. the new owner is at their plan limit", async () => {
    respond({ error: "Ed Editor already owns 10 plans" }, 409);
    const { user, onChange } = renderPanel({ initialTab: "ownership" });
    await user.selectOptions(screen.getByLabelText("New owner"), EDITOR);
    await user.click(screen.getByRole("button", { name: "Transfer" }));
    expect(await screen.findByText("Ed Editor already owns 10 plans")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("deletes the plan after a confirmation that counts who else loses it", async () => {
    respond({});
    const { user, onDeleted } = renderPanel({ initialTab: "ownership" });
    await user.click(screen.getByRole("button", { name: /Delete plan/ }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete "Team A" permanently? It will also be removed for the 2 other people it\'s shared with.'
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(lastRequest()).toMatchObject({ url: `/api/capacity-plans/${plan.planId}`, method: "DELETE" });
  });

  it("uses singular wording for one other person and none for an unshared plan", async () => {
    respond({});
    confirmSpy.mockReturnValue(false);
    const { user } = renderPanel({ initialTab: "ownership", view: { ...ownerView, access: ownerView.access.slice(0, 2) } });
    await user.click(screen.getByRole("button", { name: /Delete plan/ }));
    expect(confirmSpy).toHaveBeenLastCalledWith(expect.stringContaining("the 1 other person it's shared with."));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the plan when deletion fails", async () => {
    respond({ error: "Internal Error" }, 500);
    const { user, onDeleted } = renderPanel({ initialTab: "ownership", view: { ...ownerView, access: ownerView.access.slice(0, 1) } });
    await user.click(screen.getByRole("button", { name: /Delete plan/ }));
    expect(confirmSpy).toHaveBeenLastCalledWith('Delete "Team A" permanently?');
    expect(await screen.findByText("Internal Error")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("falls back to Settings if the Ownership tab disappears after a transfer", () => {
    const handlers = { onChange: jest.fn(), onClose: jest.fn(), onDeleted: jest.fn(), onLeft: jest.fn() };
    const { rerender } = render(<PlanConfigPanel view={ownerView} initialTab="ownership" {...handlers} />);
    expect(screen.getByRole("tab", { name: "Ownership" })).toHaveAttribute("aria-selected", "true");

    rerender(<PlanConfigPanel view={{ ...ownerView, role: "edit" }} initialTab="ownership" {...handlers} />);
    expect(screen.queryByRole("tab", { name: "Ownership" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
  });
});
