/*
 * Display names (PRD MP-22): 3 to 20 letters, digits and spaces, in any script (a Kannada name is a name); checked
 * against words not allowed; no two alike, where alike ignores case, spaces and look-alike digits.
 */

/**
 * Words not allowed anywhere in a name, as they read once case, spaces, repeated letters and look-alike digits are
 * set aside. Kept short on purpose: common abuse in English and in Kannada, Hindi and Tamil as written in Latin
 * letters, and names that pretend to speak for the game. Moderation of the rest is open question 8 of the PRD.
 */
const ANYWHERE = [
  'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'whore', 'slut', 'pussy', 'penis', 'vagina', 'rapist', 'nigger',
  'nigga', 'faggot', 'hitler', 'porn', 'wank', 'twat', 'asshole', 'motherf', 'madarchod', 'behenchod', 'bhenchod',
  'chutiya', 'chutia', 'bhosdi', 'randi', 'bevarsi', 'thevdiya', 'thullu',
  'admin', 'moderator', 'peakooru', 'official',
]
/**
 * Short, or found inside real names ("Nazir", "Hancock", "Suleman"): not allowed as a whole word only.
 */
const WHOLE = [
  'ass', 'fag', 'sex', 'kkk', 'cum', 'tit', 'tits', 'mod', 'fuk', 'dick', 'cock', 'rape', 'nazi', 'retard', 'gandu',
  'lavda', 'lauda', 'loda', 'boli', 'sule', 'soole', 'tunne', 'kunne', 'nayi', 'otha', 'punda',
]

const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' }

/** The name as it is kept and shown: its letters as given, with spaces tidied. */
export function tidy(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ')
}

/** The key two names are alike by. */
export function nameKey(name: string): string {
  return tidy(name).normalize('NFKC').toLowerCase().replace(/ /g, '').replace(/[0-9]/g, (d) => LOOKALIKE[d] ?? d)
}

const squeeze = (s: string) => s.replace(/(.)\1+/gu, '$1')

/** Why a name is not allowed, in words for the player, or null if it is. */
export function nameProblem(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'Choose a name.'
  const name = tidy(raw)
  const length = [...name].length
  if (length < 3) return 'A name needs at least 3 letters.'
  if (length > 20) return 'A name can have at most 20 letters.'
  if (!/^[\p{L}\p{M}\p{Nd} ]+$/u.test(name)) return 'A name can have only letters, digits and spaces.'
  if (!/\p{L}/u.test(name)) return 'A name needs a letter in it.'
  const key = nameKey(name)
  const words = tidy(raw).normalize('NFKC').toLowerCase().split(' ').map((w) => w.replace(/[0-9]/g, (d) => LOOKALIKE[d] ?? d))
  if (ANYWHERE.some((w) => key.includes(w) || squeeze(key).includes(squeeze(w)))) return 'That name is not allowed. Choose another.'
  if (words.some((w) => WHOLE.includes(w) || WHOLE.includes(squeeze(w)))) return 'That name is not allowed. Choose another.'
  return null
}
