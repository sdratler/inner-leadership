import {vi} from "vitest";

// These Node tests exercise server implementations outside Next's module loader.
// Mock only its import marker; database admission and runtime guards stay active.
vi.mock("server-only",()=>({}));
