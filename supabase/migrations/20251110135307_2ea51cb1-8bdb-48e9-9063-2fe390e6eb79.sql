-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create table for API configurations
CREATE TABLE public.api_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  service_type TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.api_configs ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read API configs (needed for edge function)
CREATE POLICY "API configs are viewable by everyone" 
ON public.api_configs 
FOR SELECT 
USING (true);

-- Only authenticated users can insert
CREATE POLICY "Authenticated users can insert API configs" 
ON public.api_configs 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

-- Only authenticated users can update
CREATE POLICY "Authenticated users can update API configs" 
ON public.api_configs 
FOR UPDATE 
USING (auth.uid() IS NOT NULL);

-- Only authenticated users can delete
CREATE POLICY "Authenticated users can delete API configs" 
ON public.api_configs 
FOR DELETE 
USING (auth.uid() IS NOT NULL);

-- Insert existing API configurations
INSERT INTO public.api_configs (name, endpoint_url, service_type, parameters) VALUES
  ('Electricity API', 'https://api.onebill.ie/api/electricity-file', 'electricity', 
   '{"mcc_type": "", "account_number": "", "mprn": "", "supplier_name": "", "dg_type": ""}'::jsonb),
  ('Gas API', 'https://api.onebill.ie/api/gas-file', 'gas',
   '{"gprn": "", "supplier_name": ""}'::jsonb);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_api_configs_updated_at
BEFORE UPDATE ON public.api_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();