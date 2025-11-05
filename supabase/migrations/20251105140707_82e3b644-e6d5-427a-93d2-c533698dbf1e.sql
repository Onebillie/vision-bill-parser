-- Create storage bucket for bill uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bills',
  'bills',
  true,
  20971520, -- 20MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
);

-- Create RLS policies for bill uploads
CREATE POLICY "Anyone can upload bills"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'bills');

CREATE POLICY "Anyone can read bills"
ON storage.objects
FOR SELECT
USING (bucket_id = 'bills');

CREATE POLICY "Anyone can update their bills"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'bills');

CREATE POLICY "Anyone can delete bills"
ON storage.objects
FOR DELETE
USING (bucket_id = 'bills');