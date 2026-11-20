/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "@/components/Modal";
import { DayEditorDialog } from "@/components/capacity/DayEditorDialog";
import { CapacityGrid } from "@/components/capacity/CapacityGrid";
import { TransferOwnershipDialog } from "@/components/capacity/TransferOwnershipDialog";
import { PlanConfigPanel } from "@/components/capacity/PlanConfigPanel";
import { sprintsInRange } from "@/lib/capacity/sprints";
import { DateField } from "@/components/capacity/DateField";
import { PlanFormModal } from "@/components/capacity/PlanFormModal";
import { RangePulseFrame, RangeSummary, useRangePulse } from "@/components/capacity/RangeFeedback";
import { RangeSelector } from "@/components/capacity/RangeSelector";
import { TimeZoneSelect } from "@/components/capacity/TimeZoneSelect";
import { api } from "@/components/capacity/api";
import { AggregateGrid, UnitsToggle } from "@/components/capacity/AggregateGrid";
import { buildAggregate } from "@/lib/capacity/aggregate";

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
const members = [
  { userId: OWNER, fullName: "Olive Owner", username: "olive" },
  { userId: EDITOR, fullName: "Ed Editor", username: "ed" },
];

function mockFetch(response, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => response });
  return global.fetch;
}

afterEach(() => {
  delete global.fetch;
});

describe("Modal", () => {
  it("closes on Escape and returns focus to the trigger", async () => {
    function Harness() {
      const [open, setOpen] = require("react").useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <Modal title="Hello" onClose={() => setOpen(false)}>
              <input aria-label="inside" />
            </Modal>
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByText("Open");
    trigger.focus();
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Hello" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("inside")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("DayEditorDialog", () => {
  const sprint = sprintsInRange(plan, "2026-10-05", "2026-10-11")[0];
  const member = members[0];

  it("defaults to full availability in plan units and discards without saving", async () => {
    const fetch = mockFetch({});
    const onClose = jest.fn();
    render(<DayEditorDialog plan={plan} member={member} sprint={sprint} days={undefined} onClose={onClose} onSaved={jest.fn()} />);
    expect(screen.getByText("10 story points")).toBeInTheDocument();
    expect(screen.getByLabelText("Mon Oct 5")).toHaveValue("1");
    await userEvent.selectOptions(screen.getByLabelText("Mon Oct 5"), "0.5");
    expect(screen.getByText("9 story points")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Discard"));
    expect(onClose).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends only the changed days on Accept", async () => {
    const fetch = mockFetch({ memberId: OWNER, days: { "2026-10-06": 0.25 }, version: 2 });
    const onSaved = jest.fn();
    render(<DayEditorDialog plan={plan} member={member} sprint={sprint} days={{ "2026-10-05": 0 }} onClose={jest.fn()} onSaved={onSaved} />);
    await userEvent.selectOptions(screen.getByLabelText("Mon Oct 5"), "1");
    await userEvent.selectOptions(screen.getByLabelText("Tue Oct 6"), "0.25");
    await userEvent.click(screen.getByText("Accept"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(OWNER, { "2026-10-06": 0.25 }));
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`/api/capacity-plans/${plan.planId}/availability`);
    expect(JSON.parse(init.body)).toEqual({ memberId: OWNER, days: { "2026-10-05": 1, "2026-10-06": 0.25 } });
  });

  it("shows server errors and stays open", async () => {
    mockFetch({ error: "Availability must be 0–1 day in 0.25 steps" }, 400);
    const onSaved = jest.fn();
    render(<DayEditorDialog plan={plan} member={member} sprint={sprint} days={{}} onClose={jest.fn()} onSaved={onSaved} />);
    await userEvent.click(screen.getByText("All off"));
    await userEvent.click(screen.getByText("Accept"));
    expect(await screen.findByRole("alert")).toHaveTextContent("0.25 steps");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("CapacityGrid", () => {
  const sprints = sprintsInRange(plan, "2026-10-05", "2026-10-18");
  const availability = { [OWNER]: { "2026-10-05": 0.5 } };

  it("shows totals per Sprint and for the range", () => {
    render(<CapacityGrid plan={plan} members={members} availability={availability} sprints={sprints} canEdit today="2026-10-07" onCellClick={jest.fn()} onRename={jest.fn()} />);
    const footer = screen.getByText("Team total").closest("tr");
    expect(within(footer).getAllByRole("cell").map((c) => c.textContent)).toEqual(["19", "20", "39"]);
    const ownerRow = screen.getByText("Olive Owner").closest("tr");
    expect(within(ownerRow).getAllByRole("cell").map((c) => c.textContent)).toEqual(["9", "10", "19"]);
    expect(screen.getByRole("columnheader", { name: /Sprint 1/ })).toHaveAttribute("aria-current", "date");
  });

  it("opens the editor from a cell for editors", async () => {
    const onCellClick = jest.fn();
    render(<CapacityGrid plan={plan} members={members} availability={{}} sprints={sprints} canEdit onCellClick={onCellClick} onRename={jest.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Ed Editor, Sprint 2: 10 story points\. Edit availability/ }));
    expect(onCellClick).toHaveBeenCalledWith(EDITOR, sprints[1]);
  });

  it("gives read-only users no edit buttons", () => {
    render(<CapacityGrid plan={plan} members={members} availability={{}} sprints={sprints} canEdit={false} onCellClick={jest.fn()} onRename={jest.fn()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renames a Sprint inline, clearing back to the default", async () => {
    const onRename = jest.fn();
    render(<CapacityGrid plan={plan} members={members} availability={{}} sprints={sprints} canEdit onCellClick={jest.fn()} onRename={onRename} />);
    await userEvent.click(screen.getByRole("button", { name: "Rename Sprint 2" }));
    const input = screen.getByRole("textbox", { name: "Rename Sprint 2" });
    await userEvent.clear(input);
    await userEvent.type(input, "Hardening{Enter}");
    expect(onRename).toHaveBeenCalledWith(sprints[1], "Hardening");
  });
});

describe("TransferOwnershipDialog", () => {
  const review = {
    needsDecision: [
      {
        planId: plan.planId,
        name: "Team A",
        candidates: [
          { userId: EDITOR, fullName: "Ed Editor", atLimit: false },
          { userId: VIEWER, fullName: "Busy Person", atLimit: true },
        ],
      },
    ],
    autoDelete: [{ planId: "x", name: "Solo plan" }],
  };

  it("requires a decision and disables people at the plan limit", async () => {
    const onConfirm = jest.fn();
    render(<TransferOwnershipDialog review={review} onCancel={jest.fn()} onConfirm={onConfirm} />);
    const confirm = screen.getByRole("button", { name: "Delete my account" });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("option", { name: /Busy Person \(already owns 10\)/ })).toBeDisabled();
    expect(screen.getByText(/Solo plan/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Team A"), EDITOR);
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ [plan.planId]: { action: "transfer", newOwnerId: EDITOR } });
  });
});

describe("PlanConfigPanel sharing", () => {
  const view = {
    plan,
    role: "edit",
    members,
    access: [
      { userId: OWNER, fullName: "Olive Owner", role: "owner", email: "olive@example.com" },
      { userId: EDITOR, fullName: "Ed Editor", role: "edit", email: "ed@example.com" },
      { userId: VIEWER, fullName: "Vic Viewer", role: "view", email: "vic@example.com" },
    ],
    availability: {},
  };

  it("lets editors change access but never the owner's, and hides owner-only tabs", async () => {
    const fetch = mockFetch({ ...view, access: view.access.map((p) => (p.userId === VIEWER ? { ...p, role: "edit" } : p)) });
    const onChange = jest.fn();
    render(<PlanConfigPanel view={view} initialTab="sharing" onChange={onChange} onClose={jest.fn()} onDeleted={jest.fn()} onLeft={jest.fn()} />);
    expect(screen.queryByRole("tab", { name: "Ownership" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Access for Olive Owner")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Access for Vic Viewer"), "edit");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`/api/capacity-plans/${plan.planId}/access`);
    expect(JSON.parse(init.body)).toEqual({ userId: VIEWER, role: "edit" });
  });

  it("shows settings read-only to non-owners", () => {
    render(<PlanConfigPanel view={view} onChange={jest.fn()} onClose={jest.fn()} onDeleted={jest.fn()} onLeft={jest.fn()} />);
    expect(screen.getByText("Only the plan owner can change these settings.")).toBeInTheDocument();
    expect(screen.getByLabelText("Team name")).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Team members" }));
    expect(screen.getByRole("button", { name: "Remove Ed Editor from the team" })).toBeInTheDocument();
  });
});

describe("DateField", () => {
  it("opens the native picker from the calendar button", async () => {
    const showPicker = jest.fn();
    HTMLInputElement.prototype.showPicker = showPicker;
    render(<DateField id="d" label="Sprint 1 start date" value="2026-10-05" onChange={jest.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Choose Sprint 1 start date from calendar" }));
    expect(showPicker).toHaveBeenCalled();
    delete HTMLInputElement.prototype.showPicker;
  });
});

describe("PlanFormModal", () => {
  it("sends people without an account as guestNames", async () => {
    const fetch = mockFetch({ plan: { planId: "p" } }, 201);
    const onCreated = jest.fn();
    render(<PlanFormModal currentUser={{ userId: OWNER }} onClose={jest.fn()} onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText("Team name"), "Team A");
    await userEvent.type(screen.getByLabelText("Name of a team member without an account"), "Casey Contractor{Enter}");
    expect(screen.getByText("No account")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ name: "Team A", memberIds: [OWNER], guestNames: ["Casey Contractor"] });
  });
});

describe("Team members tab", () => {
  it("adds and renames people without an account", async () => {
    const guestView = {
      plan,
      role: "edit",
      members: [...members, { userId: "00000000-0000-4000-8000-0000000000aa", fullName: "Casey", guest: true }],
      access: [],
      availability: {},
    };
    const fetch = mockFetch(guestView);
    render(<PlanConfigPanel view={guestView} initialTab="members" onChange={jest.fn()} onClose={jest.fn()} onDeleted={jest.fn()} onLeft={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Rename Ed Editor" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rename Casey" }));
    const input = screen.getByLabelText("New name for Casey");
    await userEvent.clear(input);
    await userEvent.type(input, "Casey Jones{Enter}");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toBe(`/api/capacity-plans/${plan.planId}/members/00000000-0000-4000-8000-0000000000aa`);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ name: "Casey Jones" });

    expect(screen.queryByRole("button", { name: "Link Ed Editor to an account" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Link Casey to an account" }));
    expect(screen.getByRole("combobox", { name: "Find the account for Casey" })).toHaveFocus();

    await userEvent.type(screen.getByLabelText("Name of a team member without an account"), "Pat");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ guestName: "Pat" });
  });
});

describe("linking an account", () => {
  it("confirms, then links the picked account", async () => {
    const guestId = "00000000-0000-4000-8000-0000000000aa";
    const guestView = { plan, role: "owner", members: [...members, { userId: guestId, fullName: "Casey", guest: true }], access: [], availability: {} };
    global.fetch = jest.fn(async (url) => {
      if (url.startsWith("/api/users/search")) return { ok: true, status: 200, json: async () => [{ userId: VIEWER, fullName: "Casey Jones", email: "casey@example.com" }] };
      return { ok: true, status: 200, json: async () => ({ ...guestView, members }) };
    });
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const onChange = jest.fn();
    render(<PlanConfigPanel view={guestView} initialTab="members" onChange={onChange} onClose={jest.fn()} onDeleted={jest.fn()} onLeft={jest.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Link Casey to an account" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Find the account for Casey" }), "casey");
    await userEvent.click(await screen.findByText("Casey Jones"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Link Casey to Casey Jones (casey@example.com)?"));
    const call = global.fetch.mock.calls.find(([url]) => url.endsWith("/link"));
    expect(call[0]).toBe(`/api/capacity-plans/${plan.planId}/members/${guestId}/link`);
    expect(JSON.parse(call[1].body)).toEqual({ userId: VIEWER });
    window.confirm.mockRestore();
  });
});

describe("range change feedback", () => {
  function Harness() {
    const React = require("react");
    const [range, setRange] = React.useState({ from: "2026-10-05", to: "2026-12-27" });
    const pulse = useRangePulse();
    const sprints = sprintsInRange({ ...plan, sprintWeeks: 2 }, range.from, range.to);
    return (
      <>
        <RangeSelector
          from={range.from}
          to={range.to}
          onChange={(r) => {
            setRange(r);
            pulse.trigger();
          }}
        />
        <RangeSummary columns={sprints} noun="Sprint" pulse={pulse} />
        <RangePulseFrame pulse={pulse}>
          <CapacityGrid plan={{ ...plan, sprintWeeks: 2 }} members={members} availability={{}} sprints={sprints} canEdit={false} onCellClick={jest.fn()} onRename={jest.fn()} />
        </RangePulseFrame>
      </>
    );
  }

  it("announces the Sprints in view and highlights the grid after a preset is chosen", async () => {
    render(<Harness />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("6 Sprints in view · Oct 5 – Dec 27, 2026 · 12 weeks");
    const scroller = screen.getByRole("region", { name: "Capacity by team member and Sprint" });
    expect(scroller.parentElement.className).not.toMatch(/rangePulse/);

    await userEvent.click(screen.getByRole("button", { name: "52 weeks" }));
    expect(screen.getByRole("status")).toHaveTextContent("26 Sprints in view · Oct 5 – Oct 3, 2027 · 52 weeks");
    expect(screen.getByRole("status").className).toMatch(/rangeSummaryPulse/);
    const frame = screen.getByRole("region", { name: "Capacity by team member and Sprint" }).parentElement;
    expect(frame.className).toMatch(/rangePulse/);

    // jsdom's AnimationEvent doesn't carry animationName, so set it as a browser would.
    const end = new Event("animationend", { bubbles: true });
    Object.defineProperty(end, "animationName", { value: "Capacity-module__x__rangePulse" });
    act(() => frame.dispatchEvent(end));
    expect(screen.getByRole("region", { name: "Capacity by team member and Sprint" }).parentElement.className).not.toMatch(/rangePulse/);
  });
});

describe("TimeZoneSelect", () => {
  it("lists every zone, grouped by region, with the current one selected", async () => {
    const onChange = jest.fn();
    render(<TimeZoneSelect id="tz" value="America/Denver" onChange={onChange} />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("America/Denver");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(300);
    expect(screen.getByRole("group", { name: "Europe" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Denver \(UTC-\d+\)$/ })).toBeInTheDocument();
    await userEvent.selectOptions(select, "Australia/Sydney");
    expect(onChange).toHaveBeenCalled();
  });

  it("keeps a zone that isn't in the canonical list", () => {
    render(<TimeZoneSelect id="tz" value="US/Mountain" onChange={jest.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("US/Mountain");
  });
});

describe("api helper", () => {
  it("turns an expired session into a friendly message instead of 'Unauthorized'", async () => {
    mockFetch({ error: "Unauthorized" }, 401);
    jest.spyOn(console, "error").mockImplementation(() => {}); // jsdom can't navigate
    const res = await api("/api/capacity-plans", { method: "POST", body: {} });
    expect(res).toMatchObject({ ok: false, status: 401, error: "Your session expired. Redirecting to sign in…" });
    console.error.mockRestore();
  });
});

describe("combined view units", () => {
  const days = { ...plan, planId: "d", name: "Days team", unit: "days", sprintWeeks: 2 };
  const points = { ...plan, planId: "p", name: "Points team", unit: "points", pointsPerDay: 2, sprintWeeks: 2 };
  const result = buildAggregate(
    [
      { plan: days, memberIds: [OWNER], availability: {}, members: {} },
      { plan: points, memberIds: [EDITOR], availability: {}, members: {} },
    ],
    "2026-10-05",
    "2026-10-18"
  );
  const rowCells = (name) => within(screen.getByText(name).closest("tr")).getAllByRole("cell").map((c) => c.textContent);

  it("switches between source units, days and hours", async () => {
    function Harness() {
      const [units, setUnits] = require("react").useState("days");
      return (
        <>
          <UnitsToggle value={units} onChange={setUnits} />
          <AggregateGrid result={result} units={units} />
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "Days" })).toHaveAttribute("aria-checked", "true");
    expect(rowCells("Points team")).toEqual(["1020 pts", "1020 pts"]);
    expect(rowCells("All teams (days)")).toEqual(["20", "20"]);

    await userEvent.click(screen.getByRole("radio", { name: "Hours" }));
    expect(rowCells("Points team")).toEqual(["8020 pts", "8020 pts"]);
    expect(rowCells("All teams (hours)")).toEqual(["160", "160"]);

    await userEvent.click(screen.getByRole("radio", { name: "Source units" }));
    expect(rowCells("Points team")).toEqual(["20 pts", "20 pts"]);
    expect(rowCells("Days team")).toEqual(["10 d", "10 d"]);
    expect(rowCells("Story points total (1 team)")).toEqual(["20 pts", "20 pts"]);
    expect(rowCells("Days total (1 team)")).toEqual(["10 d", "10 d"]);
  });
});

