import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ImagePlus, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/PageHeader';
import { PageContainer } from '@/components/AppLayout';
import { uploadMedia } from '@/lib/mediaClient';
import { createDraft } from '@/lib/enhancementJobs';
import { ApiError } from '@/lib/apiClient';
import type { FunctionComponent } from '@/common/types';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UploadPhoto = (): FunctionComponent => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = (candidate: File): void => {
    setError(null);
    if (!ACCEPTED_TYPES.includes(candidate.type)) {
      setError('Only JPG, PNG or WEBP images up to 10 MB are accepted.');
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError('Only JPG, PNG or WEBP images up to 10 MB are accepted.');
      return;
    }
    const url = URL.createObjectURL(candidate);
    const img = new Image();
    img.onload = () => setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
    setFile(candidate);
    setPreviewUrl(url);
  };

  const removePhoto = (): void => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setDimensions(null);
    setError(null);
  };

  const handleContinue = async (): Promise<void> => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadMedia(file);
      const job = await createDraft({
        photoUrl: asset.s3Key,
        photoFileName: file.name,
        photoMimeType: file.type,
        photoSizeBytes: file.size,
      });
      toast.success('Photo uploaded — choose your corrections next.');
      navigate(`/enhance/${job.id}/options`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="Upload a photo" description="Start a new enhancement request with a photo of yourself." />

        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className="rounded-full bg-[--mint] px-2.5 py-1 text-[--mint-dark]">1. Upload</span>
          <span className="rounded-full bg-muted px-2.5 py-1">2. Corrections</span>
          <span className="rounded-full bg-muted px-2.5 py-1">3. Confirm</span>
        </div>

        {!file ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) acceptFile(dropped);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            className={`flex min-h-[280px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
          >
            <ImagePlus className="size-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Drag and drop a photo here, or click to choose one</p>
            <p className="text-xs text-muted-foreground">Accepted formats: JPG, PNG, WEBP · Max size: 10 MB</p>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) acceptFile(picked);
                e.target.value = '';
              }}
            />
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border bg-card p-4 shadow-card">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
              {previewUrl && (
                <img src={previewUrl} alt="Selected photo preview" className="size-full object-contain" />
              )}
              <button
                type="button"
                onClick={removePhoto}
                aria-label="Remove photo"
                className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-background/90 text-foreground shadow"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{file.name}</span>
              <span>
                {dimensions ? `${dimensions.w} × ${dimensions.h}px · ` : ''}
                {formatBytes(file.size)}
              </span>
            </div>
          </div>
        )}

        {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button onClick={handleContinue} disabled={!file || uploading} className="min-h-[44px]">
            <Upload className="size-4" />
            {uploading ? 'Uploading…' : 'Continue'}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
};
