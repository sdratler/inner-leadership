import type {LearnerLesson} from "./fishing-lesson-journey.ts";
import type {Locale} from "../../lib/locale.ts";
import styles from "./education-workspace.module.css";

type Lesson=Pick<LearnerLesson,"moduleId"|"version"|"stage"|"title"|"instruction"|"questions">;
/** Reusable view, not a new route or role switch. Caller supplies an authorized DTO. */
export function FishingLessonCard({lesson,answers,onAnswer,onSubmit,onSaveDraft,busy=false,error=null,saved=false,draftSaved=false,locale="en",canSubmit=true,canSaveDraft=true}:
 {lesson:Lesson;answers:Readonly<Record<string,string>>;onAnswer:(questionId:string,value:string)=>void;
  onSubmit:()=>void;onSaveDraft?:()=>void;busy?:boolean;error?:string|null;saved?:boolean;draftSaved?:boolean;locale?:Locale;canSubmit?:boolean;canSaveDraft?:boolean}){
 return <section aria-labelledby={`lesson-${lesson.moduleId}`}>
  <p>{locale==="he"?"שלב":"Stage"} {lesson.stage} · <bdi>{lesson.moduleId}</bdi> · <bdi>{lesson.version}</bdi></p>
  <h2 id={`lesson-${lesson.moduleId}`}>{lesson.title}</h2>
  <details className="lsw-details"><summary>{locale==="he"?"הנחיות השיעור":"Lesson instructions"}</summary><p className={styles.text}>{lesson.instruction}</p></details>
  <form onSubmit={event=>{event.preventDefault();onSubmit();}}>
   {lesson.questions.map(question=><div className={`lsw-field ${styles.answer}`} key={question.id}>
    <label htmlFor={`lesson-${lesson.moduleId}-${question.id}`}>{question.prompt}</label><textarea id={`lesson-${lesson.moduleId}-${question.id}`} className="lsw-input" name={question.id} value={answers[question.id]??""} maxLength={2000}
     disabled={busy} required onChange={event=>onAnswer(question.id,event.target.value)}/>
   </div>)}
   {error&&<p role="alert">{error}</p>}
   {saved&&<p role="status">{locale==="he"?"העבודה נשמרה לעיון המדריך; אין בכך אישור לפעילות.":"Work saved. Your instructor will review it; this is not activity clearance."}</p>}
   {draftSaved&&<p role="status">{locale==="he"?"הטיוטה נשמרה במערכת. היא טרם הוגשה למדריך.":"Draft saved in the app. It has not been submitted to your instructor."}</p>}
   {onSaveDraft&&<button type="button" className="lsw-button" disabled={busy||!canSaveDraft} onClick={onSaveDraft}>{locale==="he"?"שמירת טיוטה":"Save draft"}</button>}
   <button type="submit" className="lsw-button lsw-button--primary" disabled={busy||!canSubmit}>{busy?(locale==="he"?"שמירה…":"Saving…"):(locale==="he"?"שליחת העבודה שלי":"Submit my work")}</button>
  </form>
 </section>;
}
