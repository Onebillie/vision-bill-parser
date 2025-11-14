import { Upload } from "lucide-react";

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  currentFile?: File | null;
  isUploading?: boolean;
}

export const FileUpload = ({ onFileSelect, disabled, currentFile, isUploading }: FileUploadProps) => {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Upload File</label>
      <div
        className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer"
        onClick={() => !disabled && document.getElementById('file-input')?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add('border-primary');
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove('border-primary');
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('border-primary');
          const file = e.dataTransfer.files[0];
          if (file && !disabled) onFileSelect(file);
        }}
      >
        <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {isUploading ? "Uploading..." : currentFile ? currentFile.name : "Drag and drop or click to upload"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Supports JPG, PNG, WEBP, PDF, CSV, Excel (max 20MB)
        </p>
      </div>
      <input
        id="file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf,.pdf,.csv,text/csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(file);
        }}
        disabled={disabled}
      />
    </div>
  );
};
