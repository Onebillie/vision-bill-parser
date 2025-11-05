// Utility to render the first page of a PDF File to a PNG Blob (client-side)
// Uses pdfjs-dist with a CDN worker to avoid bundling complexity

import * as pdfjsLib from 'pdfjs-dist';

// Configure worker from CDN to work reliably with Vite
// Note: lock version to match installed pdfjs-dist
(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

export async function renderPdfFirstPageToBlob(file: File, maxWidth = 1400): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale: 1.0 });
  const scale = Math.min(2.0, maxWidth / viewport.width);
  const scaledViewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context not available');

  canvas.width = Math.ceil(scaledViewport.width);
  canvas.height = Math.ceil(scaledViewport.height);

  const renderContext = { canvasContext: context, viewport: scaledViewport } as any;
  await page.render(renderContext).promise;

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to create PNG blob'));
    }, 'image/png');
  });
}
