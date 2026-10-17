/** One explicitly authorized administrative send. No scheduler or public endpoint. */
import {identityRuntime} from "../src/features/identity/runtime.ts";
import {closeDatabase} from "../src/db/client.ts";
import {createInquiryEmailTransport,InquiryEmailOutbox} from "../src/features/group-application/inquiry-email.ts";
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--dispatch-one"||!/^[-0-9a-f]{36}$/.test(args[1]!))throw Error("INQUIRY_EMAIL_ARGUMENTS_INVALID");
try{
 const {transport,from}=createInquiryEmailTransport(process.env),r=await identityRuntime();
 const state=await new InquiryEmailOutbox(r.store,r.config.workspaceId,r.config.keyring,r.clock).dispatchOne(args[1]!,transport,from);
 console.log(JSON.stringify({state}));
}finally{await closeDatabase();}
