/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useReauth } from "@/components/ReauthDialog";

jest.mock("next/navigation", () => ({ usePathname: () => "/settings/account" }));
let mockUser;
jest.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const reply = (status, body) => ({ status, ok: status < 300, json: async () => body, clone() { return this; } });

function Harness() {
  const { fetchWithReauth, reauthDialog } = useReauth();
  const [result, setResult] = useState("");
  const run = async () => {
    const res = await fetchWithReauth("/api/auth/delete-account", { method: "DELETE" });
    setResult(String(res.status));
  };
  return (
    <>
      <button onClick={run}>Delete</button>
      <output>{result}</output>
      {reauthDialog}
    </>
  );
}

beforeEach(() => {
  mockUser = { hasPassword: true, oauthProviders: [] };
  global.fetch = jest.fn();
});

it("passes through responses that don't need re-auth", async () => {
  global.fetch.mockResolvedValueOnce(reply(200, {}));
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.getByText("200")).toBeInTheDocument());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("asks for the password, confirms it, and retries the request once", async () => {
  global.fetch
    .mockResolvedValueOnce(reply(401, { reauthRequired: true }))
    .mockResolvedValueOnce(reply(200, { success: true })) // POST /api/auth/reauth
    .mockResolvedValueOnce(reply(200, { success: true })); // retried DELETE
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));

  const dialog = await screen.findByRole("dialog", { name: "Confirm it's you" });
  expect(dialog).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Password"), "Right!Pass1234");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

  await waitFor(() => expect(screen.getByText("200")).toBeInTheDocument());
  expect(global.fetch.mock.calls.map(([url, o]) => [url, o?.method])).toEqual([
    ["/api/auth/delete-account", "DELETE"],
    ["/api/auth/reauth", "POST"],
    ["/api/auth/delete-account", "DELETE"],
  ]);
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ password: "Right!Pass1234" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("shows the error and keeps the dialog open on a wrong password", async () => {
  global.fetch
    .mockResolvedValueOnce(reply(401, { reauthRequired: true }))
    .mockResolvedValueOnce(reply(401, { error: "Incorrect password" }));
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.type(await screen.findByLabelText("Password"), "wrong");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it("cancelling returns the original 401 without retrying", async () => {
  global.fetch.mockResolvedValueOnce(reply(401, { reauthRequired: true }));
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.getByText("401")).toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it("offers provider sign-in, returning to this page, for accounts without a password", async () => {
  mockUser = { hasPassword: false, oauthProviders: ["google", "github"] };
  global.fetch.mockResolvedValueOnce(reply(401, { reauthRequired: true }));
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/api/auth/oauth/google?next=%2Fsettings%2Faccount");
  expect(screen.getByRole("link", { name: "Continue with GitHub" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
});

it("ignores 401s that aren't re-auth requests", async () => {
  global.fetch.mockResolvedValueOnce(reply(401, { error: "Unauthorized" }));
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.getByText("401")).toBeInTheDocument());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("asks MFA users for their password and an authenticator code", async () => {
  mockUser = { hasPassword: true, mfaEnabled: true, mfaMethods: ["totp", "recovery"], oauthProviders: ["google"] };
  global.fetch
    .mockResolvedValueOnce(reply(401, { reauthRequired: true }))
    .mockResolvedValueOnce(reply(200, { success: true }))
    .mockResolvedValueOnce(reply(200, {}));
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.type(await screen.findByLabelText("Password"), "Right!Pass1234");
  await userEvent.type(screen.getByLabelText(/Authenticator code/), "123456");
  // MFA users confirm here; a provider sign-in alone wouldn't satisfy MFA.
  expect(screen.queryByRole("link", { name: "Continue with Google" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(screen.getByText("200")).toBeInTheDocument());
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ password: "Right!Pass1234", method: "totp", code: "123456" });
});

it("sends a recovery code as a recovery code", async () => {
  mockUser = { hasPassword: false, mfaEnabled: true, mfaMethods: ["totp", "recovery"], oauthProviders: ["google"] };
  global.fetch
    .mockResolvedValueOnce(reply(401, { reauthRequired: true }))
    .mockResolvedValueOnce(reply(200, { success: true }))
    .mockResolvedValueOnce(reply(200, {}));
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  await userEvent.type(await screen.findByLabelText(/Authenticator code/), "abcde-fghij");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(screen.getByText("200")).toBeInTheDocument());
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ method: "recovery", code: "abcde-fghij" });
});
