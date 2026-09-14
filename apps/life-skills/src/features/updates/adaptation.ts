import { AppError } from "../../lib/errors.ts";
import type { PracticeAdaptationPort } from "./types.ts";

/** Runtime default until the central integrator wires the LS-040 revision service. */
export const unavailablePracticeAdaptationPort: PracticeAdaptationPort = Object.freeze({
  async createDraftFromReport() { throw new AppError("UNAVAILABLE"); },
});

