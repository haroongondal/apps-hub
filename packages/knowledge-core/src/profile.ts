/** Written by the owner, so unlike source text it is trusted and never fenced as data. */
export interface AboutYou {
  name?: string;
  notes?: string;
}

export interface ExtraSource {
  id: string;
  title: string;
  text: string;
}

export interface AskContext {
  about?: AboutYou;
  extras?: ExtraSource[];
}

export interface LifeArea {
  key: string;
  title: string;
  probe: string;
}

export const LIFE_AREAS: readonly LifeArea[] = [
  { key: 'identity', title: 'Identity and contact', probe: 'full name, date of birth, nationality, home address, phone number, email address, national ID or passport number' },
  { key: 'work', title: 'Work and skills', probe: 'job title, employer, work experience, skills, projects, responsibilities, achievements, resume' },
  { key: 'education', title: 'Education', probe: 'university degree, school, courses, certificates, grades, qualifications' },
  { key: 'health', title: 'Health', probe: 'health, medical report, doctor, hospital, diagnosis, medicine, prescription, lab test result, allergy, insurance' },
  { key: 'money', title: 'Money', probe: 'bank account, salary, payment, invoice, receipt, tax, loan, savings, expenses, balance' },
  { key: 'people', title: 'People', probe: 'family, wife, husband, children, parents, brother, sister, friend, relationship, colleague' },
  { key: 'life', title: 'Home, plans and interests', probe: 'home, rent, car, travel, plans, goals, hobbies, interests, belongings' },
];

const PROFILE = /\b(about (?:me|myself)|know me|who am i|my profile|my life|my background|describe me|summari[sz]e me|everything about me)\b/i;
const CV_WORDS = /\b(cv|resume|résumé|curriculum vitae|experience|skills?|career|employment|work history|education|qualifications?)\b/i;

export const isProfileQuestion = (q: string): boolean => PROFILE.test(q);
const CV_NAMES = /\b(cv|resume|résumé|curriculum vitae)\b/i;
const SELF = /\b(my|me|mine|i)\b/i;

// "skills" in "what skills does the course teach" is not about the owner; only an explicit CV word, or a self-reference beside a career word, sends a CV.
export const wantsCvs = (q: string): boolean => PROFILE.test(q) || CV_NAMES.test(q) || (SELF.test(q) && CV_WORDS.test(q));

// Some chat models cite as 【2†source】 whatever the prompt says; the app and the citation parser only know [2].
export const normaliseCitations = (text: string): string => text.replace(/【\s*(\d+)[^】]*】/g, '[$1]');
