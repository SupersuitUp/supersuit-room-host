// src/lib/tether-log/terms.ts
// EVERY DEFINED WORD ON A TETHER PAGE LIVES HERE (soul:self-documenting). A test refuses one written
// anywhere else in this folder, so a new word cannot ship with no link. On a member's page the first use
// carries an ⓘ to its exact wiki page. On a shared page the wikis would land a stranger on a sign-in door,
// so the first use defines the word in its own sentence.
export type TermKey = 'pluma' | 'supersession' | 'superproject' | 'helm' | 'tetheredSupersession' | 'tether' | 'tetherLog'
const WIKI = 'https://wiki.supersuit.co/concepts'

export const TERMS: Record<TermKey, { label: string; plural: string; url: string; gloss: string }> = {
  pluma: { label: 'Pluma', plural: 'Plumas', url: `${WIKI}/pluma`, gloss: 'an AI agent that works for one person' },
  supersession: { label: 'supersession', plural: 'supersessions', url: `${WIKI}/supersession`, gloss: 'one conversation between a person and their AI agent' },
  superproject: { label: 'superproject', plural: 'superprojects', url: `${WIKI}/superproject`, gloss: 'one folder of work that runs over many conversations' },
  helm: { label: 'Helm', plural: 'Helms', url: `${WIKI}/helm`, gloss: 'a phone app that runs from a person\'s own computer' },
  tetheredSupersession: { label: 'Tethered supersession', plural: 'Tethered supersessions', url: `${WIKI}/tethered-supersession`, gloss: 'two conversations connected, so that two AI agents work toward one goal' },
  tether: { label: 'tether', plural: 'tethers', url: `${WIKI}/tethered-supersession`, gloss: 'a connection between two conversations' },
  tetherLog: { label: 'tether log', plural: 'tether logs', url: `${WIKI}/tethered-supersession`, gloss: 'the record of what two AI agents did together' },
}

export type Part = string | { term: TermKey; plural?: boolean }
const t = (term: TermKey, plural = false): Part => ({ term, plural })

export const COPY = {
  openConversation: ['Open full conversation'],
  share: ['Share a read-only page'],
  check: ['Check signatures'],
  settled: ['Settled'],
  stillOpen: ['Still open'],
  story: ['The story so far'],
  howToRead: ['How to read this page'],
  began: ['The ', t('tetherLog'), ' began here.'],
  filed: ['Filed with this ', t('tetherLog')],
  whatIs: ['Two ', t('pluma', true), ' working toward one intent, for '],
  keyIntro: ['Newest first. Each ', t('pluma'), ' keeps its own side of the ', t('tetherLog'), '.'],
  keyViolet: ['Violet is a person\'s exact words, and only their own ', t('pluma'), ' carries them here.'],
  keyTick: ['A tick means a signature on the post passed its check.'],
  keySide: ['A side belongs to one ', t('pluma'), '. "Carried by" names the one that brought a person\'s words.'],
  keyTap: ['Tap an entry to see its proof and its signature check.'],
  shareSheet: ['Tell your ', t('pluma'), ' to share this page. Every operator must say yes, and the page goes live on the last yes.'],
  sharedLead: ['A read-only copy of a ', t('tetherLog'), '. Both people said yes to this page. It leaves out the full conversation and the files.'],
  sharedAbout: ['What this page is'],
  noReason: ['No reason on record.'],
  waitingForMac: ['This is the last copy your phone saved. Your computer is not answering.'],
  openOnHost: ['Open the latest on the web'],
  standard: ['This record follows the ', t('tetherLog'), ' standard, v1.'],
} satisfies Record<string, Part[]>

/** A word that must come from TERMS. Used by the test over COPY. */
export const DEFINED_WORD = /\b(Plumas?|supersessions?|superprojects?|Helm|tethers?)\b/i
