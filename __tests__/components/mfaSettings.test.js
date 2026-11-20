/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MfaSettings } from "@/components/MfaSettings";

jest.mock("next/navigation", () => ({ usePathname: () => "/settings/security" }));
jest.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: jest.fn(() => true),
  startRegistration: jest.fn(),
  startAuthentication: jest.fn(),
}));
let mockUser;
const refreshUser = jest.fn(async () => mockUser);
jest.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: mockUser, refreshUser }) }));

const { browserSupportsWebAuthn, startRegistration } = require("@simplewebauthn/browser");
const reply = (status, body) => ({ status, ok: status < 300, json: async () => body, clone() { return this; } });
const OFF = { enabled: false, totp: false, passkeys: [], recoveryCodesRemaining: 0 };

beforeEach(() => {
  mockUser = { hasPassword: true, mfaEnabled: false, mfaMethods: [] };
  global.fetch = jest.fn();
  browserSupportsWebAuthn.mockReturnValue(true);
});

it("sets up an authenticator app and shows recovery codes exactly once", async () => {
  global.fetch
    .mockResolvedValueOnce(reply(200, OFF))
    .mockResolvedValueOnce(reply(200, { secret: "JBSWY3DPEHPK3PXP", qrDataUrl: "data:image/png;base64,AAAA", otpauthUrl: "otpauth://x" }))
    .mockResolvedValueOnce(reply(200, { enabled: true, totp: true, passkeys: [], recoveryCodesRemaining: 10, recoveryCodes: ["aaaaa-bbbbb", "ccccc-ddddd"] }));
  render(<MfaSettings />);

  await userEvent.click(await screen.findByRole("button", { name: "Set up authenticator app" }));
  expect(await screen.findByRole("img", { name: /QR code/ })).toHaveAttribute("src", "data:image/png;base64,AAAA");
  expect(screen.getByTestId("totp-secret")).toHaveTextContent("JBSWY3DPEHPK3PXP");

  await userEvent.type(screen.getByLabelText("Enter the 6-digit code it shows"), "123456");
  await userEvent.click(screen.getByRole("button", { name: "Turn on" }));

  const codes = await screen.findByRole("region", { name: "Your recovery codes" });
  expect(codes).toHaveTextContent("aaaaa-bbbbb");
  expect(global.fetch.mock.calls[2]).toEqual(["/api/auth/mfa/totp", expect.objectContaining({ method: "PUT", body: JSON.stringify({ code: "123456" }) })]);
  expect(refreshUser).toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "I've saved them" }));
  expect(screen.queryByRole("region", { name: "Your recovery codes" })).not.toBeInTheDocument();
  expect(screen.getByText("10 unused.")).toBeInTheDocument();
});

it("shows the error for a wrong setup code and stays on the form", async () => {
  global.fetch
    .mockResolvedValueOnce(reply(200, OFF))
    .mockResolvedValueOnce(reply(200, { secret: "S", qrDataUrl: "data:image/png;base64,A" }))
    .mockResolvedValueOnce(reply(400, { error: "That code didn't match." }));
  render(<MfaSettings />);
  await userEvent.click(await screen.findByRole("button", { name: "Set up authenticator app" }));
  await userEvent.type(await screen.findByLabelText("Enter the 6-digit code it shows"), "000000");
  await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
  expect(await screen.findByRole("status")).toHaveTextContent("That code didn't match.");
  expect(screen.getByRole("button", { name: "Turn on" })).toBeInTheDocument();
});

it("registers a passkey through the browser API", async () => {
  startRegistration.mockResolvedValueOnce({ id: "cred-1" });
  global.fetch
    .mockResolvedValueOnce(reply(200, OFF))
    .mockResolvedValueOnce(reply(200, { challenge: "c" }))
    .mockResolvedValueOnce(reply(200, { enabled: true, totp: false, passkeys: [{ id: "cred-1", name: "Laptop", createdAt: "2026-11-17T00:00:00Z" }], recoveryCodesRemaining: 10, recoveryCodes: ["x"] }));
  render(<MfaSettings />);
  await userEvent.type(await screen.findByLabelText("Passkey name"), "Laptop");
  await userEvent.click(screen.getByRole("button", { name: "Add a passkey" }));

  await waitFor(() => expect(screen.getByRole("button", { name: "Remove passkey Laptop" })).toBeInTheDocument());
  expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: "c" } });
  expect(JSON.parse(global.fetch.mock.calls[2][1].body)).toEqual({ response: { id: "cred-1" }, name: "Laptop" });
});

it("explains when the browser has no passkey support", async () => {
  browserSupportsWebAuthn.mockReturnValue(false);
  global.fetch.mockResolvedValueOnce(reply(200, OFF));
  render(<MfaSettings />);
  expect(await screen.findByText(/doesn't support passkeys/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add a passkey" })).not.toBeInTheDocument();
});

it("warns admins that their rights need MFA", async () => {
  mockUser = { ...mockUser, adminMfaRequired: true };
  global.fetch.mockResolvedValueOnce(reply(200, OFF));
  render(<MfaSettings />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/administrator rights/);
});
