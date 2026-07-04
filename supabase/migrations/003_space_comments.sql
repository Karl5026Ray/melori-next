-- Per-space comments for the MM Social Clubhouse rooms.
--
-- Design mirrors public.community_comments (see initial_schema) but scopes
-- each row to a single space so each room has its own thread. Anyone can read
-- the thread; posting is gated by Superfan-or-better and executed via the
-- /api/social/spaces/[spaceId]/comments route (which uses the service role
-- client, so RLS below only really governs any direct client reads).

CREATE TABLE IF NOT EXISTS public.space_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    author_name TEXT,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_space_comments_space
    ON public.space_comments(space_id, created_at DESC);

ALTER TABLE public.space_comments ENABLE ROW LEVEL SECURITY;

-- Public read: anyone can see the conversation, mirroring the desktop /
-- community feed behavior.
DROP POLICY IF EXISTS "Public read space comments" ON public.space_comments;
CREATE POLICY "Public read space comments"
    ON public.space_comments FOR SELECT
    USING (true);

-- Superfan-and-up posting is enforced in the API route via requireSuperfan.
-- We deliberately do NOT open INSERT to auth.uid() here; the service role
-- client bypasses RLS from the route handler after the guard passes.

-- Admins can moderate.
DROP POLICY IF EXISTS "Admins all access space_comments" ON public.space_comments;
CREATE POLICY "Admins all access space_comments"
    ON public.space_comments FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    ));
