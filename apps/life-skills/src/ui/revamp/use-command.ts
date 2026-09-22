"use client";
import { useEffect, useRef, useState } from "react";
export type CommandOutcome<T> = {
    state: "accepted";
    value: T;
} | {
    state: "rejected";
    message: string;
} | {
    state: "unknown";
};
export interface CommandPort<I, O> {
    execute(input: I, key: string): Promise<CommandOutcome<O>>;
    reconcile(key: string): Promise<CommandOutcome<O>>;
}
/** A request transport failure is an unknown write, not proof that a server-side write failed. */
export function useCommand<I, O>(port: CommandPort<I, O>, onAccepted: (value: O) => void) {
    const alive = useRef(true), lock = useRef(false), pendingKey = useRef<string | null>(null);
    const [phase, setPhase] = useState<"idle" | "pending" | "unknown" | "saved" | "rejected">("idle");
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const apply = (out: CommandOutcome<O>) => {
        if (!alive.current)
            return;
        if (out.state === "accepted") {
            pendingKey.current = null;
            setPhase("saved");
            onAccepted(out.value);
        }
        else if (out.state === "rejected") {
            pendingKey.current = null;
            setPhase("rejected");
            setError(out.message);
        }
        else
            setPhase("unknown");
    };
    const execute = async (input: I) => {
        if (lock.current || pendingKey.current)
            return;
        lock.current = true;
        pendingKey.current = crypto.randomUUID();
        setPhase("pending");
        setError(null);
        try {
            apply(await port.execute(input, pendingKey.current));
        }
        catch {
            apply({ state: "unknown" });
        }
        finally {
            lock.current = false;
        }
    };
    const reconcile = async () => {
        if (lock.current || !pendingKey.current)
            return;
        lock.current = true;
        setPhase("pending");
        setError(null);
        try {
            apply(await port.reconcile(pendingKey.current));
        }
        catch {
            apply({ state: "unknown" });
        }
        finally {
            lock.current = false;
        }
    };
    return { execute, reconcile, phase, error, locked: phase === "pending" || phase === "unknown" };
}
