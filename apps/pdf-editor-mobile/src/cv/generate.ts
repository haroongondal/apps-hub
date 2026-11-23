import { readBody, type CvBody } from './model.ts';

export type Complete = (system: string, user: string, json: boolean) => Promise<string>;

const SHAPE =
  '{"name": string, "title": string, "contact": string[], "sections": [{"heading": string, "entries": [{"title": string, "subtitle": string, "dates": string, "lines": string[], "plain": boolean}]}]}';

const WRITE = `You write CVs. Reply with one JSON object only, shaped like ${SHAPE}.
Use only facts the user gave. Never invent employers, dates, degrees, numbers or certifications; use "" for anything unknown.
Write in the language the user writes in. Bullets are short lines that start with a verb.
Set "plain": true only for a summary paragraph. Order the sections: Summary, Experience, Education, Skills, then anything else the user gave.`;

const EDIT = `You edit a CV. The user sends the current CV as JSON and one instruction. Apply the instruction and change nothing else.
Add or remove sections when the instruction asks. Reply with the complete CV as one JSON object, shaped like ${SHAPE}.
Do not add facts the CV does not already contain unless the instruction gives them.`;

export async function generateBody(profile: string, targetRole: string, complete: Complete): Promise<CvBody> {
  const user = `Target role: ${targetRole.trim() || 'not given'}\n\nAbout me:\n${profile.trim()}`;
  return readBody(await complete(WRITE, user, true));
}

export async function editBody(body: CvBody, instruction: string, complete: Complete): Promise<CvBody> {
  const user = `Instruction: ${instruction.trim()}\n\nCurrent CV:\n${JSON.stringify(body)}`;
  return readBody(await complete(EDIT, user, true));
}
