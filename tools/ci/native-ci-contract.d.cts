interface NativeCiTarget {
 version:string;suite:string;profile:string;database:string;role:string;nonceSha256:string;sourceBundleSha256:string;
 serverAddress:string;serverPort:number;clientAddress:string;artifactDirectory:string;roleOid:string;databaseOid:string;preparedCatalogSha256:string;url:string;
}
interface Inventory {version:string;sourceBundleSha256:string;sources:Array<{path:string;sha256:string}>;suites:Array<{path:string;profile:string}>;}
interface Connection {query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>;}
declare const contract:{VERSION:string;ADMIN_URL:string;MIGRATION_URL:string;sha(value:string|Uint8Array):string;sourceDigest(inputs:Inventory['sources']):string;validateInventory(i:Inventory,files:string[]):Inventory;parseTarget(env:Record<string,string|undefined>,i:Inventory):NativeCiTarget|null;marker(t:NativeCiTarget):string;verifyOwnedTarget(c:Connection,t:NativeCiTarget):Promise<void>;catalogDigest(c:Connection):Promise<string>};
export {NativeCiTarget,Inventory};
export default contract;
