// The meeting recorder's pure edges: which calendar events become meetings, who can see a
// shared recording, and what a recording's status is allowed to do next.
//
// These three are tested hard because each one fails SILENTLY in production. A bad calendar
// mapping means no bot joins and nobody is told. A share link that outlives its expiry leaks
// a customer's call recording to anyone holding the URL. A recording that jumps pending ->
// ready marks an upload complete that never happened, and the file is deleted locally right
// after. None of the three throws; they just quietly do the wrong thing.
const { suite } = require('./lib/t');
const {
  platformOf, meetLinkFrom, calendarEventToMeeting,
  newShareToken, shareState, canRecordingTransition, RECORDING_STATES,
} = require('../meetings.js');

const t = suite('meetings');

const MEET = 'https://meet.google.com/abc-defg-hij';
// A minimal event that SHOULD map, so each case below changes exactly one thing.
const ev = (over = {}) => ({
  id: 'evt1',
  summary: 'Discovery call',
  hangoutLink: MEET,
  start: { dateTime: '2026-10-12T14:00:00Z' },
  end: { dateTime: '2026-10-12T14:30:00Z' },
  organizer: { email: 'Host@Acme.com' },
  ...over,
});

t.group('finding the link');
t.eq('hangoutLink', meetLinkFrom({ hangoutLink: MEET }), MEET);
t.eq('conferenceData video entry point',
  meetLinkFrom({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: MEET }] } }),
  MEET);
t.eq('pasted into the location field', meetLinkFrom({ location: MEET }), MEET);
t.eq('buried in the invite body',
  meetLinkFrom({ description: `Join here:\n${MEET}\nDial-in also available` }), MEET);
t.eq('nothing to find', meetLinkFrom({ description: 'bring the deck' }), '');
t.eq('a phone-only conference is not a link',
  meetLinkFrom({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1555' }] } }), '');

t.group('events that must NOT become meetings');
// Each of these would otherwise send a bot somewhere it cannot go, and the failure would
// surface as an unexplained 'failed' meeting rather than as a skipped event.
t.eq('cancelled', calendarEventToMeeting(ev({ status: 'cancelled' })), null);
t.eq('all-day event has no moment to join',
  calendarEventToMeeting(ev({ start: { date: '2026-10-12' }, end: { date: '2026-10-13' } })), null);
t.eq('no video link at all', calendarEventToMeeting(ev({ hangoutLink: '' })), null);
t.eq('Zoom — the self-hosted worker refuses it',
  calendarEventToMeeting(ev({ hangoutLink: '', location: 'https://acme.zoom.us/j/99' })), null);
t.eq('Teams — same',
  calendarEventToMeeting(ev({ hangoutLink: '', location: 'https://teams.microsoft.com/l/meetup-join/x' })), null);
t.eq('unparseable start time', calendarEventToMeeting(ev({ start: { dateTime: 'soon' } })), null);
t.safe('junk input is refused, not thrown on', () => {
  calendarEventToMeeting(null); calendarEventToMeeting(undefined);
  calendarEventToMeeting('nonsense'); calendarEventToMeeting({});
});

t.group('mapping an event that does count');
const row = calendarEventToMeeting(ev(), { userId: 'u1', calendarAccountId: 'ca1' });
t.eq('platform', row.platform, 'meet');
t.eq('title', row.title, 'Discovery call');
t.eq('link', row.meeting_url, MEET);
t.eq('start normalised to ISO', row.starts_at, '2026-10-12T14:00:00.000Z');
t.eq('duration from the end time', row.duration_min, 30);
t.eq('keyed to the calendar event', row.calendar_event_id, 'evt1');
t.eq('carries the account it came from', row.calendar_account_id, 'ca1');
t.eq('auto_join on, so the tick picks it up', row.auto_join, true);
t.eq('status starts scheduled', row.status, 'scheduled');
t.eq('organizer lowercased', row.organizer_email, 'host@acme.com');
t.eq('untitled event still gets a name',
  calendarEventToMeeting(ev({ summary: '   ' })).title, 'Untitled meeting');
t.eq('a 90 minute block',
  calendarEventToMeeting(ev({ end: { dateTime: '2026-10-12T15:30:00Z' } })).duration_min, 90);
t.eq('no end time falls back to 30',
  calendarEventToMeeting(ev({ end: null })).duration_min, 30);
t.eq('end before start is nonsense, fall back to 30',
  calendarEventToMeeting(ev({ end: { dateTime: '2026-10-12T13:00:00Z' } })).duration_min, 30);

t.group('attendees — this list is what client-matching reads');
t.eq('lowercased and de-duplicated',
  calendarEventToMeeting(ev({ attendees: [{ email: 'A@Acme.com' }, { email: 'a@acme.com' }, { email: 'b@acme.com' }] })).attendees_emails,
  ['a@acme.com', 'b@acme.com']);
t.eq('a booked room is not a person',
  calendarEventToMeeting(ev({ attendees: [{ email: 'a@acme.com' }, { email: 'room-3@acme.com', resource: true }] })).attendees_emails,
  ['a@acme.com']);
t.eq('no attendees is an empty list, never undefined',
  calendarEventToMeeting(ev({ attendees: undefined })).attendees_emails, []);

t.group('share tokens');
const tok = newShareToken();
t.ok('url-safe characters only', /^[A-Za-z0-9_-]+$/.test(tok));
t.ok('at least 128 bits of entropy', Buffer.from(tok, 'base64url').length >= 16);
t.ok('1000 tokens, no collision', new Set(Array.from({ length: 1000 }, newShareToken)).size === 1000);

t.group('who can open a share link');
const NOW = Date.parse('2026-10-12T12:00:00Z');
t.eq('never shared', shareState({}, NOW), 'none');
// Revoking sets share_token to null, so a row with an expiry but no token is still 'none'.
t.eq('revoked, even with an expiry still on the row',
  shareState({ share_token: null, share_expires_at: '2026-12-01T00:00:00Z' }, NOW), 'none');
t.eq('shared with no expiry', shareState({ share_token: tok }, NOW), 'active');
t.eq('shared, expiry in the future',
  shareState({ share_token: tok, share_expires_at: '2026-10-12T13:00:00Z' }, NOW), 'active');
t.eq('expired an hour ago',
  shareState({ share_token: tok, share_expires_at: '2026-10-12T11:00:00Z' }, NOW), 'expired');
// The boundary decides a real request. Expiring ON the second must deny, not allow.
t.eq('exactly at the expiry instant is expired',
  shareState({ share_token: tok, share_expires_at: '2026-10-12T12:00:00Z' }, NOW), 'expired');
t.eq('an unparseable expiry is not treated as expired',
  shareState({ share_token: tok, share_expires_at: 'whenever' }, NOW), 'active');

t.group('recording status machine');
t.eq('the four states', RECORDING_STATES, ['pending', 'uploading', 'ready', 'failed']);
t.ok('a new row starts at pending', canRecordingTransition(null, 'pending'));
t.ok('pending -> uploading', canRecordingTransition('pending', 'uploading'));
t.ok('pending -> failed (the bot died before upload)', canRecordingTransition('pending', 'failed'));
t.ok('uploading -> ready', canRecordingTransition('uploading', 'ready'));
t.ok('uploading -> failed (R2 rejected it)', canRecordingTransition('uploading', 'failed'));
// This is the one that matters most: the local file is deleted once a row says ready.
t.no('pending -> ready skips the upload entirely', canRecordingTransition('pending', 'ready'));
t.no('ready is terminal', canRecordingTransition('ready', 'uploading'));
t.no('failed is terminal', canRecordingTransition('failed', 'uploading'));
t.no('no going back to pending', canRecordingTransition('uploading', 'pending'));
t.no('a repeat write is a caller bug, not progress', canRecordingTransition('uploading', 'uploading'));
t.no('unknown target refused', canRecordingTransition('pending', 'uploaded'));
t.no('unknown source refused', canRecordingTransition('queued', 'uploading'));
t.no('a first write must be pending, not uploading', canRecordingTransition(null, 'uploading'));

t.group('platformOf still agrees with the mapper');
t.eq('meet', platformOf(MEET), 'meet');
t.eq('zoom', platformOf('https://acme.zoom.us/j/99'), 'zoom');
t.eq('teams', platformOf('https://teams.microsoft.com/l/meetup-join/x'), 'teams');
t.eq('anything else', platformOf('https://whereby.com/x'), 'other');
t.eq('no url', platformOf(), 'other');

module.exports = t.report();
