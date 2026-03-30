-- KAN-135: Add avatar_url column and profile-photos storage bucket with RLS
-- Applied to all 3 environments (dev, staging, production) on 30 March 2026

-- Storage bucket (created via SQL, not migration — bucket already exists)
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('profile-photos', 'profile-photos', true, 5242880,
--   ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

-- Add avatar_url column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- Storage RLS policies
CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Anyone can view profile photos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'profile-photos');
