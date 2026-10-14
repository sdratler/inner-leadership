import type {LearnerLesson} from "./fishing-lesson-journey.ts";

type Lesson=Pick<LearnerLesson,"moduleId"|"version"|"stage"|"title"|"instruction"|"questions">;
/** Reusable view, not a new route or role switch. Caller supplies an authorized DTO. */
export function FishingLessonCard({lesson,answers,onAnswer,onSubmit,busy=false,error=null,saved=false}:
 {lesson:Lesson;answers:Readonly<Record<string,string>>;onAnswer:(questionId:string,value:string)=>void;
  onSubmit:()=>void;busy?:boolean;error?:string|null;saved?:boolean}){
 return <section aria-labelledby={`lesson-${lesson.moduleId}`}>
  <p>Stage {lesson.stage} · <bdi>{lesson.moduleId}</bdi> · {lesson.version}</p>
  <h2 id={`lesson-${lesson.moduleId}`}>{lesson.title}</h2>
  <details><summary>Lesson instructions</summary><p>{lesson.instruction}</p></details>
  <form onSubmit={event=>{event.preventDefault();onSubmit();}}>
   {lesson.questions.map(question=><label key={question.id} style={{display:"grid",gap:"0.5rem",marginBlock:"1rem"}}>
    {question.prompt}<textarea name={question.id} value={answers[question.id]??""} maxLength={2000}
     disabled={busy} required onChange={event=>onAnswer(question.id,event.target.value)}/>
   </label>)}
   {error&&<p role="alert">{error}</p>}
   {saved&&<p role="status">Work saved. Your instructor will review it; this is not activity clearance.</p>}
   <button type="submit" className="lsw-button lsw-button--primary" disabled={busy}>{busy?"Saving…":"Submit my work"}</button>
  </form>
 </section>;
}
