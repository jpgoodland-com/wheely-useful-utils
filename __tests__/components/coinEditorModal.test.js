/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoinEditorModal } from "@/components/CoinEditorModal";
import { processImageFile } from "@/lib/clientImage";
import { PRESETS } from "@/lib/coinConstants";

// jsdom can't decode images; the upload path is covered in clientImage.test.js.
jest.mock("@/lib/clientImage", () => ({ processImageFile: jest.fn() }));

// The config the page opens the editor with for a new coin.
const NEW_COIN = {
  name: "My Coin",
  style: "classic",
  headsColor: "#3b82f6",
  tailsColor: "#ec4899",
  rimColor: "#e5e5ec",
  heads: { type: "text", value: "H" },
  tails: { type: "text", value: "T" },
};

function renderEditor(props = {}) {
  const onSave = jest.fn();
  const onClose = jest.fn();
  const user = userEvent.setup();
  const utils = render(
    <CoinEditorModal config={NEW_COIN} onSave={onSave} onClose={onClose} isSaving={false} error="" {...props} />
  );
  return { ...utils, user, onSave, onClose };
}

const save = (user) => user.click(screen.getByRole("button", { name: /Save to Profile/ }));
const nameInput = () => screen.getByPlaceholderText("e.g. Lucky Decision Coin");
const faceCard = (label) => screen.getByText(label).closest("div").parentElement;

beforeEach(() => {
  processImageFile.mockReset();
  window.matchMedia = jest.fn(() => ({ matches: false }));
});

describe("CoinEditorModal", () => {
  it("opens on the style tab with the coin's current settings and quota", () => {
    renderEditor({ customCount: 2, maxCustom: 5 });
    expect(screen.getByRole("heading", { name: "Create Custom Coin" })).toBeInTheDocument();
    expect(nameInput()).toHaveValue("My Coin");
    expect(screen.getByRole("combobox")).toHaveValue("classic");
    expect(screen.getByText("#3b82f6")).toBeInTheDocument();
    expect(screen.getByText("Saved Coins: 2/5")).toBeInTheDocument();
    expect(screen.queryByText("Heads Face")).not.toBeInTheDocument();
  });

  it("saves the edited name, style and colours", async () => {
    const { user, onSave } = renderEditor();
    await user.clear(nameInput());
    await user.type(nameInput(), "Lunch Decider");
    await user.selectOptions(screen.getByRole("combobox"), "retro");
    await save(user);

    expect(onSave).toHaveBeenCalledWith({ ...NEW_COIN, name: "Lunch Decider", style: "retro" });
  });

  it("applies a preset template as a starting point", async () => {
    const { user, onSave } = renderEditor();
    const preset = PRESETS[0];
    await user.click(screen.getByRole("button", { name: preset.name }));
    expect(nameInput()).toHaveValue(`${preset.name} (Custom)`);
    await save(user);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: `${preset.name} (Custom)`,
        style: preset.style,
        headsColor: preset.headsColor,
        heads: preset.heads,
        tails: preset.tails,
      })
    );
    // The preset's faces are copied, not shared.
    expect(onSave.mock.calls[0][0].heads).not.toBe(preset.heads);
  });

  it("rejects a blank name and returns to the style tab", async () => {
    const { user, onSave } = renderEditor();
    await user.clear(nameInput());
    await user.type(nameInput(), "   ");
    await user.click(screen.getByRole("button", { name: /2\. Heads/ }));
    await save(user);

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Please enter a coin name.")).toBeInTheDocument();
    expect(nameInput()).toBeInTheDocument();
  });

  it("rejects a name over 30 characters even when maxLength is bypassed", async () => {
    const { user, onSave } = renderEditor({ config: { ...NEW_COIN, name: "x".repeat(31) } });
    await save(user);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Name must be 30 characters or fewer.")).toBeInTheDocument();
  });

  it("requires both faces and switches to the faces tab to fix them", async () => {
    const { user, onSave, rerender } = renderEditor({ config: { ...NEW_COIN, heads: { type: "image", value: "" } } });
    await save(user);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Please configure a heads face (text, emoji, or image).")).toBeInTheDocument();
    expect(screen.getByText("Heads Face")).toBeInTheDocument();

    rerender(
      <CoinEditorModal
        key="tails"
        config={{ ...NEW_COIN, tails: { type: "text", value: "" } }}
        onSave={onSave}
        onClose={jest.fn()}
      />
    );
    await save(user);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Please configure a tails face (text, emoji, or image).")).toBeInTheDocument();
  });

  it("saves picked colours and keeps them when moving between tabs", async () => {
    const { user, onSave, container } = renderEditor();
    const [heads, tails, rim] = container.querySelectorAll('input[type="color"]');
    fireEvent.input(heads, { target: { value: "#111111" } });
    fireEvent.input(tails, { target: { value: "#222222" } });
    fireEvent.input(rim, { target: { value: "#333333" } });
    expect(screen.getByText("#222222")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /2\. Heads/ }));
    await user.click(screen.getByRole("button", { name: /1\. Style/ }));
    expect(screen.getByText("#111111")).toBeInTheDocument();
    await save(user);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ headsColor: "#111111", tailsColor: "#222222", rimColor: "#333333" })
    );
  });

  it("saves typed text and emoji for both faces", async () => {
    const { user, onSave } = renderEditor({
      config: { ...NEW_COIN, tails: { type: "emoji", value: "⭐" } },
    });
    await user.click(screen.getByRole("button", { name: /2\. Heads/ }));
    const heads = within(faceCard("Heads Face"));
    await user.clear(heads.getByPlaceholderText(/Letters or symbol/));
    await user.type(heads.getByPlaceholderText(/Letters or symbol/), "YES");
    const tailsEmoji = within(faceCard("Tails Face")).getByPlaceholderText(/Paste single emoji/);
    await user.clear(tailsEmoji);
    await user.type(tailsEmoji, "⚡");
    await user.click(heads.getByRole("button", { name: "Emoji" }));
    await user.clear(heads.getByPlaceholderText(/Paste single emoji/));
    await user.type(heads.getByPlaceholderText(/Paste single emoji/), "👑");
    await save(user);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ heads: { type: "emoji", value: "👑" }, tails: { type: "emoji", value: "⚡" } })
    );
  });

  it("switches face types with sensible defaults and saves typed faces", async () => {
    const { user, onSave } = renderEditor();
    await user.click(screen.getByRole("button", { name: /Next: Configure Faces/ }));

    const heads = within(faceCard("Heads Face"));
    await user.click(heads.getByRole("button", { name: "Emoji" }));
    expect(heads.getByPlaceholderText(/Paste single emoji/)).toHaveValue("🪙");

    const tails = within(faceCard("Tails Face"));
    await user.click(tails.getByRole("button", { name: "Emoji" }));
    expect(tails.getByPlaceholderText(/Paste single emoji/)).toHaveValue("⭐");
    await user.click(tails.getByRole("button", { name: "Text" }));
    await user.clear(tails.getByPlaceholderText(/Letters or symbol/));
    await user.type(tails.getByPlaceholderText(/Letters or symbol/), "NO");
    await save(user);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ heads: { type: "emoji", value: "🪙" }, tails: { type: "text", value: "NO" } })
    );
  });

  it("uploads a processed image for a face and previews it", async () => {
    processImageFile.mockResolvedValue("data:image/webp;base64,CLEAN");
    const { user, onSave, container } = renderEditor();
    await user.click(screen.getByRole("button", { name: /2\. Heads/ }));
    await user.click(within(faceCard("Tails Face")).getByRole("button", { name: "Image" }));

    const upload = new File(["x"], "tails.png", { type: "image/png" });
    await user.upload(container.querySelector('input[type="file"]'), upload);

    expect(processImageFile).toHaveBeenCalledWith(upload);
    expect(await screen.findByAltText("Tails Preview")).toHaveAttribute("src", "data:image/webp;base64,CLEAN");
    await save(user);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ tails: { type: "image", value: "data:image/webp;base64,CLEAN" } })
    );
  });

  it("shows why an upload was rejected and keeps the face empty", async () => {
    processImageFile.mockRejectedValue(new Error("Image must be smaller than 2 MB"));
    const { user, container } = renderEditor();
    await user.click(screen.getByRole("button", { name: /2\. Heads/ }));
    await user.click(within(faceCard("Heads Face")).getByRole("button", { name: "Image" }));
    await user.upload(container.querySelector('input[type="file"]'), new File(["x"], "big.png", { type: "image/png" }));

    expect(await screen.findByText("Image must be smaller than 2 MB")).toBeInTheDocument();
    expect(screen.queryByAltText("Heads Preview")).not.toBeInTheDocument();
  });

  it("shows a save error from the page and disables the buttons while saving", () => {
    renderEditor({ error: "You can save up to 5 custom coins.", isSaving: true });
    expect(screen.getByText("You can save up to 5 custom coins.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Saving\.\.\./ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("flips the preview between faces", async () => {
    const { user } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Flip to Tails" }));
    expect(screen.getByRole("button", { name: "Flip to Heads" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Flip to Heads" }));
    expect(screen.getByRole("button", { name: "Flip to Tails" })).toBeInTheDocument();
  });

  it("closes from the close button, Cancel and the backdrop, but not from inside the dialog", async () => {
    const { user, onClose, container } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(container.firstChild);
    expect(onClose).toHaveBeenCalledTimes(3);

    await user.click(screen.getByRole("heading", { name: "Create Custom Coin" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

