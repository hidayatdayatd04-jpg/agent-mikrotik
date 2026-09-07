/** Deliberately narrow: a greeting with any actual request still reaches tools. */
export function isGreetingOnly(text: string): boolean {
  return /^(halo|hallo|hai|hi|hello|hey|hei|assalamualaikum|assalamu'alaikum|selamat (pagi|siang|sore|malam))(\s+(min|admin|kak|bang|pak|bu|bot))?[\s!?.👋]*$/iu.test(text.trim());
}
