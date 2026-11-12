import { describe, it, expect } from "vitest";
import {
  NO_DEPARTMENT,
  cleanDepartmentName,
  departmentCounts,
  departmentOf,
  filterByDepartment,
  isHexColor,
  nextDepartmentColor,
} from "./departments";

const departments = [{ id: "robo" }, { id: "soft" }];
const items = [
  { department_id: "robo" },
  { department_id: "soft" },
  { department_id: "soft" },
  { department_id: null },
  { department_id: "removed" },
  {},
];

describe("departments", () => {
  it("finds an item's department and treats a removed one as none", () => {
    expect(departmentOf(items[0], departments)).toEqual({ id: "robo" });
    expect(departmentOf(items[4], departments)).toBeNull();
    expect(departmentOf(items[5], departments)).toBeNull();
  });

  it("filters by department, by none, or not at all", () => {
    expect(filterByDepartment(items, "soft", departments)).toHaveLength(2);
    expect(filterByDepartment(items, NO_DEPARTMENT, departments)).toHaveLength(3);
    expect(filterByDepartment(items, "", departments)).toHaveLength(6);
  });

  it("counts items per department and the ones with none", () => {
    expect(departmentCounts(items, departments)).toEqual({ byId: { robo: 1, soft: 2 }, none: 3 });
  });

  it("accepts sensible names and colours only", () => {
    expect(cleanDepartmentName("  Field   ops ")).toBe("Field ops");
    expect(cleanDepartmentName("   ")).toBeNull();
    expect(cleanDepartmentName("x".repeat(41))).toBeNull();
    expect(isHexColor("#5b8fd6")).toBe(true);
    expect(isHexColor("blue")).toBe(false);
  });

  it("offers a colour no department uses yet", () => {
    expect(nextDepartmentColor([{ color: "#5b8fd6" }, { color: "#5FAE8B" }])).toBe("#d9774f");
  });
});
