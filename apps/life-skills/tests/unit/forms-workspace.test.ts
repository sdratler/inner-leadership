import { describe, expect, it, vi } from "vitest";
import { nextAnswers, validateFormAnswers } from "../../src/features/forms/ui-helpers.ts";
import type { FormDefinition } from "../../src/features/forms/schema.ts";
import { FormAnswerReadout, FormField } from "../../src/features/forms/workspace.tsx";

const definition: FormDefinition = { title: "Private check-in", introduction: "", fields: [
  { key: "summary", kind: "long_text", label: "Summary", required: true },
  { key: "done", kind: "boolean", label: "Done", required: false },
] };

describe("FormsWorkspace helpers", () => {
  it("requires required answers and ignores unknown answer keys", () => {
    expect(validateFormAnswers(definition, {})).toBe("Summary");
    expect(validateFormAnswers(definition, { summary: "A clear answer" })).toBeNull();
    expect(nextAnswers(definition, {}, "unknown", "leak")).toEqual({});
  });
  it("preserves boolean and text answer values", () => {
    expect(nextAnswers(definition, {}, "summary", "Done")).toEqual({ summary: "Done" });
    expect(nextAnswers(definition, { summary: "Done" }, "done", true)).toEqual({ summary: "Done", done: true });
  });
});

const controls: FormDefinition = { title: "Controls", introduction: "", fields: [
  { key: "long", kind: "long_text", label: "Long", required: true },
  { key: "single", kind: "single_choice", label: "Single", required: true, options: [{ value: "a", label: "Alpha" }] },
  { key: "multiple", kind: "multiple_choice", label: "Multiple", required: false, options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] },
  { key: "flag", kind: "boolean", label: "Flag", required: false },
  { key: "date", kind: "date", label: "Date", required: false },
  { key: "short", kind: "short_text", label: "Short", required: false },
] };

it("renders each supported respondent control with its exact native control", () => {
  const changed = vi.fn();
  expect(FormField({ locale: "en", field: controls.fields[0]!, value: "", onChange: changed }).type).toBe("textarea");
  expect(FormField({ locale: "en", field: controls.fields[1]!, value: "", onChange: changed }).type).toBe("select");
  const multiple = FormField({ locale: "en", field: controls.fields[2]!, value: [], onChange: changed });
  expect(multiple.type).toBe("select"); expect(multiple.props.multiple).toBe(true);
  expect(FormField({ locale: "en", field: controls.fields[3]!, value: undefined, onChange: changed }).type).toBe("select");
  expect(FormField({ locale: "en", field: controls.fields[4]!, value: "", onChange: changed }).props.type).toBe("date");
  expect(FormField({ locale: "en", field: controls.fields[5]!, value: "", onChange: changed }).props.type).toBe("text");
});

it("preserves long text, one choice, and many choices through FormField callbacks", () => {
  const long = vi.fn(), single = vi.fn(), many = vi.fn();
  const longControl = FormField({ locale: "en", field: controls.fields[0]!, value: "", onChange: long });
  (longControl.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "A detailed answer" } });
  const singleControl = FormField({ locale: "en", field: controls.fields[1]!, value: "", onChange: single });
  (singleControl.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "a" } });
  const multipleControl = FormField({ locale: "en", field: controls.fields[2]!, value: [], onChange: many });
  (multipleControl.props.onChange as (event: { target: { selectedOptions: ArrayLike<{ value: string }> } }) => void)({ target: { selectedOptions: [{ value: "a" }, { value: "b" }] } });
  expect(long).toHaveBeenCalledWith("A detailed answer"); expect(single).toHaveBeenCalledWith("a"); expect(many).toHaveBeenCalledWith(["a", "b"]);
});

it("renders protected answers as labels, never raw choice values", () => {
  const readout = FormAnswerReadout({ locale: "en", definition: controls, answers: { single: "a", multiple: ["a", "b"], long: "Private text" } });
  const rendered = JSON.stringify(readout);
  expect(rendered).toContain("Alpha"); expect(rendered).toContain("Beta"); expect(rendered).toContain("Private text");
});
