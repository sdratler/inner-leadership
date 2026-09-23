export function selectAuthorizedPaymentCase<T extends {id:string;kind:'minor'|'adult'}>(items:readonly T[],role:'practitioner'|'parent',requested?:string){
 const available=role==='practitioner'?[...items]:items.filter(item=>item.kind==='minor');
 const selected=requested?available.find(item=>item.id===requested):available[0];
 return {available,selected,invalid:Boolean(requested&&!selected)};
}
