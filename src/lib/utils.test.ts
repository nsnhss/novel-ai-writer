import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("合并多个类名字符串", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("过滤 falsy 值", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });

  it("解决 Tailwind 类名冲突", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("支持对象形式", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });
});
