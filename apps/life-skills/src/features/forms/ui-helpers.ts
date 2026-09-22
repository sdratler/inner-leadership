import type { FormDefinition, FormAnswers } from "./schema.ts";

export function validateFormAnswers(definition: FormDefinition, answers: FormAnswers): string | null {
  for (const field of definition.fields) {
    const value = answers[field.key];
    if (field.required && (value === undefined || value === "" || (Array.isArray(value) && value.length === 0))) return field.label;
  }
  return null;
}

export function nextAnswers(definition: FormDefinition, current: FormAnswers, key: string, value: string | boolean | string[]): FormAnswers {
  if (!definition.fields.some((field) => field.key === key)) return current;
  return { ...current, [key]: value };
}
