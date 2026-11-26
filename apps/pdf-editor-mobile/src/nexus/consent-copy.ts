// What the owner is told before text leaves the phone. AI hub sends chat to Groq or to Gemini (the owner's choice there, or when every Groq key is rate-limited or refused); embeddings, images and receipt photos always go to Gemini, recordings to Groq. Same sentence as Inflow and Design Editor.
export const CHAT_TO = 'Groq or Gemini, whichever AI hub uses for chat';

export const MINUTES_REPLACE = `Nexus sends the transcript through AI hub to ${CHAT_TO}, again, and replaces the minutes you have now.`;

export const MINUTES_FOOTER = `Nexus sends this transcript through AI hub to ${CHAT_TO}, to write a summary, the decisions and the action items, each with the time it was said. To make the minutes searchable, it sends them to Gemini, also through AI hub. Nexus has no keys of its own.`;

export const MINUTES_HINT = `Sends the transcript to ${CHAT_TO}, through AI hub`;

export const SETTINGS_LEAVES = `Nexus has no AI keys of its own. Everything it sends goes through AI hub, which passes it to Groq or Gemini. To make your notes, PDFs and scans searchable, Nexus sends their text to Gemini, and it sends your photos to Gemini to read them. To find ideas, answer questions, make minutes and write CVs, it sends text to ${CHAT_TO}. Your voice recordings go to Groq to be transcribed. For each Ask my life source you switch on, Nexus sends its messages, pinned clips or Deputy runs to Gemini to make them searchable, and the parts that match to ${CHAT_TO} when you ask. When you ask what Nexus knows about you, it also sends your name and notes from About you, and your saved CVs, to ${CHAT_TO}; a question about your CV or career sends your saved CVs. When you tap Read as receipt, Nexus sends that photo to Gemini and the text read from it to ${CHAT_TO}. While Show what is due today is on, your other apps can read the titles of things due today, and nothing leaves your phone. Your files stay on this phone. Without AI hub nothing is sent.`;

export const ASK_KEEPS = `When a switch is on, Nexus keeps a copy of that text inside Nexus. It sends the text to Gemini to make it searchable, and sends the parts that match to ${CHAT_TO} when you ask about it, both through AI hub. Nothing is sent while a switch is off. One-time codes, health data and Strongroom are never read. Turning a switch off deletes what Nexus kept.`;

export const RECEIPT_START = `Nexus sends this photo to Gemini, and the text read from it to ${CHAT_TO}, all through AI hub, to read it.`;

export const CV_NEW_HINT = `Nexus uses only what you write here and sends it through AI hub to ${CHAT_TO}.`;

export const CV_IMPORT_NOTE = `The text is read on this phone. Nothing is sent until you tap Create CV, and then Nexus sends it through AI hub to ${CHAT_TO}.`;

export const CV_CHANGE_FOOTER = `AI changes the text, adds or removes sections, and keeps the rest as it is. It sends the whole CV through AI hub to ${CHAT_TO}.`;
