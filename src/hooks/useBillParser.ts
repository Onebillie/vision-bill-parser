import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { renderPdfFirstPageToBlob } from "@/lib/pdf-to-image";

export type ProgressStep = "idle" | "uploading" | "analyzing" | "sending" | "complete" | "error";

export const useBillParser = () => {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [progressStep, setProgressStep] = useState<ProgressStep>("idle");
  const { toast } = useToast();

  const uploadFile = async (file: File) => {
    setUploading(true);
    setUploadedFile(file);
    setProgressStep("uploading");

    try {
      let fileToUpload = file;
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      
      if (isPdf) {
        try {
          const pngBlob = await renderPdfFirstPageToBlob(file, 1800);
          fileToUpload = new File([pngBlob], `${Date.now()}.png`, { type: 'image/png' });
        } catch (e) {
          console.warn('PDF conversion failed, using original', e);
        }
      }

      const fileName = `${Date.now()}.${fileToUpload.name.split('.').pop()}`;
      const { error } = await supabase.storage
        .from('bills')
        .upload(fileName, fileToUpload, { contentType: fileToUpload.type, upsert: true });

      if (error) throw error;

      toast({
        title: "Upload complete",
        description: isPdf ? "Converted PDF and uploaded. Parsing..." : "File uploaded. Parsing..."
      });

      await parseBill(fileName);
    } catch (error: any) {
      setProgressStep("error");
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const parseBill = async (filePath: string) => {
    if (!phone.trim()) {
      toast({ title: "Error", description: "Phone number is required", variant: "destructive" });
      return;
    }

    setLoading(true);
    setResult(null);
    setProgressStep("analyzing");

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onebill-vision-parse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
          },
          body: JSON.stringify({ phone, file_path: filePath })
        }
      );

      setProgressStep("sending");
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Parse failed");

      setProgressStep("complete");
      setResult(data);
      toast({
        title: "Success",
        description: data.ok ? "Sent to ONEBILL API successfully!" : "Parsed but API call failed"
      });

      setTimeout(() => setProgressStep("idle"), 2000);
    } catch (error: any) {
      setProgressStep("error");
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setTimeout(() => setProgressStep("idle"), 3000);
    } finally {
      setLoading(false);
    }
  };

  return {
    phone,
    setPhone,
    loading,
    uploading,
    result,
    uploadedFile,
    progressStep,
    uploadFile
  };
};
