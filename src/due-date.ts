import { casual } from "chrono-node/en";

export function dateOnly(date:Date):string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
/** Date-only values use the browser's local calendar, never a UTC conversion. */
export function parseDueDate(input:string,reference=new Date()):string|null {
  const text=input.trim();if(!text)return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)){
    const [year,month,day]=text.split("-").map(Number),date=new Date(year!,month!-1,day!);
    return dateOnly(date)===text?text:null;
  }
  if(/^(?:eow|end of (?:the )?week)$/i.test(text)){
    const date=new Date(reference);date.setDate(date.getDate()+(5-date.getDay()+7)%7);return dateOnly(date);
  }
  if(/^this weekend$/i.test(text)){
    const date=new Date(reference);date.setDate(date.getDate()+(6-date.getDay()+7)%7);return dateOnly(date);
  }
  const results=casual.parse(text,reference,{forwardDate:true}),result=results[0];
  if(results.length!==1||!result||result.index!==0||result.text.length!==text.length||result.end||(!result.start.isCertain("day")&&!result.start.isCertain("weekday")))return null;
  const date=result.start.date();return Number.isNaN(date.getTime())?null:dateOnly(date);
}
