-- Create training documents table
CREATE TABLE public.training_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  document_type TEXT NOT NULL CHECK (document_type IN ('meter_manual', 'bill_explainer', 'field_guide', 'other')),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  tags TEXT[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.training_documents ENABLE ROW LEVEL SECURITY;

-- Allow everyone to view training docs
CREATE POLICY "Training docs are viewable by everyone"
  ON public.training_documents
  FOR SELECT
  USING (true);

-- Allow authenticated users to manage training docs
CREATE POLICY "Authenticated users can insert training docs"
  ON public.training_documents
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update training docs"
  ON public.training_documents
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete training docs"
  ON public.training_documents
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Add trigger for updated_at
CREATE TRIGGER update_training_documents_updated_at
  BEFORE UPDATE ON public.training_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for training docs
INSERT INTO storage.buckets (id, name, public)
VALUES ('training-docs', 'training-docs', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for training-docs bucket
CREATE POLICY "Training docs are publicly accessible"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'training-docs');

CREATE POLICY "Authenticated users can upload training docs"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'training-docs' 
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "Authenticated users can update training docs"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'training-docs' 
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "Authenticated users can delete training docs"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'training-docs' 
    AND auth.uid() IS NOT NULL
  );