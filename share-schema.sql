-- Shared meeting recaps: the public read path for /s/<token>.
-- Applied to the live project 2026-10-11. Re-runnable.
--
-- The columns it reads (meetings.share_token / share_expires_at / share_views and the
-- recordings table) are created by the meeting-recorder schema alongside this file.

-- A shared meeting page is read by people with no account, so the read cannot go through
-- RLS (there is no auth.uid()) and must not go through the service role (a request handler
-- holding it could read anything). This function is the whole public surface: it takes a
-- token, enforces expiry in SQL, and returns ONLY the fields a guest may see.
--
-- Deliberately NOT returned: user_id, deal_id, product_id, prep (the internal coaching
-- brief), meeting_url (the live join link), bot_id, error, attendees_emails and
-- organizer_email (other people's addresses). Adding a field here is the only way to
-- widen what a guest sees, which is the point.
create or replace function public.share_view(tok text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.meetings;
  r public.recordings;
begin
  if tok is null or length(tok) < 16 then
    return null;
  end if;

  select * into m from public.meetings
   where share_token = tok
     and (share_expires_at is null or share_expires_at > now())
   limit 1;

  if not found then
    return null;   -- never distinguish "no such token" from "expired": same answer to a guest
  end if;

  select * into r from public.recordings
   where meeting_id = m.id and status = 'ready'
   order by created_at desc limit 1;

  update public.meetings set share_views = share_views + 1 where id = m.id;

  return jsonb_build_object(
    'title',          m.title,
    'platform',       m.platform,
    'starts_at',      m.starts_at,
    'duration_min',   m.duration_min,
    'status',         m.status,
    'summary',        m.summary,
    'action_items',   m.action_items,
    'transcript',     m.transcript,
    'recording',      case when r.id is null then null else jsonb_build_object(
                        'key',          r.storage_key,
                        'mime',         r.mime,
                        'duration_sec', r.duration_sec,
                        'bytes',        r.bytes
                      ) end
  );
end;
$$;

-- A definer function is executable by PUBLIC by default; narrow it to the two roles that
-- reach it through PostgREST.
revoke all on function public.share_view(text) from public;
grant execute on function public.share_view(text) to anon, authenticated;

-- Looking a meeting up BY token is the hot path for every guest page load.
create index if not exists meetings_share_token_idx on public.meetings (share_token)
  where share_token is not null;
