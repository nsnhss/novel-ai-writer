import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UpdateSettings } from "./UpdateSettings";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

describe("UpdateSettings", () => {
  it("渲染版本信息与检查更新按钮", () => {
    render(<UpdateSettings />);
    expect(screen.getByText(/AI 小说写作/)).toBeInTheDocument();
    expect(screen.getByText(/检查更新/)).toBeInTheDocument();
  });

  it("点击检查更新后显示结果", async () => {
    const { check } = await import("@tauri-apps/plugin-updater");
    vi.mocked(check).mockResolvedValueOnce(null as unknown as Awaited<ReturnType<typeof check>>);

    render(<UpdateSettings />);
    fireEvent.click(screen.getByText(/检查更新/));

    await waitFor(() => {
      expect(screen.getByText(/当前已是最新版本/)).toBeInTheDocument();
    });
  });
});
