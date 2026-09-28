import {sql,type SQL} from 'drizzle-orm';
import {AppError} from '../../lib/errors.ts';
import {asId} from '../../lib/ids.ts';
/** pg's array input must be a single bound PostgreSQL literal, never a JS array string. */
function boundValue(text:string,end:number,value:unknown):unknown {
 if(!Array.isArray(value))return value;
 if(!text.slice(end).startsWith('::uuid[]'))throw new AppError('INTERNAL');
 if(!value.every((item):item is string=>typeof item==='string'))throw new AppError('INTERNAL');
 return `{${value.map(item=>asId(item,'sql-uuid-array')).join(',')}}`;
}
/** Pure production binder shared by the server adapter and native service tests.
 * Convert only developer-owned $n SQL to bound parameters. Identifiers are never user input. */
export function bindStatement(text:string,values:readonly unknown[]):SQL {
 const query=sql.empty();let offset=0;const used=new Set<number>();
 for(const match of text.matchAll(/\$(\d+)/g)){
  const index=Number(match[1])-1;
  if(index<0||index>=values.length)throw new AppError('INTERNAL');
  query.append(sql.raw(text.slice(offset,match.index)));query.append(sql`${boundValue(text,match.index!+match[0].length,values[index])}`);
  offset=match.index!+match[0].length;used.add(index);
 }
 query.append(sql.raw(text.slice(offset)));
 if(used.size!==values.length)throw new AppError('INTERNAL');
 return query;
}
