// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

describe("interactive cursor affordance", () => {
  afterEach(cleanup);

  it("uses a pointer cursor for shared clickable primitives", () => {
    render(
      <>
        <Button>Save</Button>
        <Select defaultValue="one">
          <SelectTrigger aria-label="Choose value">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
          </SelectContent>
        </Select>
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">One tab</TabsTrigger>
          </TabsList>
        </Tabs>
      </>,
    );

    expect(screen.getByRole("button", { name: "Save" }).className).toContain("cursor-pointer");
    expect(screen.getByRole("combobox", { name: "Choose value" }).className).toContain("cursor-pointer");
    expect(screen.getByRole("tab", { name: "One tab" }).className).toContain("cursor-pointer");
  });
});
