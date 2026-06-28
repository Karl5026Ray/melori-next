-- Migration 002: Seed Data
-- MELORI Music Platform — per BUILD SPECIFICATION v1.1 Section 5

-- Seed genres
INSERT INTO genres (name, slug) VALUES
('Hip-Hop', 'hip-hop'),
('R&B', 'rb'),
('Pop', 'pop'),
('Electronic', 'electronic'),
('Rock', 'rock'),
('Jazz', 'jazz'),
('Gospel', 'gospel'),
('Soul', 'soul');

-- Seed one verified artist (Karl Ray)
INSERT INTO artists (name, slug, bio, genre_id, avatar_url, cover_image_url, is_verified, is_published)
VALUES (
    'Karl Ray',
    'karl-ray',
    'Founder of Melori Music. Independent artist, filmmaker, and curator.',
    1,
    'https://your-cdn.com/artists/karl-ray-avatar.jpg',
    'https://your-cdn.com/artists/karl-ray-cover.jpg',
    TRUE,
    TRUE
);

-- Pricing standards: Singles $0.99, EPs $4.99, Albums $9.99
