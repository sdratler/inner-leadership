import {Fragment} from "react";

/** Isolate amounts and ranges so Hebrew punctuation never reverses their order. */
export function AcademyBidi({children}:{children:string}){
 return <>{children.split(/(\$\d[\d,]*(?:\.\d+)?|\d+–\d+)/g).map((part,index)=>/^\$\d|^\d+–\d+$/.test(part)?<bdi dir="ltr" key={index}>{part}</bdi>:<Fragment key={index}>{part}</Fragment>)}</>;
}
