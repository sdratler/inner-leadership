/** UI lifecycle helper: keep one idempotency key through uncertain retries; never cross a case switch. */
export interface MutationTicket {
    scope: string;
    payloadDigest: string;
    idempotencyKey: string;
    state: "pending" | "unknown" | "succeeded" | "failed";
}
export class MutationGate {
    private ticket: MutationTicket | null = null;
    private readonly nextId: () => string;
    constructor(nextId: () => string) { this.nextId = nextId; }
    begin(scope: string, payloadDigest: string): Readonly<MutationTicket> {
        if (this.ticket && ["pending", "unknown"].includes(this.ticket.state)) {
            if (this.ticket.scope !== scope || this.ticket.payloadDigest !== payloadDigest)
                throw new Error("RECONCILE_PREVIOUS_SAVE_FIRST");
            if (this.ticket.state === "pending")
                throw new Error("SAVE_ALREADY_PENDING");
            this.ticket.state = "pending";
            return { ...this.ticket };
        }
        this.ticket = { scope, payloadDigest, idempotencyKey: this.nextId(), state: "pending" };
        return { ...this.ticket };
    }
    settle(idempotencyKey: string, state: "unknown" | "succeeded" | "failed"): void {
        if (!this.ticket || this.ticket.idempotencyKey !== idempotencyKey)
            throw new Error("STALE_SAVE_RESULT");
        this.ticket.state = state;
    }
    current(): Readonly<MutationTicket> | null { return this.ticket ? { ...this.ticket } : null; }
    /** Only call after a receipt read proves the final outcome, or before any request was issued. */
    clear(): void {
        if (this.ticket && ["pending", "unknown"].includes(this.ticket.state))
            throw new Error("SAVE_OUTCOME_UNRESOLVED");
        this.ticket = null;
    }
}
