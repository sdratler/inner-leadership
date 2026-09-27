import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import { shadowAttestationMessage, verifyShadowAttestation } from "../../../src/features/contact-ops/server/shadow-attestation.ts";

it("binds the owner attestation to the exact backup, snapshot, source and deployment", () => {
 const {privateKey,publicKey}=generateKeyPairSync("ed25519");
 const publicDer=publicKey.export({format:"der",type:"spki"}).toString("base64");
 const value={sourceFileId:"synthetic-file",sourceSheetId:42,sourceRevision:"synthetic-revision",
  deploymentId:"synthetic-deployment",workbookSha256:"a".repeat(64),snapshotSha256:"b".repeat(64),databaseBackupSha256:"c".repeat(64)};
 const signature=sign(null,shadowAttestationMessage(value),privateKey).toString("base64");
 expect(verifyShadowAttestation(value,signature,publicDer)).toBe(true);
 for(const changed of [
  {...value,sourceRevision:"other-revision"},
  {...value,deploymentId:"other-deployment"},
  {...value,snapshotSha256:"d".repeat(64)},
  {...value,databaseBackupSha256:"e".repeat(64)},
 ])expect(verifyShadowAttestation(changed,signature,publicDer)).toBe(false);
 expect(verifyShadowAttestation(value,"not a signature",publicDer)).toBe(false);
 expect(verifyShadowAttestation(value,signature)).toBe(false);
});
