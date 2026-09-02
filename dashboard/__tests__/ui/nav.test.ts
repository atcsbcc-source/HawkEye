import { describe, expect, it } from "vitest";
import { NAV, crumbsFor, isNavActive } from "../../lib/nav";

describe("lib/nav", () => {
  it("lists the four primary routes in order", () => {
    expect(NAV.map((n) => n.href)).toEqual(["/", "/operations", "/automation", "/flights"]);
  });

  it("maps /properties/* to Command Center and matches nested routes", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/", "/properties/m1")).toBe(true);
    expect(isNavActive("/", "/operations")).toBe(false);
    expect(isNavActive("/operations", "/operations")).toBe(true);
    expect(isNavActive("/operations", "/operations/x")).toBe(true);
    expect(isNavActive("/operations", "/operationsx")).toBe(false);
  });

  it("builds breadcrumbs with a leaf and linked parents", () => {
    expect(crumbsFor("/")).toEqual([{ label: "Command Center" }]);
    expect(crumbsFor("/operations")).toEqual([{ label: "Operations" }]);
    expect(crumbsFor("/properties/m1")).toEqual([
      { label: "Command Center", href: "/" },
      { label: "Property" },
    ]);
    expect(crumbsFor("/properties/new")).toEqual([
      { label: "Command Center", href: "/" },
      { label: "New" },
    ]);
    expect(crumbsFor("/properties/m1/edit")).toEqual([
      { label: "Command Center", href: "/" },
      { label: "Edit" },
    ]);
    expect(crumbsFor("/flights/abc")).toEqual([
      { label: "Flights", href: "/flights" },
      { label: "Abc" },
    ]);
  });
});
