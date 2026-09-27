import { createPublicKey, verify } from "node:crypto";

/** Public verifier only. The signing key is owner-local and Windows DPAPI protected. */
export const SHADOW_ATTESTATION_PUBLIC_KEY = "MCowBQYDK2VwAyEA1eM66lcH9HqHpmoDkvfI9MDw+3fwhZsnMu1A7pirBJg=";
export const SHADOW_WORKBOOK_SHA256 = "f31a833a6aa95b77d708ac68a22e08be57099482137e9c33483f8a8db9174625";
export const SHADOW_SNAPSHOT_SHA256 = "d4a468a83862e106052767708b2e07df5b33558f3ebf5f72bb05687b08394772";
export const SHADOW_PLAN_DIGEST = "2ca81e1b1e2c4b5cf17256b5c7236857c0fd03529ad6231e98ffef3b76104c68";

export type ShadowAttestation = {
 workspaceId: string; sourceFileId: string; sourceSheetId: number; sourceRevision: string;
 deploymentId: string; reviewedMainSha: string; operatorSha256: string;
 workbookSha256: string; snapshotSha256: string; databaseBackupSha256: string;
};

export function shadowAttestationMessage(value: ShadowAttestation): Buffer {
 return Buffer.from([
  "ls-native-shadow-v1", value.workspaceId, value.sourceFileId, String(value.sourceSheetId), value.sourceRevision,
  value.deploymentId, value.reviewedMainSha, value.operatorSha256,
  value.workbookSha256, value.snapshotSha256, value.databaseBackupSha256, "",
 ].join("\n"), "utf8");
}

export function verifyShadowAttestation(value: ShadowAttestation, signatureBase64: string, publicKeySpkiBase64 = SHADOW_ATTESTATION_PUBLIC_KEY): boolean {
 if (!/^[A-Za-z0-9+/]{86}==$/.test(signatureBase64)) return false;
 try {
  const key = createPublicKey({key:Buffer.from(publicKeySpkiBase64,"base64"),format:"der",type:"spki"});
  return verify(null, shadowAttestationMessage(value), key, Buffer.from(signatureBase64,"base64"));
 } catch { return false; }
}
