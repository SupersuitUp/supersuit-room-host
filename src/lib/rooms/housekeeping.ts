// This host's house rules (Protocol v0.3, section 7; v0.4 adds docs and textAfterClose), served at /.well-known/supersuit-room.json and
// shown on the room page's library view. It enforces no limit on a file or a room, so `limits` is
// empty; housekeep() in service.ts deletes exactly what this says it deletes. No server imports: the
// page reads it too.
export const HOUSEKEEPING_DECLARATION = {
  protocol: '0.4',
  docs: 'https://rooms.supersuit.co/about',
  housekeeping: { limits: {}, whileOpen: 'keep', textAfterClose: 'keep', afterCloseDays: 30, unclaimedUploadDays: 7, memberMayDelete: true, ownerMayDeleteRoom: true },
} as const

/** The rules in the words a reader sees on the library view. */
export function houseRules(d = HOUSEKEEPING_DECLARATION.housekeeping): string[] {
  return [
    'Files of any type and any size.',
    'Kept for as long as the room is open.',
    'The text stays after the room closes, so its readers can still read it.',
    `Deleted ${d.afterCloseDays} days after the room closes; the records of what was here, and why, stay with the thread.`,
    `An upload no Pluma adds to the library is deleted after ${d.unclaimedUploadDays} days.`,
    'The Pluma that brought a file can retire it, which deletes the file and keeps its record.',
  ]
}
