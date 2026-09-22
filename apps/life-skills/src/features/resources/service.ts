import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId, type Id } from "../../lib/ids.ts";
import { seal, unseal } from "../identity/crypto.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import type { IdentityConfig } from "../identity/config.ts";
import type { IdentityStore,SqlSession } from "../identity/store.ts";
import { one } from "../identity/store.ts";
import type { Actor, AudienceId, CaseId, IdentityClock } from "../identity/types.ts";
import { loadAudience, loadCase, loadGuardians } from "../cases/data.ts";
import { audienceAccess, caseAccess, requirePractitioner } from "../cases/policy.ts";
import { recordLs050Action } from "../progress/history.ts";
import type { ResourceReference } from "./schema.ts";

export type ResourceId = Id<"resource">;
export type ResourceAssignmentId = Id<"resource_assignment">;
function commandDigest(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
async function resourceCommand<T>(tx:SqlSession,config:IdentityConfig,actor:Actor,operation:"create_resource"|"assign_resource",key:string,body:unknown,work:()=>Promise<T>):Promise<T>{if(!/^[0-9a-f-]{36}$/i.test(key))throw new AppError("INVALID_REQUEST");const digest=commandDigest(body),aad=`resource-command:${actor.workspaceId}:${actor.id}:${operation}:${key}`,prior=await one<{bodyDigest:string;resultCiphertext:string}>(tx,'SELECT body_digest AS "bodyDigest",result_ciphertext AS "resultCiphertext" FROM ls_resources.command_receipts WHERE workspace_id=$1 AND actor_account_id=$2 AND operation=$3 AND idempotency_key=$4',[actor.workspaceId,actor.id,operation,key]);if(prior){if(prior.bodyDigest!==digest)throw new AppError("CONFLICT");return JSON.parse(unseal(prior.resultCiphertext,aad,config.keyring)) as T}const result=await work();await tx.query('INSERT INTO ls_resources.command_receipts(workspace_id,actor_account_id,operation,idempotency_key,body_digest,result_ciphertext) VALUES($1,$2,$3,$4,$5,$6)',[actor.workspaceId,actor.id,operation,key,digest,seal(JSON.stringify(result),aad,config.keyring)]);return result;}

interface ResourceAssignmentRow {
  assignmentId: ResourceAssignmentId;
  resourceId: ResourceId;
  caseId: CaseId;
  audienceId: AudienceId;
  type: "audio" | "pdf" | "video" | "link" | "text" | "digital_form";
  title: string;
  description: string;
  referenceCiphertext: string;
  downloadable: boolean;
  locale: "he" | "en";
  dueDate: string | null;
  displayDate: string;
  completionEnabled: boolean;
  completed: boolean;
  completedByAccountId: Actor["id"] | null;
}

export type ResourceProjection =
  | { assignmentId: ResourceAssignmentId; resourceId: ResourceId; title: string; completed: boolean; detailsAvailable: false }
  | { assignmentId: ResourceAssignmentId; resourceId: ResourceId; title: string; completed: boolean; detailsAvailable: true; type: ResourceAssignmentRow["type"]; description: string; reference: ResourceReference; downloadable: boolean; locale: "he" | "en"; dueDate: string | null; displayDate: string; completionEnabled: boolean; completedByAccountId: Actor["id"] | null };

export function projectResource(row: Omit<ResourceAssignmentRow, "referenceCiphertext"> & { reference: ResourceReference }, full: boolean): ResourceProjection {
  if (!full) return { assignmentId: row.assignmentId, resourceId: row.resourceId, title: row.title, completed: row.completed, detailsAvailable: false };
  return {
    assignmentId: row.assignmentId,
    resourceId: row.resourceId,
    title: row.title,
    completed: row.completed,
    detailsAvailable: true,
    type: row.type,
    description: row.description,
    reference: row.reference,
    downloadable: row.downloadable,
    locale: row.locale,
    dueDate: row.dueDate,
    displayDate: row.displayDate,
    completionEnabled: row.completionEnabled,
    completedByAccountId: row.completedByAccountId,
  };
}

export class ResourcesService {
  constructor(private readonly store: IdentityStore, private readonly config: IdentityConfig, private readonly clock: IdentityClock) {}

  async create(actor: Actor, input: { type: ResourceAssignmentRow["type"]; title: string; description: string; reference: ResourceReference; downloadable: boolean; locale: "he" | "en" }, requestId: string,idempotencyKey:string) {
    const now = this.clock.now();
    return this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      requirePractitioner(await freshActor(tx, actor, now));
      return resourceCommand(tx,this.config,actor,"create_resource",idempotencyKey,input,async()=>{const id = asId(randomUUID(), "resource");
      const reference = seal(JSON.stringify(input.reference), `resource:${actor.workspaceId}:${id}`, this.config.keyring);
      await tx.query(`INSERT INTO ls_resources.resources
        (id,workspace_id,type,title,description,reference_ciphertext,downloadable,locale,owner_account_id,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, actor.workspaceId, input.type, input.title, input.description, reference, input.downloadable, input.locale, actor.id, now]);
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "resource_created");
      return { resourceId: id };});
    });
  }

  async assign(actor: Actor, input: { resourceId: ResourceId; caseId: CaseId; audienceId: AudienceId; dueDate: string | null; displayDate: string; completionEnabled: boolean }, requestId: string,idempotencyKey:string) {
    const now = this.clock.now();
    return this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      return resourceCommand(tx,this.config,actor,"assign_resource",idempotencyKey,input,async()=>{const current = await freshActor(tx, actor, now);
      const item = await loadCase(tx, actor.workspaceId, input.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, input.caseId);
      caseAccess(current, item, guardians, "publish");
      if (!await one(tx, `SELECT id FROM ls_resources.resources WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL`, [actor.workspaceId, input.resourceId])) throw new AppError("NOT_FOUND");
      const audience = await loadAudience(tx, actor.workspaceId, input.caseId, input.audienceId);
      if (!audience || !audience.published || audience.visibility === "private") throw new AppError("NOT_FOUND");
      audienceAccess(current, item, guardians, audience);
      const id = asId(randomUUID(), "resource_assignment");
      await tx.query(`INSERT INTO ls_resources.resource_assignments
        (id,workspace_id,resource_id,case_id,audience_id,due_date,display_date,completion_enabled,assigned_by_account_id,assigned_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, actor.workspaceId, input.resourceId, input.caseId, input.audienceId, input.dueDate, input.displayDate, input.completionEnabled, actor.id, now]);
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "resource_assigned");
      return { assignmentId: id };});
    });
  }

  async list(actor: Actor, caseId: CaseId): Promise<ResourceProjection[]> {
    return this.store.transaction(async (tx) => {
      const current = await freshActor(tx, actor, this.clock.now());
      const item = await loadCase(tx, actor.workspaceId, caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, caseId);
      caseAccess(current, item, guardians, "read");
      const rows = await tx.query<ResourceAssignmentRow>(`SELECT a.id AS "assignmentId",r.id AS "resourceId",a.case_id AS "caseId",a.audience_id AS "audienceId",
        r.type,r.title,r.description,r.reference_ciphertext AS "referenceCiphertext",r.downloadable,r.locale,
        a.due_date::text AS "dueDate",a.display_date::text AS "displayDate",a.completion_enabled AS "completionEnabled",
        (c.assignment_id IS NOT NULL) AS completed,c.completed_by_account_id AS "completedByAccountId"
        FROM ls_resources.resource_assignments a JOIN ls_resources.resources r ON r.workspace_id=a.workspace_id AND r.id=a.resource_id
        LEFT JOIN LATERAL (SELECT assignment_id,completed_by_account_id FROM ls_resources.resource_completions c
          WHERE c.workspace_id=a.workspace_id AND c.assignment_id=a.id ORDER BY c.completed_at,c.id LIMIT 1) c ON true
        WHERE a.workspace_id=$1 AND a.case_id=$2 AND a.withdrawn_at IS NULL AND r.archived_at IS NULL
        ORDER BY a.display_date DESC,a.id LIMIT 100`, [actor.workspaceId, caseId]);
      const result: ResourceProjection[] = [];
      for (const row of rows) {
        const audience = await loadAudience(tx, actor.workspaceId, caseId, row.audienceId);
        if (!audience) continue;
        try { audienceAccess(current, item, guardians, audience); } catch (error) {
          if (error instanceof AppError && error.code === "NOT_FOUND") continue;
          throw error;
        }
        const full = current.role === "practitioner" || audience.visibility === "family_full";
        if (!full) {
          result.push({ assignmentId: row.assignmentId, resourceId: row.resourceId, title: row.title, completed: row.completed, detailsAvailable: false });
          continue;
        }
        const reference = JSON.parse(unseal(row.referenceCiphertext, `resource:${actor.workspaceId}:${row.resourceId}`, this.config.keyring)) as ResourceReference;
        result.push(projectResource({ ...row, reference }, true));
      }
      return result;
    });
  }

  /** Practitioner library metadata only; no storage keys or private bytes. */
  async catalog(actor: Actor) {
    return this.store.transaction(async tx => {
      requirePractitioner(await freshActor(tx, actor, this.clock.now()));
      return tx.query<{resourceId:ResourceId;title:string;type:ResourceAssignmentRow['type'];locale:'he'|'en'}>(
        'SELECT id AS "resourceId",title,type,locale FROM ls_resources.resources WHERE workspace_id=$1 AND archived_at IS NULL ORDER BY created_at DESC,id LIMIT 100', [actor.workspaceId]);
    });
  }

  async complete(actor: Actor, assignmentId: ResourceAssignmentId, idempotencyKey: string, requestId: string) {
    const now = this.clock.now();
    return this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      if (current.role === "practitioner") throw new AppError("FORBIDDEN");
      const row = await one<Pick<ResourceAssignmentRow, "caseId" | "audienceId" | "completionEnabled">>(tx,
        `SELECT case_id AS "caseId",audience_id AS "audienceId",completion_enabled AS "completionEnabled"
        FROM ls_resources.resource_assignments WHERE workspace_id=$1 AND id=$2 AND withdrawn_at IS NULL`, [actor.workspaceId, assignmentId]);
      if (!row || !row.completionEnabled) throw new AppError("NOT_FOUND");
      const item = await loadCase(tx, actor.workspaceId, row.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, row.caseId);
      const audience = await loadAudience(tx, actor.workspaceId, row.caseId, row.audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      audienceAccess(current, item, guardians, audience);
      const existing = await one<{ id: string; idempotencyKey: string }>(tx, `SELECT id,idempotency_key AS "idempotencyKey" FROM ls_resources.resource_completions
        WHERE workspace_id=$1 AND assignment_id=$2 AND completed_by_account_id=$3`,
      [actor.workspaceId, assignmentId, actor.id]);
      if (existing) {
        if (existing.idempotencyKey !== idempotencyKey) throw new AppError("CONFLICT");
        return { completionId: existing.id, duplicate: true };
      }
      const id = randomUUID();
      await tx.query(`INSERT INTO ls_resources.resource_completions
        (id,workspace_id,assignment_id,completed_by_account_id,idempotency_key,completed_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, actor.workspaceId, assignmentId, actor.id, idempotencyKey, now]);
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "resource_completion_reported");
      return { completionId: id, duplicate: false };
    });
  }
}
