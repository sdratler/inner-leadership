import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import { shadowAttestationMessage, verifyShadowAttestation } from "../../../src/features/contact-ops/server/shadow-attestation.ts";

it("binds the owner attestation to the exact backup, snapshot, source and deployment", () => {
 const {privateKey,publicKey}=generateKeyPairSync("ed25519");
 const publicDer=publicKey.export({format:"der",type:"spki"}).toString("base64");
 const value={workspaceId:"synthetic-workspace",sourceFileId:"synthetic-file",sourceSheetId:42,sourceRevision:"synthetic-revision",
  deploymentId:"synthetic-deployment",reviewedMainSha:"1".repeat(40),operatorSha256:"2".repeat(64),
  workbookSha256:"a".repeat(64),snapshotSha256:"b".repeat(64),databaseBackupSha256:"c".repeat(64)};
 const signature=sign(null,shadowAttestationMessage(value),privateKey).toString("base64");
 expect(verifyShadowAttestation(value,signature,publicDer)).toBe(true);
 for(const changed of [
  {...value,workspaceId:"another-workspace"},
  {...value,sourceRevision:"other-revision"},
  {...value,deploymentId:"other-deployment"},
  {...value,reviewedMainSha:"3".repeat(40)},
  {...value,operatorSha256:"4".repeat(64)},
  {...value,snapshotSha256:"d".repeat(64)},
  {...value,databaseBackupSha256:"e".repeat(64)},
 ])expect(verifyShadowAttestation(changed,signature,publicDer)).toBe(false);
 expect(verifyShadowAttestation(value,"not a signature",publicDer)).toBe(false);
 expect(verifyShadowAttestation(value,signature)).toBe(false);
});
