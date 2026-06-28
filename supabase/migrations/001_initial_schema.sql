-- Migration 001: Initial Schema
-- MELORI Music Platform — per BUILD SPECIFICATION v1.1 Section 5

-- Enable RLS
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- GENRES (lookup table)
CREATE TABLE genres (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    slug VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ARTISTS
CREATE TABLE artists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    bio TEXT,
    genre_id INTEGER REFERENCES genres(id),
    avatar_url VARCHAR(500),
    cover_image_url VARCHAR(500),
    is_verified BOOLEAN DEFAULT FALSE,
    is_published BOOLEAN DEFAULT FALSE,  -- HIDE QA/PREVIEW ACCOUNTS
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RELEASES (Albums, EPs, Singles)
CREATE TABLE releases (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    release_type VARCHAR(20) NOT NULL CHECK (release_type IN ('single', 'ep', 'album')),
    description TEXT,
    cover_art_url VARCHAR(500),
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    release_date DATE,
    is_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TRACKS
CREATE TABLE tracks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    track_number INTEGER,
    duration_seconds INTEGER,
    audio_url VARCHAR(500),         -- Supabase Storage public URL
    preview_url VARCHAR(500),       -- 30-second preview (optional)
    price DECIMAL(10,2) DEFAULT NULL, -- NULL = inherit from release
    is_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- USERS (extends Supabase Auth — Phase 2)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(50) UNIQUE,
    full_name VARCHAR(255),
    avatar_url VARCHAR(500),
    role VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (role IN ('free', 'superfan', 'artist', 'admin')),
    membership_status VARCHAR(20) DEFAULT 'inactive',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- COMMENTS (Phase 2)
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    track_id INTEGER REFERENCES tracks(id) ON DELETE CASCADE,
    release_id INTEGER REFERENCES releases(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ORDERS (Phase 2)
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    stripe_session_id VARCHAR(255) UNIQUE,
    stripe_payment_intent_id VARCHAR(255),
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ORDER ITEMS (Phase 2)
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    track_id INTEGER REFERENCES tracks(id),
    release_id INTEGER REFERENCES releases(id),
    price_paid DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- STRIPE CONNECT ACCOUNTS (Phase 3)
CREATE TABLE artist_payouts (
    id SERIAL PRIMARY KEY,
    artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    stripe_connect_account_id VARCHAR(255) NOT NULL,
    is_onboarded BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AUDIT LOGS (Phase 3)
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    actor_id UUID REFERENCES profiles(id),
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(50),
    record_id INTEGER,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ROW LEVEL SECURITY POLICIES
ALTER TABLE artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Public can read published artists/releases/tracks
CREATE POLICY "Public read published artists" ON artists FOR SELECT USING (is_published = TRUE);
CREATE POLICY "Public read published releases" ON releases FOR SELECT USING (is_published = TRUE);
CREATE POLICY "Public read published tracks" ON tracks FOR SELECT USING (is_published = TRUE);

-- Users can read their own profile
CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Admins can do everything (Phase 2)
CREATE POLICY "Admins all access artists" ON artists FOR ALL USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
));
CREATE POLICY "Admins all access releases" ON releases FOR ALL USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
));
CREATE POLICY "Admins all access tracks" ON tracks FOR ALL USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
));
CREATE POLICY "Admins all access comments" ON comments FOR ALL USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
));

-- Indexes for performance
CREATE INDEX idx_releases_artist ON releases(artist_id);
CREATE INDEX idx_tracks_release ON tracks(release_id);
CREATE INDEX idx_artists_genre ON artists(genre_id);
CREATE INDEX idx_comments_track ON comments(track_id);
CREATE INDEX idx_comments_release ON comments(release_id);
CREATE INDEX idx_orders_user ON orders(user_id);
