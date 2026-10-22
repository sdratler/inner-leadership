import type {LessonReference,LearnerLesson} from "../resources/fishing-lesson-journey.ts";
import type {StageView} from "./contract.ts";

/** Supplies the existing educationSearch/Resources consumer, never a new route
 * or an access grant. MAIN still resolves current assignment/catalog/identity. */
export function stageLessonReference(view:StageView,occurrenceId:string,learnerId:string):LessonReference|null{
 const occurrence=view.occurrences.find(o=>o.id===occurrenceId);
 const binding=view.lessonReferences.find(l=>l.occurrenceId===occurrenceId);
 if(!occurrence||!binding||binding.moduleId!==occurrence.moduleId||binding.version!==occurrence.moduleVersion)return null;
 return {learnerId,moduleId:binding.moduleId,version:binding.version};
}
/** Narrow guard for MAIN to call in the existing FishingLessonJourney submit
 * path AFTER fresh authorization/catalog resolution. It creates no second
 * classroom/event store. Draft persistence remains a separate MAIN change. */
export function assertCompleteLessonAnswers(lesson:Pick<LearnerLesson,"status"|"questions">,answers:readonly {questionId:string;value:string}[]):void{
 const required=new Set(lesson.questions.map(q=>q.id));
 if(lesson.status!=="approved"||!required.size||required.size!==lesson.questions.length||answers.length!==required.size||
  new Set(answers.map(a=>a.questionId)).size!==required.size||answers.some(a=>!required.has(a.questionId)||!a.value.trim()||a.value.length>2000))
  throw Error("FISHING_LESSON_COMPLETE_ANSWERS_REQUIRED");
}
