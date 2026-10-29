import {z} from "zod";

/** A separately recorded owner statement; it does not replace captured attribution. */
export const inquirySourceCorrectionSchema=z.object({
 source:z.string().trim().min(1).max(100),
 basis:z.string().trim().min(1).max(500),
}).strict();
