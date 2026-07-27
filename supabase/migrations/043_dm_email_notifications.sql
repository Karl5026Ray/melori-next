-- 043_dm_email_notifications.sql
--
-- Support for batched email notifications about unread direct messages.
--
-- Until now messaging was in-app only: the sole signal that someone had written
-- to you was the unread badge in the nav, which you had to already be on the
-- site to see. Requests died silently as a result (two were sitting unanswered
-- in production when this was written, one of them from July 14).
--
-- Two stamps are added so the notifier is idempotent and can never email the
-- same thing twice, even if a cron run overlaps or retries:
--
--   messages.email_notified_at        — set once a message has been considered
--                                       for notification. Stamped whether or not
--                                       an email actually went out (recipient may
--                                       have read it, opted out, or be blocked),
--                                       because the point is "we are done with
--                                       this row", not "we emailed about it".
--
--   conversations.request_email_sent_at — a brand-new conversation request can
--                                       exist with ZERO message rows (the
--                                       Kaiel -> markjoy request from July 22 is
--                                       exactly this). There is no message to
--                                       stamp, so the request itself carries the
--                                       stamp.
--
-- Opt-out reuses the existing profiles.notifications_email boolean, which the
-- /settings page already exposes as a toggle. No new preference surface.
--
-- Additive and idempotent: safe to re-run.

alter table public.messages
  add column if not exists email_notified_at timestamptz;

alter table public.conversations
  add column if not exists request_email_sent_at timestamptz;

comment on column public.messages.email_notified_at is
  'Set by /api/cron/dm-email-notifications once this message has been considered for an unread-DM email. Non-null means never reconsider.';

comment on column public.conversations.request_email_sent_at is
  'Set by /api/cron/dm-email-notifications once the recipient has been emailed about this pending conversation request. Covers requests that carry no message rows.';

-- The notifier''s hot query is "messages that are old enough to notify about and
-- have not been handled yet". A partial index keeps that off a full scan as the
-- table grows; rows are stamped exactly once and then leave the index for good.
create index if not exists messages_pending_email_notification_idx
  on public.messages (created_at)
  where email_notified_at is null and deleted_at is null;

-- Same shape for unhandled pending requests.
create index if not exists conversations_pending_request_email_idx
  on public.conversations (created_at)
  where request_email_sent_at is null and status = 'pending';
