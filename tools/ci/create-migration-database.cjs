/** Create one fixed, disposable sibling database for hosted CI migration commands. */
'use strict';
const {resolve,join}=require('node:path');
const {createRequire}=require('node:module');
const app=resolve(__dirname,'../../apps/life-skills');
const requireApp=createRequire(join(app,'package.json'));
const {Pool}=requireApp('pg');

async function main(){
 if(process.env.CI!=='true')throw new Error('CI_ONLY');
 const adminUrl=new URL(process.env.LS_DATABASE_URL||'invalid:');
 const targetUrl=new URL(process.env.LS_MIGRATION_DATABASE_URL||'invalid:');
 const common=(url)=>url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&url.port==='5432'&&!url.search;
 if(!common(adminUrl)||adminUrl.pathname!=='/lifeskills_ci_test')throw new Error('DISPOSABLE_ADMIN_DATABASE_REQUIRED');
 if(!common(targetUrl)||targetUrl.pathname!=='/lifeskills_migration_test')throw new Error('DISPOSABLE_MIGRATION_DATABASE_REQUIRED');
 const pool=new Pool({connectionString:adminUrl.href,ssl:false});
 try{await pool.query('CREATE DATABASE lifeskills_migration_test');}finally{await pool.end();}
 console.log('DISPOSABLE_MIGRATION_DATABASE_READY');
}

main().catch(()=>{console.error('DISPOSABLE_MIGRATION_DATABASE_BLOCKED');process.exitCode=1;});
