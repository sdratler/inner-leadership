declare const idBrand: unique symbol;
export type Id<K extends string> = string & { readonly [idBrand]: K };
export type WorkspaceId = Id<"workspace">;
export type AccountId = Id<"account">;
export type CaseId = Id<"case">;
export type RequestId = Id<"request">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function asId<K extends string>(value: string, _kind: K): Id<K> {
  void _kind;
  if (!UUID.test(value)) throw new Error("INVALID_ID");
  return value.toLowerCase() as Id<K>;
}
export function newRequestId(): RequestId { return asId(crypto.randomUUID(), "request"); }
